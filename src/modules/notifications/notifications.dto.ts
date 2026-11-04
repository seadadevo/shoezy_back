import type { Prisma } from "@prisma/client";
import type { NotificationRecord } from "./notifications.types";
import { renderNotification, type SupportedLocale } from "./notifications.templates";

function stringParams(value: Prisma.JsonValue): Record<string, string> {
  if (!value || Array.isArray(value) || typeof value !== "object") return {};
  return Object.fromEntries(Object.entries(value).filter((entry): entry is [string, string | number | boolean] => ["string", "number", "boolean"].includes(typeof entry[1])).map(([key, item]) => [key, String(item)]));
}

export function toNotificationDto(notification: NotificationRecord, locale: SupportedLocale) {
  const templateParams = stringParams(notification.templateParams);
  return {
    id: notification.id,
    type: notification.type,
    entityType: notification.entityType,
    entityId: notification.entityId,
    templateKey: notification.templateKey,
    templateParams,
    ...renderNotification(notification.templateKey, templateParams, locale),
    metadata: notification.metadata,
    readAt: notification.readAt?.toISOString() ?? null,
    createdAt: notification.createdAt.toISOString(),
    updatedAt: notification.updatedAt.toISOString(),
  };
}

export type NotificationDto = ReturnType<typeof toNotificationDto>;
