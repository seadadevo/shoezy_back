import { randomUUID } from "node:crypto";
import { Prisma, type PrismaClient } from "@prisma/client";
import { prisma } from "../../config/database";
import { AuditLogService } from "../admin-audit/audit-log.service";
import { POSTGRES_INT_MAX } from "../../common/validation/postgres-int";
import { isSerializableTransactionConflict } from "../../common/utils/prisma-transaction";
import { returnSelect } from "./returns.types";
import type { CreateReturnInput, ListAdminReturnsQuery, ListOwnReturnsQuery, ReceiveReturnInput } from "./returns.validation";
import { recordStockMovement } from "../inventory/inventory.repository";
import { PERMISSIONS } from "../../common/auth/rbac.constants";
import { enqueueNotification } from "../notifications/notifications.outbox";

const returnNumber = () => `RET-${randomUUID().replaceAll("-", "").slice(0, 32).toUpperCase()}`;
class ReturnAbort extends Error {}

export class ReturnsRepository {
  constructor(private readonly client: PrismaClient = prisma) {}

  private async serializable<T>(operation: (transaction: Prisma.TransactionClient) => Promise<T>): Promise<T> {
    for (let attempt = 1; attempt <= 3; attempt += 1) {
      try { return await this.client.$transaction(operation, { isolationLevel: "Serializable" }); }
      catch (error: unknown) { if (!isSerializableTransactionConflict(error) || attempt === 3) throw error; }
    }
    throw new Error("Serializable retry exhausted");
  }

  create(userId: string, orderId: string, input: CreateReturnInput, now: Date) {
    return this.serializable(async (transaction) => {
      await transaction.$queryRaw`SELECT "id" FROM "orders" WHERE "id" = ${orderId}::uuid FOR UPDATE`;
      const order = await transaction.order.findFirst({ where: { id: orderId, userId, status: "DELIVERED" }, select: { items: { select: { id: true, quantity: true } } } });
      if (!order) return "ORDER_NOT_ELIGIBLE" as const;
      const purchased = new Map(order.items.map((item) => [item.id, item.quantity]));
      if (input.items.some((item) => !purchased.has(item.orderItemId))) return "ITEM_NOT_FOUND" as const;
      const orderItemIds = input.items.map((item) => item.orderItemId);
      const prior = await transaction.returnItem.groupBy({
        by: ["orderItemId"],
        where: { orderItemId: { in: orderItemIds }, returnRequest: { status: { in: ["REQUESTED", "APPROVED", "RECEIVED_AND_REFUNDED"] } } },
        _sum: { quantity: true },
      });
      const used = new Map(prior.map((item) => [item.orderItemId, item._sum.quantity ?? 0]));
      const priorExchanges = await transaction.exchangeItem.groupBy({
        by: ["orderItemId"],
        where: { orderItemId: { in: orderItemIds }, exchangeRequest: { status: { in: ["REQUESTED", "APPROVED", "COMPLETED"] } } },
        _sum: { quantity: true },
      });
      for (const item of priorExchanges) used.set(item.orderItemId, (used.get(item.orderItemId) ?? 0) + (item._sum.quantity ?? 0));
      if (input.items.some((item) => (used.get(item.orderItemId) ?? 0) + item.quantity > purchased.get(item.orderItemId)!)) return "QUANTITY_EXCEEDED" as const;
      const value = await transaction.returnRequest.create({
        data: { returnNumber: returnNumber(), orderId, userId, status: "REQUESTED", reasonCode: input.reasonCode, reasonDetails: input.reasonDetails, requestedAt: now, items: { create: input.items } },
        select: returnSelect,
      });
      await enqueueNotification(transaction, {
        audience: "ADMIN", recipientPermission: PERMISSIONS.RETURNS_READ_ANY, type: "RETURN_REQUESTED", entityType: "RETURN", entityId: value.id,
        templateParams: { returnNumber: value.returnNumber }, metadata: { returnId: value.id, orderId }, deduplicationKey: `return:${value.id}:requested:admin`, createdAt: now,
      });
      return value;
    });
  }

  async listOwn(userId: string, query: ListOwnReturnsQuery) {
    const where = { userId };
    const [items, total] = await this.client.$transaction([
      this.client.returnRequest.findMany({ where, skip: (query.page - 1) * query.limit, take: query.limit, orderBy: [{ createdAt: "desc" }, { id: "desc" }], select: returnSelect }),
      this.client.returnRequest.count({ where }),
    ]);
    return { items, total };
  }

  findOwn(userId: string, returnId: string) { return this.client.returnRequest.findFirst({ where: { id: returnId, userId }, select: returnSelect }); }

