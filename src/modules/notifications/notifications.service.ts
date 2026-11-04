import { AppError } from "../../common/errors/app-error";
import { notificationHub } from "./notification-hub";
import { toNotificationDto } from "./notifications.dto";
import { NotificationsRepository } from "./notifications.repository";
import type { SupportedLocale } from "./notifications.templates";
import type { ListNotificationsQuery } from "./notifications.validation";

export class NotificationsService {
  constructor(private readonly repository = new NotificationsRepository()) {}

  async list(userId: string, query: ListNotificationsQuery, locale: SupportedLocale) {
    const result = await this.repository.list(userId, query);
    return { items: result.items.map((item) => toNotificationDto(item, locale)), pagination: { page: query.page, limit: query.limit, total: result.total, totalPages: Math.ceil(result.total / query.limit) } };
  }

  async unreadCount(userId: string) { return { count: await this.repository.unreadCount(userId) }; }

  async markRead(userId: string, notificationId: string, locale: SupportedLocale, now = new Date()) {
    const notification = await this.repository.markRead(userId, notificationId, now);
    if (!notification) throw new AppError(404, "Notification not found", "NOTIFICATION_NOT_FOUND");
    const dto = toNotificationDto(notification, locale);
    notificationHub.updated(userId, dto);
    notificationHub.unreadCount(userId, await this.repository.unreadCount(userId));
    return dto;
  }

  async markAllRead(userId: string, now = new Date()) {
    const updatedCount = await this.repository.markAllRead(userId, now);
    notificationHub.unreadCount(userId, 0);
    return { updatedCount };
  }

  async delete(userId: string, notificationId: string) {
    if (!await this.repository.delete(userId, notificationId)) throw new AppError(404, "Notification not found", "NOTIFICATION_NOT_FOUND");
    notificationHub.deleted(userId, notificationId);
    notificationHub.unreadCount(userId, await this.repository.unreadCount(userId));
  }
}
