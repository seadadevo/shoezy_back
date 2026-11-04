import type { PrismaClient } from "@prisma/client";
import { MAX_NOTIFICATION_ATTEMPTS } from "./notifications.policy";

export async function requeueExhaustedNotification(client: PrismaClient, eventId: string, availableAt = new Date()) {
  return client.$transaction(async (transaction) => {
    const event = await transaction.notificationOutbox.findUnique({
      where: { id: eventId },
      select: {
        id: true,
        type: true,
        attempts: true,
        processedAt: true,
        lockedAt: true,
        lastError: true,
        adminEmailSentAt: true,
        customerEmailSentAt: true,
      },
    });

    if (!event) throw new Error("Notification outbox event was not found");
    if (event.processedAt) throw new Error("Notification outbox event is already processed");
    if (event.attempts < MAX_NOTIFICATION_ATTEMPTS) throw new Error("Notification outbox event is not exhausted");
    if (event.lockedAt) throw new Error("Notification outbox event is currently locked");

    const updated = await transaction.notificationOutbox.updateMany({
      where: {
        id: event.id,
        processedAt: null,
        attempts: { gte: MAX_NOTIFICATION_ATTEMPTS },
        lockedAt: null,
      },
      data: { attempts: 0, availableAt, lockedAt: null },
    });
    if (updated.count !== 1) throw new Error("Notification outbox event changed during recovery");

    return {
      eventId: event.id,
      eventType: event.type,
      previousAttempts: event.attempts,
      availableAt,
      lastError: event.lastError,
      adminEmailSent: event.adminEmailSentAt !== null,
      customerEmailSent: event.customerEmailSentAt !== null,
    };
  });
}
