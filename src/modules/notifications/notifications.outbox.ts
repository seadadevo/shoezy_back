import { Prisma, type NotificationAudience, type NotificationType } from "@prisma/client";
import type { PermissionCode } from "../../common/auth/rbac.constants";

export type NotificationOutboxInput = {
  audience: NotificationAudience;
  recipientUserId?: string;
  recipientPermission?: PermissionCode;
  type: NotificationType;
  entityType: string;
  entityId: string;
  templateKey?: string;
  templateParams: Prisma.InputJsonObject;
  metadata?: Prisma.InputJsonObject;
  deduplicationKey: string;
  createdAt?: Date;
};

export async function enqueueNotification(transaction: Prisma.TransactionClient, input: NotificationOutboxInput) {
  await transaction.notificationOutbox.upsert({
    where: { deduplicationKey: input.deduplicationKey },
    create: {
      audience: input.audience,
      recipientUserId: input.recipientUserId,
      recipientPermission: input.recipientPermission,
      type: input.type,
      entityType: input.entityType,
      entityId: input.entityId,
      templateKey: input.templateKey ?? input.type,
      templateParams: input.templateParams,
      metadata: input.metadata,
      deduplicationKey: input.deduplicationKey,
      createdAt: input.createdAt,
      availableAt: input.createdAt,
    },
    update: {},
  });
}