  async listAny(query: ListAdminReturnsQuery) {
    const where = { status: query.status, orderId: query.orderId };
    const [items, total] = await this.client.$transaction([
      this.client.returnRequest.findMany({ where, skip: (query.page - 1) * query.limit, take: query.limit, orderBy: [{ createdAt: "desc" }, { id: "desc" }], select: returnSelect }),
      this.client.returnRequest.count({ where }),
    ]);
    return { items, total };
  }

  findAny(returnId: string) { return this.client.returnRequest.findUnique({ where: { id: returnId }, select: returnSelect }); }

  decide(returnId: string, status: "APPROVED" | "REJECTED", now: Date, actorId?: string) {
    return this.serializable(async (transaction) => {
      await transaction.$queryRaw`SELECT "id" FROM "return_requests" WHERE "id" = ${returnId}::uuid FOR UPDATE`;
      const current = await transaction.returnRequest.findUnique({ where: { id: returnId }, select: { status: true, userId: true, returnNumber: true } });
      if (!current) return { kind: "NOT_FOUND" as const };
      if (current.status === status) return { kind: "REPLAYED" as const, value: await transaction.returnRequest.findUniqueOrThrow({ where: { id: returnId }, select: returnSelect }) };
      if (current.status !== "REQUESTED") return { kind: "INVALID" as const };
      const value = await transaction.returnRequest.update({ where: { id: returnId }, data: { status, closedAt: status === "REJECTED" ? now : null }, select: returnSelect });
      if (actorId) await new AuditLogService().record({ actorUserId: actorId, action: `RETURN_${status}`, entityType: "RETURN", entityId: returnId, metadata: { status: { from: current.status, to: status } } }, transaction);
      if (current.userId) await enqueueNotification(transaction, {
        audience: "USER", recipientUserId: current.userId, type: "RETURN_STATUS_UPDATED", entityType: "RETURN", entityId: returnId,
        templateParams: { returnNumber: current.returnNumber, status }, metadata: { returnId }, deduplicationKey: `return:${returnId}:${status.toLowerCase()}:customer`, createdAt: now,
      });
      return { kind: "UPDATED" as const, value };
    });
  }

