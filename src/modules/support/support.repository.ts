import { randomUUID } from "node:crypto";
import { Prisma, type PrismaClient } from "@prisma/client";
import { prisma } from "../../config/database";
import { AppError } from "../../common/errors/app-error";
import { PERMISSIONS } from "../../common/auth/rbac.constants";
import { enqueueNotification } from "../notifications/notifications.outbox";
import { adminConversationDto, customerConversationDto, supportConversationSelect, supportMessageDto, supportMessageSelect } from "./support.dto";
import { normalizedSupportPhone, supportToken, supportTokenHash, validSupportToken } from "./support.security";
import type { CreateSupportInput, SupportAdminList, SupportPage } from "./support.validation";
import { supportHub } from "./support.socket-hub";

export type SupportActor = { userId: string; guestToken?: never } | { userId?: never; guestToken: string };
const missing = () => new AppError(404, "Support conversation not found", "SUPPORT_NOT_FOUND");

export class SupportRepository {
  constructor(private readonly client: PrismaClient = prisma) {}

  private async linkedOrder(tx: Prisma.TransactionClient, input: CreateSupportInput, userId: string | undefined, phone: string) {
    if (!input.orderNumber || !input.orderNumber.trim()) return null;
    const order = await tx.order.findFirst({
      where: { orderNumber: { equals: input.orderNumber.trim(), mode: "insensitive" } },
      select: { id: true, userId: true, customerPhone: true },
    });
    if (!order) {
      throw new AppError(422, "Order not found. Please verify the order number or leave it blank.", "SUPPORT_ORDER_NOT_FOUND");
    }
    const isAdmin = userId ? await tx.userRole.findFirst({
      where: { userId, role: { code: { in: ["ADMIN", "SUPER_ADMIN"] } } },
    }) : null;
    if (!isAdmin && (userId ? order.userId !== userId : order.userId !== null || normalizedSupportPhone(order.customerPhone) !== normalizedSupportPhone(phone))) {
      throw new AppError(422, "Order details could not be verified. Please check the order number or leave it blank.", "SUPPORT_ORDER_NOT_VERIFIED");
    }
    return order.id;
  }

  async create(input: CreateSupportInput, userId?: string) {
    const result = await this.client.$transaction(async (tx) => {
      const user = userId ? await tx.user.findUnique({ where: { id: userId }, select: { firstName: true, lastName: true, phone: true, email: true } }) : null;
      if (userId && !user) throw missing();
      const name = (input.name?.trim() || (user ? `${user.firstName} ${user.lastName}`.trim() : "")) || "Customer";
      const phone = (input.phone?.trim() || user?.phone || "").trim();
      if (!name || !phone || normalizedSupportPhone(phone).length < 7) throw new AppError(422, "Name and phone are required", "SUPPORT_CONTACT_REQUIRED");
      const orderId = await this.linkedOrder(tx, input, userId, phone);
      const rawToken = userId ? null : supportToken();
      const now = new Date();
      const conversation = await tx.supportConversation.create({
        data: {
          reference: `SUP-${randomUUID().replaceAll("-", "").slice(0, 24).toUpperCase()}`,
          userId, guestName: name, guestPhone: phone, guestEmail: input.email?.trim() || user?.email || null,
          orderId, guestAccessTokenHash: rawToken ? supportTokenHash(rawToken) : null,
          adminUnreadCount: 1, lastMessageAt: now, createdAt: now,
        }, select: supportConversationSelect,
      });
      const message = await tx.supportMessage.create({ data: { conversationId: conversation.id, senderType: "CUSTOMER", senderUserId: userId, body: input.message, createdAt: now }, select: supportMessageSelect });
      await enqueueNotification(tx, { audience: "ADMIN", recipientPermission: PERMISSIONS.SUPPORT_READ_ANY,
        type: "SUPPORT_REQUEST", entityType: "SUPPORT_MESSAGE", entityId: message.id,
        templateParams: { reference: conversation.reference }, metadata: { conversationId: conversation.id },
        deduplicationKey: `support:${conversation.id}:admin:0`, createdAt: now });
      return { conversation, message, rawToken };
    }, { maxWait: 15000, timeout: 30000 });
    const payload = customerConversationDto(result.conversation);
    const message = supportMessageDto(result.message, result.conversation.guestName);
    supportHub.created(adminConversationDto(result.conversation));
    supportHub.message(result.conversation.id, message);
    return { ...payload, initialMessage: message, ...(result.rawToken ? { supportAccessToken: result.rawToken } : {}) };
  }

