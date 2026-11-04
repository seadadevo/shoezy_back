import { randomUUID } from "node:crypto";
import { Prisma, type PrismaClient } from "@prisma/client";
import { prisma } from "../../config/database";
import { AuditLogService } from "../admin-audit/audit-log.service";
import { POSTGRES_INT_MAX } from "../../common/validation/postgres-int";
import { isSerializableTransactionConflict } from "../../common/utils/prisma-transaction";
import { recordStockMovement } from "../inventory/inventory.repository";
import { exchangeSelect } from "./exchanges.types";
import type { CreateExchangeInput, ListAdminExchangesQuery, ListOwnExchangesQuery } from "./exchanges.validation";
import { PERMISSIONS } from "../../common/auth/rbac.constants";
import { enqueueNotification } from "../notifications/notifications.outbox";

class ExchangeAbort extends Error { constructor(public readonly kind: "INSUFFICIENT_STOCK" | "RESTORE_OVERFLOW") { super(kind); } }
const exchangeNumber = () => `EXC-${randomUUID().replaceAll("-", "").slice(0, 32).toUpperCase()}`;
export class ExchangesRepository {
  constructor(private readonly client: PrismaClient = prisma) {}
  private async serializable<T>(operation: (tx: Prisma.TransactionClient) => Promise<T>): Promise<T> {
    for (let attempt = 1; attempt <= 3; attempt += 1) {
      try { return await this.client.$transaction(operation, { isolationLevel: "Serializable" }); }
      catch (error: unknown) { if (!isSerializableTransactionConflict(error) || attempt === 3) throw error; }
    }
    throw new Error("Serializable retry exhausted");
  }
  create(userId: string, orderId: string, input: CreateExchangeInput, now: Date) {
    return this.serializable(async (tx) => {
      await tx.$queryRaw`SELECT "id" FROM "orders" WHERE "id" = ${orderId}::uuid FOR UPDATE`;
      const order = await tx.order.findFirst({ where: { id: orderId, userId, status: "DELIVERED" }, select: { items: { select: { id: true, productId: true, variantId: true, quantity: true, unitPriceMinor: true } }, statusHistory: { where: { toStatus: "DELIVERED" }, orderBy: { createdAt: "desc" }, take: 1, select: { createdAt: true } } } });
      if (!order) return "ORDER_NOT_ELIGIBLE" as const;
      const settings = await tx.storeSettings.findUnique({ where: { id: 1 }, select: { exchangeWindowDays: true } });
      const deliveredAt = order.statusHistory[0]?.createdAt;
      if (!deliveredAt || now.getTime() - deliveredAt.getTime() > (settings?.exchangeWindowDays ?? 14) * 86_400_000) return "WINDOW_EXPIRED" as const;
      const original = order.items.find((item) => item.id === input.orderItemId);
      if (!original) return "ITEM_NOT_FOUND" as const;
      const replacement = await tx.productVariant.findFirst({ where: { id: input.replacementVariantId, isActive: true, deletedAt: null }, select: { id: true, productId: true, priceMinor: true } });
      if (!replacement || replacement.productId !== original.productId) return "VARIANT_INVALID" as const;
      if (replacement.id === original.variantId) return "SAME_VARIANT" as const;
      if (replacement.priceMinor !== original.unitPriceMinor) return "PRICE_MISMATCH" as const;
      const [returns, exchanges] = await Promise.all([
        tx.returnItem.aggregate({ where: { orderItemId: original.id, returnRequest: { status: { in: ["REQUESTED", "APPROVED", "RECEIVED_AND_REFUNDED"] } } }, _sum: { quantity: true } }),
        tx.exchangeItem.aggregate({ where: { orderItemId: original.id, exchangeRequest: { status: { in: ["REQUESTED", "APPROVED", "COMPLETED"] } } }, _sum: { quantity: true } }),
      ]);
      if ((returns._sum.quantity ?? 0) + (exchanges._sum.quantity ?? 0) + input.quantity > original.quantity) return "QUANTITY_EXCEEDED" as const;
      const value = await tx.exchangeRequest.create({ data: { exchangeNumber: exchangeNumber(), orderId, userId, status: "REQUESTED", reason: input.reason, requestedAt: now, item: { create: { orderItemId: original.id, replacementVariantId: replacement.id, quantity: input.quantity } } }, select: exchangeSelect });
      await enqueueNotification(tx, {
        audience: "ADMIN", recipientPermission: PERMISSIONS.EXCHANGES_READ_ANY, type: "EXCHANGE_REQUESTED", entityType: "EXCHANGE", entityId: value.id,
        templateParams: { exchangeNumber: value.exchangeNumber }, metadata: { exchangeId: value.id, orderId }, deduplicationKey: `exchange:${value.id}:requested:admin`, createdAt: now,
      });
      return value;
    });
  }
  async listOwn(userId: string, query: ListOwnExchangesQuery) {
    const where = { userId };
    const [items, total] = await this.client.$transaction([this.client.exchangeRequest.findMany({ where, skip: (query.page - 1) * query.limit, take: query.limit, orderBy: [{ createdAt: "desc" }, { id: "desc" }], select: exchangeSelect }), this.client.exchangeRequest.count({ where })]);
    return { items, total };
  }
  findOwn(userId: string, exchangeId: string) { return this.client.exchangeRequest.findFirst({ where: { id: exchangeId, userId }, select: exchangeSelect }); }
  async listAny(query: ListAdminExchangesQuery) {
    const where = { status: query.status, orderId: query.orderId };
    const [items, total] = await this.client.$transaction([this.client.exchangeRequest.findMany({ where, skip: (query.page - 1) * query.limit, take: query.limit, orderBy: [{ createdAt: "desc" }, { id: "desc" }], select: exchangeSelect }), this.client.exchangeRequest.count({ where })]);
    return { items, total };
  }
  findAny(exchangeId: string) { return this.client.exchangeRequest.findUnique({ where: { id: exchangeId }, select: exchangeSelect }); }
  decide(exchangeId: string, status: "APPROVED" | "REJECTED", now: Date, actorId?: string) {
    return this.serializable(async (tx) => {
      await tx.$queryRaw`SELECT "id" FROM "exchange_requests" WHERE "id" = ${exchangeId}::uuid FOR UPDATE`;
      const current = await tx.exchangeRequest.findUnique({ where: { id: exchangeId }, select: { status: true, userId: true, exchangeNumber: true } });
      if (!current) return { kind: "NOT_FOUND" as const };
      if (current.status === status) return { kind: "REPLAYED" as const, value: await tx.exchangeRequest.findUniqueOrThrow({ where: { id: exchangeId }, select: exchangeSelect }) };
      if (current.status !== "REQUESTED") return { kind: "INVALID" as const };
      const value = await tx.exchangeRequest.update({ where: { id: exchangeId }, data: { status, closedAt: status === "REJECTED" ? now : null }, select: exchangeSelect });
      if (actorId) await new AuditLogService().record({ actorUserId: actorId, action: `EXCHANGE_${status}`, entityType: "EXCHANGE", entityId: exchangeId, metadata: { status: { from: current.status, to: status } } }, tx);
      await enqueueNotification(tx, {
        audience: "USER", recipientUserId: current.userId, type: "EXCHANGE_STATUS_UPDATED", entityType: "EXCHANGE", entityId: exchangeId,
        templateParams: { exchangeNumber: current.exchangeNumber, status }, metadata: { exchangeId }, deduplicationKey: `exchange:${exchangeId}:${status.toLowerCase()}:customer`, createdAt: now,
      });
      return { kind: "UPDATED" as const, value };
    });
  }
  async complete(actorId: string, exchangeId: string, now: Date) {
    try {
      return await this.serializable(async (tx) => {
        await tx.$queryRaw`SELECT "id" FROM "exchange_requests" WHERE "id" = ${exchangeId}::uuid FOR UPDATE`;
        const current = await tx.exchangeRequest.findUnique({ where: { id: exchangeId }, select: { status: true, userId: true, exchangeNumber: true, item: { select: { quantity: true, replacementVariantId: true, orderItem: { select: { variantId: true } } } } } });
        if (!current) return { kind: "NOT_FOUND" as const };
        if (current.status === "COMPLETED") return { kind: "REPLAYED" as const, value: await tx.exchangeRequest.findUniqueOrThrow({ where: { id: exchangeId }, select: exchangeSelect }) };
        if (current.status !== "APPROVED" || !current.item) return { kind: "INVALID" as const };
        const { quantity, replacementVariantId } = current.item;
        const originalVariantId = current.item.orderItem.variantId;
        for (const variantId of [originalVariantId, replacementVariantId].sort()) {
          if (variantId === originalVariantId) {
            const updated = await tx.productVariant.updateMany({ where: { id: variantId, stockQuantity: { lte: POSTGRES_INT_MAX - quantity } }, data: { stockQuantity: { increment: quantity } } });
            if (updated.count !== 1) throw new ExchangeAbort("RESTORE_OVERFLOW");
            const afterQuantity = (await tx.productVariant.findUniqueOrThrow({ where: { id: variantId }, select: { stockQuantity: true } })).stockQuantity;
            await recordStockMovement(tx, { variantId, type: "EXCHANGE_RETURNED", beforeQuantity: afterQuantity - quantity, afterQuantity, referenceType: "EXCHANGE", referenceId: exchangeId, actorUserId: actorId, createdAt: now });
          } else {
            const updated = await tx.productVariant.updateMany({ where: { id: variantId, stockQuantity: { gte: quantity }, isActive: true, deletedAt: null }, data: { stockQuantity: { decrement: quantity } } });
            if (updated.count !== 1) throw new ExchangeAbort("INSUFFICIENT_STOCK");
            const afterQuantity = (await tx.productVariant.findUniqueOrThrow({ where: { id: variantId }, select: { stockQuantity: true } })).stockQuantity;
            await recordStockMovement(tx, { variantId, type: "EXCHANGE_REPLACEMENT", beforeQuantity: afterQuantity + quantity, afterQuantity, referenceType: "EXCHANGE", referenceId: exchangeId, actorUserId: actorId, createdAt: now });
          }
        }
        const value = await tx.exchangeRequest.update({ where: { id: exchangeId }, data: { status: "COMPLETED", closedAt: now }, select: exchangeSelect });
        await new AuditLogService().record({ actorUserId: actorId, action: "EXCHANGE_COMPLETED", entityType: "EXCHANGE", entityId: exchangeId, metadata: { status: { from: current.status, to: "COMPLETED" } } }, tx);
        await enqueueNotification(tx, {
          audience: "USER", recipientUserId: current.userId, type: "EXCHANGE_STATUS_UPDATED", entityType: "EXCHANGE", entityId: exchangeId,
          templateParams: { exchangeNumber: current.exchangeNumber, status: "COMPLETED" }, metadata: { exchangeId }, deduplicationKey: `exchange:${exchangeId}:completed:customer`, createdAt: now,
        });
        return { kind: "UPDATED" as const, value };
      });
    } catch (error: unknown) {
      if (error instanceof ExchangeAbort) return error.kind === "INSUFFICIENT_STOCK" ? { kind: "INSUFFICIENT_STOCK" as const } : { kind: "RESTORE_OVERFLOW" as const };
      throw error;
    }
  }
}
