import type { InventoryMovementType, Prisma, PrismaClient } from "@prisma/client";
import { prisma } from "../../config/database";
import type { ListInventoryMovementsQuery } from "./inventory.validation";
import { env } from "../../config/env";
import { PERMISSIONS } from "../../common/auth/rbac.constants";
import { enqueueNotification } from "../notifications/notifications.outbox";

export async function recordStockMovement(transaction: Prisma.TransactionClient, input: { variantId: string; type: InventoryMovementType; beforeQuantity: number; afterQuantity: number; referenceType?: string; referenceId?: string; reason?: string; actorUserId?: string; createdAt?: Date }) {
  if (input.beforeQuantity === input.afterQuantity) return;
  const movement = await transaction.inventoryMovement.create({ data: { ...input, quantityDelta: input.afterQuantity - input.beforeQuantity }, select: { id: true } });
  if (input.beforeQuantity > env.LOW_STOCK_THRESHOLD && input.afterQuantity <= env.LOW_STOCK_THRESHOLD) {
    const variant = await transaction.productVariant.findUniqueOrThrow({ where: { id: input.variantId }, select: { sku: true, productId: true } });
    await enqueueNotification(transaction, {
      audience: "ADMIN",
      recipientPermission: PERMISSIONS.INVENTORY_READ_ANY,
      type: "LOW_STOCK",
      entityType: "PRODUCT_VARIANT",
      entityId: input.variantId,
      templateParams: { sku: variant.sku, stockQuantity: input.afterQuantity },
      metadata: { productId: variant.productId, variantId: input.variantId },
      deduplicationKey: `inventory:${movement.id}:low-stock`,
      createdAt: input.createdAt,
    });
  }
}

export class InventoryRepository {
  constructor(private readonly client: PrismaClient = prisma) {}
  async list(query: ListInventoryMovementsQuery) {
    const where: Prisma.InventoryMovementWhereInput = {
      variantId: query.variantId,
      variant: query.productId ? { productId: query.productId } : undefined,
      type: query.type,
      createdAt: query.from || query.to ? { gte: query.from, lte: query.to } : undefined,
    };
    const [items, total] = await this.client.$transaction([
      this.client.inventoryMovement.findMany({ where, skip: (query.page - 1) * query.limit, take: query.limit, orderBy: [{ createdAt: "desc" }, { id: "desc" }], select: { id: true, variantId: true, type: true, quantityDelta: true, beforeQuantity: true, afterQuantity: true, referenceType: true, referenceId: true, reason: true, actorUserId: true, createdAt: true, variant: { select: { sku: true, title: true, productId: true } } } }),
      this.client.inventoryMovement.count({ where }),
    ]);
    return { items, total };
  }
}