  async authorized(conversationId: string, actor: SupportActor) {
    const conversation = await this.client.supportConversation.findUnique({ where: { id: conversationId }, select: { ...supportConversationSelect, guestAccessTokenHash: true } });
    if (!conversation || (actor.userId ? conversation.userId !== actor.userId : conversation.userId !== null || !validSupportToken(actor.guestToken, conversation.guestAccessTokenHash))) throw missing();
    return conversation;
  }

  async get(conversationId: string, actor: SupportActor) { return customerConversationDto(await this.authorized(conversationId, actor)); }
  async getAdmin(conversationId: string) {
    const item = await this.client.supportConversation.findUnique({ where: { id: conversationId }, select: supportConversationSelect });
    if (!item) throw missing();
    return adminConversationDto(item);
  }

  async listOwn(userId: string, query: SupportPage) {
    const where = { userId };
    const [items, total] = await this.client.$transaction([
      this.client.supportConversation.findMany({ where, orderBy: [{ lastMessageAt: "desc" }, { id: "desc" }], skip: (query.page - 1) * query.limit, take: query.limit, select: supportConversationSelect }),
      this.client.supportConversation.count({ where }),
    ]);
    return { items: items.map(customerConversationDto), pagination: { ...query, total, totalPages: Math.ceil(total / query.limit) } };
  }

  async listAdmin(query: SupportAdminList) {
    const where: Prisma.SupportConversationWhereInput = {
      status: query.status,
      adminUnreadCount: query.unreadOnly ? { gt: 0 } : undefined,
      OR: query.search ? [
        { reference: { contains: query.search, mode: "insensitive" } },
        { guestName: { contains: query.search, mode: "insensitive" } },
        { guestPhone: { contains: query.search } },
        { order: { orderNumber: { contains: query.search, mode: "insensitive" } } },
      ] : undefined,
    };
    const [items, total] = await this.client.$transaction([
      this.client.supportConversation.findMany({ where, orderBy: [{ lastMessageAt: "desc" }, { id: "desc" }], skip: (query.page - 1) * query.limit, take: query.limit,
        select: { ...supportConversationSelect, messages: { orderBy: [{ createdAt: "desc" as const }, { id: "desc" as const }], take: 1, select: { body: true } } } }),
      this.client.supportConversation.count({ where }),
    ]);
    return { items: items.map((item) => ({ ...adminConversationDto(item), lastMessagePreview: item.messages[0]?.body.slice(0, 160) ?? null })), pagination: { page: query.page, limit: query.limit, total, totalPages: Math.ceil(total / query.limit) } };
  }

  async messages(conversationId: string, query: SupportPage, actor?: SupportActor) {
    const conversation = actor ? await this.authorized(conversationId, actor) : await this.getAdmin(conversationId);
    const customerName = "guestName" in conversation ? conversation.guestName : conversation.customer.name;
    const where = { conversationId };
    const [items, total] = await this.client.$transaction([
      this.client.supportMessage.findMany({ where, orderBy: [{ createdAt: "asc" }, { id: "asc" }], skip: (query.page - 1) * query.limit, take: query.limit, select: supportMessageSelect }),
      this.client.supportMessage.count({ where }),
    ]);
    return { items: items.map((item) => supportMessageDto(item, customerName)), pagination: { ...query, total, totalPages: Math.ceil(total / query.limit) } };
  }

  private async locked(tx: Prisma.TransactionClient, conversationId: string) {
    await tx.$queryRaw`SELECT "id" FROM "support_conversations" WHERE "id" = ${conversationId}::uuid FOR UPDATE`;
    const conversation = await tx.supportConversation.findUnique({ where: { id: conversationId }, select: { ...supportConversationSelect, guestAccessTokenHash: true, adminNotificationGeneration: true } });
    if (!conversation) throw missing();
    return conversation;
  }

