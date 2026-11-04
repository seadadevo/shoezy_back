import { Prisma } from "@prisma/client";

export const notificationSelect = {
  id: true,
  recipientUserId: true,
  type: true,
  entityType: true,
  entityId: true,
  templateKey: true,
  templateParams: true,
  metadata: true,
  readAt: true,
  createdAt: true,
  updatedAt: true,
} satisfies Prisma.NotificationSelect;

export type NotificationRecord = Prisma.NotificationGetPayload<{ select: typeof notificationSelect }>;
