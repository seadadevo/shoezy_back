import { describe, expect, it, vi } from "vitest";
import type { PrismaClient } from "@prisma/client";
import { ExchangesRepository } from "../../src/modules/exchanges/exchanges.repository";

const orderId = "11111111-1111-4111-8111-111111111111";
const ownerId = "22222222-2222-4222-8222-222222222222";
const itemId = "33333333-3333-4333-8333-333333333333";
const originalId = "44444444-4444-4444-8444-444444444444";
const replacementId = "55555555-5555-4555-8555-555555555555";
const exchangeId = "66666666-6666-4666-8666-666666666666";
const now = new Date("2026-09-20T12:00:00Z");
const input = { orderItemId: itemId, replacementVariantId: replacementId, quantity: 2 };

function creation() {
  const tx = {
    $queryRaw: vi.fn(async () => []),
    order: { findFirst: vi.fn(async () => ({ items: [{ id: itemId, productId: orderId, variantId: originalId, quantity: 3, unitPriceMinor: 12000n }], statusHistory: [{ createdAt: new Date("2026-09-19T12:00:00Z") }] })) },
    storeSettings: { findUnique: vi.fn(async () => ({ exchangeWindowDays: 14 })) },
    productVariant: { findFirst: vi.fn(async () => ({ id: replacementId, productId: orderId, priceMinor: 12000n })) },
    returnItem: { aggregate: vi.fn(async () => ({ _sum: { quantity: 0 } })) },
    exchangeItem: { aggregate: vi.fn(async () => ({ _sum: { quantity: 0 } })) },
    exchangeRequest: { create: vi.fn(async () => ({ id: exchangeId, exchangeNumber: "EXC-1" })) },
    notificationOutbox: { upsert: vi.fn(async () => ({})) },
  };
  const client = { $transaction: vi.fn(async (operation: (value: typeof tx) => Promise<unknown>) => operation(tx)) };
  return { tx, client, repository: new ExchangesRepository(client as unknown as PrismaClient) };
}

describe("size exchange eligibility", () => {
  it("rejects another user's or non-delivered order", async () => {
    const { tx, repository } = creation(); tx.order.findFirst.mockResolvedValue(null as never);
    expect(await repository.create(ownerId, orderId, input, now)).toBe("ORDER_NOT_ELIGIBLE");
  });
  it("rejects a replacement from another product, the same variant, or a price difference", async () => {
    const { tx, repository } = creation();
    tx.productVariant.findFirst.mockResolvedValue({ id: replacementId, productId: ownerId, priceMinor: 12000n });
    expect(await repository.create(ownerId, orderId, input, now)).toBe("VARIANT_INVALID");
    tx.productVariant.findFirst.mockResolvedValue({ id: originalId, productId: orderId, priceMinor: 12000n });
    expect(await repository.create(ownerId, orderId, input, now)).toBe("SAME_VARIANT");
    tx.productVariant.findFirst.mockResolvedValue({ id: replacementId, productId: orderId, priceMinor: 13000n });
    expect(await repository.create(ownerId, orderId, input, now)).toBe("PRICE_MISMATCH");
  });
  it("counts active returns and exchanges before allowing a quantity", async () => {
    const { tx, repository } = creation();
    tx.returnItem.aggregate.mockResolvedValue({ _sum: { quantity: 1 } });
    tx.exchangeItem.aggregate.mockResolvedValue({ _sum: { quantity: 1 } });
    expect(await repository.create(ownerId, orderId, input, now)).toBe("QUANTITY_EXCEEDED");
    expect(tx.exchangeRequest.create).not.toHaveBeenCalled();
  });
  it("creates a request within a serializable transaction", async () => {
    const { tx, client, repository } = creation();
    expect(await repository.create(ownerId, orderId, input, now)).toMatchObject({ id: exchangeId });
    expect(tx.exchangeRequest.create).toHaveBeenCalledOnce();
    expect(client.$transaction).toHaveBeenCalledWith(expect.any(Function), { isolationLevel: "Serializable" });
  });
});

function completion(replacementStock = 4) {
  const stock: Record<string, number> = { [originalId]: 1, [replacementId]: replacementStock };
  const movements: { type: string; beforeQuantity: number; afterQuantity: number }[] = [];
  let status: "APPROVED" | "COMPLETED" = "APPROVED";
  const tx = {
    $queryRaw: vi.fn(async () => []),
    exchangeRequest: {
      findUnique: vi.fn(async () => ({ status, userId: ownerId, exchangeNumber: "EXC-1", item: { quantity: 2, replacementVariantId: replacementId, orderItem: { variantId: originalId } } })),
      findUniqueOrThrow: vi.fn(async () => ({ id: exchangeId, status })),
      update: vi.fn(async () => { status = "COMPLETED"; return { id: exchangeId, status }; }),
    },
    productVariant: {
      updateMany: vi.fn(async ({ where, data }: { where: { id: string }; data: { stockQuantity: { increment?: number; decrement?: number } } }) => {
        const amount = data.stockQuantity.increment ?? data.stockQuantity.decrement ?? 0;
        if (data.stockQuantity.decrement && stock[where.id]! < amount) return { count: 0 };
        stock[where.id] += data.stockQuantity.increment ? amount : -amount;
        return { count: 1 };
      }),
      findUniqueOrThrow: vi.fn(async ({ where }: { where: { id: string } }) => ({ stockQuantity: stock[where.id] })),
    },
    inventoryMovement: { create: vi.fn(async ({ data }: { data: { type: string; beforeQuantity: number; afterQuantity: number } }) => { movements.push(data); return { id: `movement-${movements.length}` }; }) },
    adminAuditLog: { create: vi.fn(async () => ({})) },
    notificationOutbox: { upsert: vi.fn(async () => ({})) },
  };
  const client = { $transaction: vi.fn(async (operation: (value: typeof tx) => Promise<unknown>) => {
    const original = { ...stock }, movementCount = movements.length;
    try { return await operation(tx); }
    catch (error: unknown) { Object.assign(stock, original); movements.splice(movementCount); throw error; }
  }) };
  return { tx, stock, movements, repository: new ExchangesRepository(client as unknown as PrismaClient) };
}

describe("exchange completion", () => {
  it("restores original stock, removes replacement stock, writes two movements, and replays safely", async () => {
    const { repository, stock, movements, tx } = completion();
    expect(await repository.complete(ownerId, exchangeId, now)).toMatchObject({ kind: "UPDATED" });
    expect(stock).toMatchObject({ [originalId]: 3, [replacementId]: 2 });
    expect(movements.map((m) => m.type)).toEqual(["EXCHANGE_RETURNED", "EXCHANGE_REPLACEMENT"]);
    expect(await repository.complete(ownerId, exchangeId, now)).toMatchObject({ kind: "REPLAYED" });
    expect(movements).toHaveLength(2);
    expect(tx.adminAuditLog.create).toHaveBeenCalledTimes(1);
  });
  it("rejects insufficient replacement stock and rolls back the simulated transaction", async () => {
    const { repository, stock, movements, tx } = completion(1);
    expect(await repository.complete(ownerId, exchangeId, now)).toEqual({ kind: "INSUFFICIENT_STOCK" });
    expect(stock).toMatchObject({ [originalId]: 1, [replacementId]: 1 });
    expect(movements).toHaveLength(0);
    expect(tx.adminAuditLog.create).not.toHaveBeenCalled();
    expect(tx.exchangeRequest.update).not.toHaveBeenCalled();
  });
});