  async send(conversationId: string, body: string, actor: SupportActor | { adminId: string }) {
    const adminId = "adminId" in actor ? actor.adminId : undefined;
    const customerActor = "adminId" in actor ? null : actor;
    const result = await this.client.$transaction(async (tx) => {
      const current = await this.locked(tx, conversationId);
      if (customerActor && (customerActor.userId ? current.userId !== customerActor.userId : current.userId !== null || !validSupportToken(customerActor.guestToken, current.guestAccessTokenHash))) throw missing();
      if (!adminId && current.status === "CLOSED") throw new AppError(409, "Conversation is closed", "SUPPORT_CONVERSATION_CLOSED");
      if (adminId && current.status === "CLOSED") throw new AppError(409, "Reopen the conversation before replying", "SUPPORT_CONVERSATION_CLOSED");
      const now = new Date();
      const message = await tx.supportMessage.create({ data: { conversationId, senderType: adminId ? "ADMIN" : "CUSTOMER", senderUserId: adminId ?? customerActor?.userId, body, createdAt: now }, select: supportMessageSelect });
      const updated = await tx.supportConversation.update({ where: { id: conversationId }, data: adminId ? {
        customerUnreadCount: { increment: 1 }, lastMessageAt: now, status: "PENDING",
      } : { adminUnreadCount: { increment: 1 }, lastMessageAt: now, status: "OPEN" }, select: supportConversationSelect });
      if (!adminId && current.adminUnreadCount === 0) await enqueueNotification(tx, {
        audience: "ADMIN", recipientPermission: PERMISSIONS.SUPPORT_READ_ANY, type: "SUPPORT_REQUEST",
        entityType: "SUPPORT_MESSAGE", entityId: message.id, templateParams: { reference: current.reference }, metadata: { conversationId },
        deduplicationKey: `support:${conversationId}:admin:${current.adminNotificationGeneration}`, createdAt: now,
      });
      return { message, updated };
    }, { maxWait: 15000, timeout: 30000 });
    const message = supportMessageDto(result.message, result.updated.guestName);
    supportHub.message(conversationId, message);
    if (!adminId) supportHub.updated(adminConversationDto(result.updated));
    return message;
  }

  async read(conversationId: string, actor: SupportActor | { adminId: string }) {
    const isAdmin = "adminId" in actor;
    const updated = await this.client.$transaction(async (tx) => {
      const current = await this.locked(tx, conversationId);
      if (!isAdmin && (actor.userId ? current.userId !== actor.userId : current.userId !== null || !validSupportToken(actor.guestToken, current.guestAccessTokenHash))) throw missing();
      const now = new Date();
      return tx.supportConversation.update({ where: { id: conversationId }, data: isAdmin ? {
        adminUnreadCount: 0, adminLastReadAt: now,
        ...(current.adminUnreadCount > 0 ? { adminNotificationGeneration: { increment: 1 } } : {}),
      } : { customerUnreadCount: 0, customerLastReadAt: now }, select: supportConversationSelect });
    }, { maxWait: 15000, timeout: 30000 });
    supportHub.read(conversationId, { adminUnreadCount: updated.adminUnreadCount, customerUnreadCount: updated.customerUnreadCount });
    return isAdmin ? adminConversationDto(updated) : customerConversationDto(updated);
  }

  async status(conversationId: string, status: "OPEN" | "PENDING" | "CLOSED") {
    const updated = await this.client.$transaction(async (tx) => {
      const current = await this.locked(tx, conversationId);
      if (current.status === "CLOSED" && status === "PENDING") throw new AppError(409, "Reopen before marking pending", "SUPPORT_INVALID_STATUS_TRANSITION");
      return tx.supportConversation.update({ where: { id: conversationId }, data: { status, closedAt: status === "CLOSED" ? new Date() : null }, select: supportConversationSelect });
    }, { maxWait: 15000, timeout: 30000 });
    const payload = adminConversationDto(updated);
    supportHub.status(conversationId, { status: updated.status, closedAt: payload.closedAt });
    return payload;
  }
}
