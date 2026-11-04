import { Prisma, type PrismaClient } from "@prisma/client";
import { prisma } from "../../config/database";
import { notificationHub } from "./notification-hub";
import { toNotificationDto } from "./notifications.dto";
import { notificationSelect } from "./notifications.types";
import { env } from "../../config/env";
import { orderDetailSelect } from "../orders/orders.types";
import { adminOrderEmail, customerOrderEmail, SmtpOrderEmailSender, type OrderEmailSender } from "../orders/order-email.service";
import { supportAdminEmail } from "../support/support-email.service";
import { MAX_NOTIFICATION_ATTEMPTS, notificationRetryDelaySeconds } from "./notifications.policy";

type ClaimedEvent = Awaited<ReturnType<NotificationOutboxProcessor["claim"]>>[number];

function sanitizedErrorName(error: unknown) {
  const name = error instanceof Error ? error.name : "UnknownError";
  return /^[A-Za-z][A-Za-z0-9_.:-]{0,79}$/.test(name) ? name : "Error";
}

export class NotificationOutboxProcessor {
  constructor(private readonly client: PrismaClient = prisma, private readonly email: OrderEmailSender = new SmtpOrderEmailSender()) {}

  async claim(limit = 50) {
    return this.client.$transaction(async (transaction) => {
      const ids = await transaction.$queryRaw<Array<{ id: string }>>`
        SELECT "id"
        FROM "notification_outbox"
        WHERE "processed_at" IS NULL
          AND "attempts" < ${MAX_NOTIFICATION_ATTEMPTS}
          AND "available_at" <= NOW()
          AND ("locked_at" IS NULL OR "locked_at" < NOW() - INTERVAL '5 minutes')
        ORDER BY "created_at", "id"
        LIMIT ${limit}
        FOR UPDATE SKIP LOCKED
      `;
      if (ids.length === 0) return [];
      const eventIds = ids.map(({ id }) => id);
      await transaction.notificationOutbox.updateMany({ where: { id: { in: eventIds } }, data: { lockedAt: new Date() } });
      return transaction.notificationOutbox.findMany({ where: { id: { in: eventIds } }, orderBy: [{ createdAt: "asc" }, { id: "asc" }] });
    });
  }

  private async materialize(event: ClaimedEvent) {
    return this.client.$transaction(async (transaction) => {
      const recipientIds = event.audience === "USER"
        ? event.recipientUserId ? [event.recipientUserId] : []
        : (await transaction.user.findMany({
          where: {
            status: "ACTIVE",
            deletedAt: null,
            roles: { some: { role: { isActive: true, permissions: { some: { permission: { code: event.recipientPermission ?? "", isActive: true } } } } } },
          },
          select: { id: true },
        })).map(({ id }) => id);

      const notifications = [];
      for (const recipientUserId of recipientIds) {
        const where = { recipientUserId_deduplicationKey: { recipientUserId, deduplicationKey: event.deduplicationKey } };
        const existing = await transaction.notification.findUnique({ where, select: { id: true } });
        const notification = await transaction.notification.upsert({
          where,
          create: {
            recipientUserId,
            type: event.type,
            entityType: event.entityType,
            entityId: event.entityId,
            templateKey: event.templateKey,
            templateParams: event.templateParams as Prisma.InputJsonValue,
            metadata: event.metadata === null ? Prisma.DbNull : event.metadata as Prisma.InputJsonValue,
            deduplicationKey: event.deduplicationKey,
            createdAt: event.createdAt,
          },
          update: {},
          select: notificationSelect,
        });
        if (!existing) notifications.push(notification);
      }
      const counts = new Map<string, number>();
      for (const notification of notifications) counts.set(notification.recipientUserId, await transaction.notification.count({ where: { recipientUserId: notification.recipientUserId, readAt: null } }));
      return { notifications, counts };
    });
  }