  async receive(actorId: string, returnId: string, input: ReceiveReturnInput, now: Date) {
    try {
      return await this.serializable(async (transaction) => {
        await transaction.$queryRaw`SELECT "id" FROM "return_requests" WHERE "id" = ${returnId}::uuid FOR UPDATE`;
        const current = await transaction.returnRequest.findUnique({
          where: { id: returnId },
          select: { status: true, orderId: true, userId: true, returnNumber: true, items: { select: { id: true, orderItemId: true, quantity: true, orderItem: { select: { variantId: true, lineTotalMinor: true, quantity: true } } } } },
        });
        if (!current) return { kind: "NOT_FOUND" as const };
        if (current.status === "RECEIVED_AND_REFUNDED") return { kind: "REPLAYED" as const, value: await transaction.returnRequest.findUniqueOrThrow({ where: { id: returnId }, select: returnSelect }) };
        if (current.status !== "APPROVED") return { kind: "INVALID" as const };
        await transaction.$queryRaw`SELECT "id" FROM "orders" WHERE "id" = ${current.orderId}::uuid FOR UPDATE`;
        const orderBeforeReceipt = await transaction.order.findUniqueOrThrow({
          where: { id: current.orderId },
          select: { paidMinor: true, refundedMinor: true },
        });
        if (input.restockableItemIds.some((itemId) => !current.items.some((item) => item.id === itemId))) return { kind: "ITEM_NOT_FOUND" as const };
        const restockable = new Set(input.restockableItemIds);
        const itemsToRestock = current.items.filter((item) => restockable.has(item.id)).sort((left, right) => left.orderItem.variantId.localeCompare(right.orderItem.variantId));
        for (const item of itemsToRestock) {
          const updated = await transaction.productVariant.updateMany({ where: { id: item.orderItem.variantId, stockQuantity: { lte: POSTGRES_INT_MAX - item.quantity } }, data: { stockQuantity: { increment: item.quantity } } });
          if (updated.count !== 1) throw new ReturnAbort("Inventory restore overflow");
          const afterQuantity = (await transaction.productVariant.findUniqueOrThrow({ where: { id: item.orderItem.variantId }, select: { stockQuantity: true } })).stockQuantity;
          await recordStockMovement(transaction, { variantId: item.orderItem.variantId, type: "RETURN_RESTOCK", beforeQuantity: afterQuantity - item.quantity, afterQuantity, referenceType: "RETURN", referenceId: returnId, actorUserId: actorId, createdAt: now });
        }
        const currentOrderItemIds = current.items.map((item) => item.orderItemId);
        const priorTerminalItems = await transaction.returnItem.findMany({
          where: {
            orderItemId: { in: currentOrderItemIds },
            returnRequest: { status: "RECEIVED_AND_REFUNDED" },
          },
          select: { orderItemId: true, quantity: true },
        });
        const priorByOrderItem = new Map<string, { quantity: number; refundedMinor: bigint }>();
        for (const priorItem of priorTerminalItems) {
          const orderItem = current.items.find((item) => item.orderItemId === priorItem.orderItemId)?.orderItem;
          if (!orderItem) continue;
          const prior = priorByOrderItem.get(priorItem.orderItemId) ?? { quantity: 0, refundedMinor: 0n };
          prior.quantity += priorItem.quantity;
          prior.refundedMinor += orderItem.lineTotalMinor * BigInt(priorItem.quantity) / BigInt(orderItem.quantity);
          priorByOrderItem.set(priorItem.orderItemId, prior);
        }
        const allocatedRefundMinor = current.items.reduce((sum, item) => {
          const prior = priorByOrderItem.get(item.orderItemId) ?? { quantity: 0, refundedMinor: 0n };
          const completesOrderItem = prior.quantity + item.quantity >= item.orderItem.quantity;
          const contribution = completesOrderItem
            ? item.orderItem.lineTotalMinor - prior.refundedMinor
            : item.orderItem.lineTotalMinor * BigInt(item.quantity) / BigInt(item.orderItem.quantity);
          return sum + (contribution > 0n ? contribution : 0n);
        }, 0n);
        await transaction.returnItem.updateMany({ where: { returnRequestId: returnId }, data: { restockable: false } });
        if (restockable.size) await transaction.returnItem.updateMany({ where: { returnRequestId: returnId, id: { in: [...restockable] } }, data: { restockable: true } });
        await transaction.returnRequest.update({ where: { id: returnId }, data: { status: "RECEIVED_AND_REFUNDED", refundMethod: input.refundMethod, refundProofUrl: input.refundProofUrl, closedAt: now } });
        const [orderItems, completed] = await Promise.all([
          transaction.orderItem.findMany({ where: { orderId: current.orderId }, select: { id: true, quantity: true, lineTotalMinor: true } }),
          transaction.returnItem.groupBy({ by: ["orderItemId"], where: { orderItem: { orderId: current.orderId }, returnRequest: { status: "RECEIVED_AND_REFUNDED" } }, _sum: { quantity: true } }),
        ]);
        const completedByItem = new Map(completed.map((item) => [item.orderItemId, item._sum.quantity ?? 0]));
        const fullyReturned = orderItems.every((item) => (completedByItem.get(item.id) ?? 0) >= item.quantity);
        const merchandiseTotalMinor = orderItems.reduce((sum, item) => sum + item.lineTotalMinor, 0n);
        const merchandiseRemainderMinor = merchandiseTotalMinor > orderBeforeReceipt.refundedMinor
          ? merchandiseTotalMinor - orderBeforeReceipt.refundedMinor
          : 0n;
        const paidRemainderMinor = orderBeforeReceipt.paidMinor > orderBeforeReceipt.refundedMinor
          ? orderBeforeReceipt.paidMinor - orderBeforeReceipt.refundedMinor
          : 0n;
        const refundAmountMinor = [allocatedRefundMinor, merchandiseRemainderMinor, paidRemainderMinor]
          .reduce((minimum, amount) => amount < minimum ? amount : minimum);
        const value = await transaction.returnRequest.update({
          where: { id: returnId },
          data: { refundAmountMinor },
          select: returnSelect,
        });
        await transaction.order.update({ where: { id: current.orderId }, data: { refundedMinor: { increment: refundAmountMinor }, ...(fullyReturned ? { status: "RETURNED" as const } : {}), version: { increment: 1 } } });
        if (fullyReturned) {
          await transaction.orderStatusHistory.create({
            data: {
              orderId: current.orderId,
              fromStatus: "DELIVERED",
              toStatus: "RETURNED",
              reason: `Full return ${returnId} received`,
              changedByUserId: actorId,
              createdAt: now,
            },
          });
        }
        await new AuditLogService().record({ actorUserId: actorId, action: "RETURN_RECEIVED", entityType: "RETURN", entityId: returnId, metadata: { status: { from: current.status, to: "RECEIVED_AND_REFUNDED" } } }, transaction);
        if (current.userId) await enqueueNotification(transaction, {
          audience: "USER", recipientUserId: current.userId, type: "RETURN_STATUS_UPDATED", entityType: "RETURN", entityId: returnId,
          templateParams: { returnNumber: current.returnNumber, status: "RECEIVED_AND_REFUNDED" }, metadata: { returnId }, deduplicationKey: `return:${returnId}:received_and_refunded:customer`, createdAt: now,
        });
        return { kind: "UPDATED" as const, value };
      });
    } catch (error: unknown) {
      if (error instanceof ReturnAbort) return { kind: "OVERFLOW" as const };
      throw error;
    }
  }
}
