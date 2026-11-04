import { Prisma, type NotificationType, type PrismaClient } from "@prisma/client";
import { prisma } from "../../config/database";
import { notificationSelect } from "./notifications.types";
import type { ListNotificationsQuery } from "./notifications.validation";

export class NotificationsRepository {
  constructor(private readonly client: PrismaClient = prisma) {}

  async list(userId: string, query: ListNotificationsQuery) {
    const where: Prisma.NotificationWhereInput = {
      recipientUserId: userId,
      readAt: query.unreadOnly ? null : undefined,
      type: query.type as NotificationType | undefined,
    };
    const [items, total] = await this.client.$transaction([
      this.client.notification.findMany({ where, skip: (query.page - 1) * query.limit, take: query.limit, orderBy: [{ createdAt: "desc" }, { id: "desc" }], select: notificationSelect }),
      this.client.notification.count({ where }),
    ]);
    return { items, total };
  }

  unreadCount(userId: string) { return this.client.notification.count({ where: { recipientUserId: userId, readAt: null } }); }

  async markRead(userId: string, notificationId: string, now: Date) {
    const updated = await this.client.notification.updateMany({ where: { id: notificationId, recipientUserId: userId }, data: { readAt: now } });
    if (updated.count !== 1) return null;
    return this.client.notification.findUnique({ where: { id: notificationId }, select: notificationSelect });
  }

  async markAllRead(userId: string, now: Date) {
    const result = await this.client.notification.updateMany({ where: { recipientUserId: userId, readAt: null }, data: { readAt: now } });
    return result.count;
  }

  async delete(userId: string, notificationId: string) {
    const result = await this.client.notification.deleteMany({ where: { id: notificationId, recipientUserId: userId } });
    return result.count === 1;
  }
}