  private async deliverOrderEmail(event: ClaimedEvent) {
    if (event.type !== "ORDER_CREATED" || event.entityType !== "ORDER") return;
    const order = await this.client.order.findUniqueOrThrow({ where: { id: event.entityId }, select: orderDetailSelect });
    if (!event.adminEmailSentAt) {
      if (!env.ORDER_NOTIFICATION_EMAIL) throw new Error("Admin order email is not configured");
      await this.email.send(adminOrderEmail(order, env.ORDER_NOTIFICATION_EMAIL));
      const sentAt = new Date();
      await this.client.notificationOutbox.update({ where: { id: event.id }, data: { adminEmailSentAt: sentAt } });
      event.adminEmailSentAt = sentAt;
    }
    if (!event.customerEmailSentAt) {
      const message = customerOrderEmail(order);
      if (message) {
        await this.email.send(message);
        const sentAt = new Date();
        await this.client.notificationOutbox.update({ where: { id: event.id }, data: { customerEmailSentAt: sentAt } });
        event.customerEmailSentAt = sentAt;
      }
    }
  }

  private async deliverSupportEmail(event: ClaimedEvent) {
    if (event.type !== "SUPPORT_REQUEST" || event.entityType !== "SUPPORT_MESSAGE" || event.adminEmailSentAt) return;
    const recipient = env.SUPPORT_NOTIFICATION_EMAIL ?? env.ORDER_NOTIFICATION_EMAIL;
    if (!recipient) throw new Error("Admin support email is not configured");
    const message = await this.client.supportMessage.findUniqueOrThrow({
      where: { id: event.entityId },
      select: { body: true, createdAt: true, conversation: { select: {
        id: true, reference: true, guestName: true, guestPhone: true, guestEmail: true, userId: true, status: true,
        order: { select: { orderNumber: true } },
      } } },
    });
    await this.email.send(supportAdminEmail(message, recipient, event.deduplicationKey.endsWith(":admin:0")));
    const sentAt = new Date();
    await this.client.notificationOutbox.update({ where: { id: event.id }, data: { adminEmailSentAt: sentAt } });
    event.adminEmailSentAt = sentAt;
  }

  private async retry(event: ClaimedEvent, error: unknown) {
    const attempts = event.attempts + 1;
    const failedAt = new Date();
    const terminal = attempts >= MAX_NOTIFICATION_ATTEMPTS;
    const lastError = `Notification processing failed (${sanitizedErrorName(error)})`;
    await this.client.notificationOutbox.update({
      where: { id: event.id },
      data: {
        attempts: { increment: 1 },
        processedAt: null,
        lockedAt: null,
        lastError,
        availableAt: terminal
          ? failedAt
          : new Date(failedAt.getTime() + notificationRetryDelaySeconds(attempts) * 1000),
      },
    });
    return {
      attempts,
      terminal,
      lastError,
      failedAt,
      adminEmailSent: event.adminEmailSentAt !== null,
      customerEmailSent: event.customerEmailSentAt !== null,
    };
  }

  async processBatch(limit = 50) {
    let processed = 0;
    for (let index = 0; index < limit; index += 1) {
      const [event] = await this.claim(1);
      if (!event) break;
      try {
        const result = await this.materialize(event);
        for (const notification of result.notifications) notificationHub.new(notification.recipientUserId, toNotificationDto(notification, "en"));
        for (const [userId, count] of result.counts) notificationHub.unreadCount(userId, count);
        await this.deliverOrderEmail(event);
        await this.deliverSupportEmail(event);
        await this.client.notificationOutbox.update({ where: { id: event.id }, data: { processedAt: new Date(), lockedAt: null, lastError: null } });
        processed += 1;
      } catch (error: unknown) {
        const failure = await this.retry(event, error);
        console.error(
          failure.terminal ? "Notification outbox terminal failure" : "Notification outbox processing failed",
          {
            eventId: event.id,
            eventType: event.type,
            attempts: failure.attempts,
            lastError: failure.lastError,
            failedAt: failure.failedAt.toISOString(),
            adminEmailSent: failure.adminEmailSent,
            customerEmailSent: failure.customerEmailSent,
          },
        );
      }
    }
    return processed;
  }
}

export function startNotificationOutboxWorker(processor = new NotificationOutboxProcessor(), intervalMs = 2_000) {
  let running = false;
  const run = async () => {
    if (running) return;
    running = true;
    try { await processor.processBatch(); }
    catch (error: unknown) { console.error("Notification worker failed", { name: error instanceof Error ? error.name : "UnknownError" }); }
    finally { running = false; }
  };
  void run();
  const timer = setInterval(() => { void run(); }, intervalMs);
  timer.unref();
  return () => clearInterval(timer);
}
