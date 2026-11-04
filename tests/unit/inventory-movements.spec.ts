import { describe, expect, it, vi } from "vitest";
import type { PrismaClient } from "@prisma/client";
import { VariantsRepository } from "../../src/modules/variants/variants.repository";

const productId = "11111111-1111-4111-8111-111111111111";
const variantId = "22222222-2222-4222-8222-222222222222";
function setup(initial = 5) {
  let stock = initial;
  const movements: { type: string; quantityDelta: number; beforeQuantity: number; afterQuantity: number }[] = [];
  const tx = {
    productVariant: {
      findFirst: vi.fn(async () => ({ stockQuantity: stock })),
      update: vi.fn(async ({ data }: { data: { stockQuantity: number | { increment?: number; decrement?: number } } }) => {
        const change = data.stockQuantity;
        stock = typeof change === "number" ? change : stock + (change.increment ?? 0) - (change.decrement ?? 0);
        return { id: variantId, stockQuantity: stock };
      }),
      create: vi.fn(async () => ({ id: variantId, stockQuantity: stock })),
    },
    inventoryMovement: { create: vi.fn(async ({ data }: { data: typeof movements[number] }) => { movements.push(data); return data; }) },
  };
  const client = { $transaction: vi.fn(async (operation: (value: typeof tx) => Promise<unknown>) => operation(tx)) };
  return { repository: new VariantsRepository(client as unknown as PrismaClient), client, movements, getStock: () => stock };
}
describe("manual inventory audit", () => {
  it("records initial stock and each successful manual change with a signed delta", async () => {
    const { repository, movements, getStock, client } = setup();
    await repository.create(productId, { sku: "SKU", title: "42", priceMinor: "12000", optionValueIds: [], stockQuantity: 5 });
    await repository.setStock(productId, variantId, 7);
    await repository.incrementStock(productId, variantId, 2);
    await repository.decrementStock(productId, variantId, 3);
    expect(getStock()).toBe(6);
    expect(movements.map((movement) => [movement.type, movement.quantityDelta])).toEqual([["INITIAL_STOCK", 5], ["MANUAL_SET", 2], ["MANUAL_INCREMENT", 2], ["MANUAL_DECREMENT", -3]]);
    expect(client.$transaction).toHaveBeenCalledWith(expect.any(Function), { isolationLevel: "Serializable" });
  });
  it("does not record no-op or rejected stock changes", async () => {
    const { repository, movements } = setup();
    await repository.setStock(productId, variantId, 5);
    expect(await repository.decrementStock(productId, variantId, 6)).toBe("INSUFFICIENT");
    expect(movements).toHaveLength(0);
  });
});
