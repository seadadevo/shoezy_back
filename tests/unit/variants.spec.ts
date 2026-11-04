import { describe, expect, it, vi } from "vitest";
import { VariantsRepositoryError } from "../../src/modules/variants/variants.repository";
import { VariantsService, type VariantsStore } from "../../src/modules/variants/variants.service";
import type { VariantRecord } from "../../src/modules/variants/variants.types";
import { createVariantSchema } from "../../src/modules/variants/variants.validation";

const productId = "11111111-1111-4111-8111-111111111111"; const otherProductId = "22222222-2222-4222-8222-222222222222";
const variantId = "33333333-3333-4333-8333-333333333333"; const sizeOption = "44444444-4444-4444-8444-444444444444";
const colorOption = "55555555-5555-4555-8555-555555555555"; const sizeValue = "66666666-6666-4666-8666-666666666666"; const colorValue = "77777777-7777-4777-8777-777777777777";
function variant(overrides: Partial<VariantRecord> = {}): VariantRecord { return { id: variantId, productId, sku: "SKU-42-BLK", barcode: null, title: "42 / Black", isActive: true, stockQuantity: 0, weightGrams: null, priceMinor: 24999n, costMinor: 17000n, compareAtPriceMinor: 29999n, metadataJson: null, createdAt: new Date(), updatedAt: new Date(), deletedAt: null, optionValues: [], ...overrides }; }
function store(options: string[] = []): VariantsStore { return {
  findProduct: vi.fn(async (id) => id === productId ? { id, status: "DRAFT" as const } : null),
  list: vi.fn(async () => ({ items: [variant()], total: 1 })), findById: vi.fn(async (id, nestedId) => id === productId && nestedId === variantId ? variant() : null),
  selectionContext: vi.fn(async (_id, ids) => ({ optionIds: options, values: ids.map((id: string) => id === sizeValue ? { id, optionId: sizeOption, option: { productId } } : id === colorValue ? { id, optionId: colorOption, option: { productId } } : { id, optionId: colorOption, option: { productId: otherProductId } }) })),
  combinations: vi.fn(async () => []),
  create: vi.fn(async (id, input) => variant({ productId: id, sku: input.sku, barcode: input.barcode ?? null, title: input.title, isActive: input.isActive ?? true, stockQuantity: input.stockQuantity ?? 0, weightGrams: input.weightGrams ?? null, priceMinor: BigInt(input.priceMinor), costMinor: input.costMinor ? BigInt(input.costMinor) : null, compareAtPriceMinor: input.compareAtPriceMinor ? BigInt(input.compareAtPriceMinor) : null, metadataJson: input.metadataJson ?? null })),
  update: vi.fn(async (id, nestedId, input) => id === productId && nestedId === variantId ? variant({ ...input, priceMinor: input.priceMinor ? BigInt(input.priceMinor) : 24999n, costMinor: input.costMinor === undefined ? 17000n : input.costMinor === null ? null : BigInt(input.costMinor), compareAtPriceMinor: input.compareAtPriceMinor === undefined ? 29999n : input.compareAtPriceMinor === null ? null : BigInt(input.compareAtPriceMinor) }) : null),
  countOtherActive: vi.fn(async () => 1), softDelete: vi.fn(async () => true), setStock: vi.fn(async (_id, _variant, quantity) => variant({ stockQuantity: quantity })), incrementStock: vi.fn(async (_id, _variant, quantity) => variant({ stockQuantity: quantity })), decrementStock: vi.fn(async () => "UPDATED" as const),
}; }
const input = { sku: "SKU-42-BLK", title: "42 / Black", priceMinor: "24999", optionValueIds: [] };

describe("variant option selection", () => {
  it("creates an optionless variant and serializes BigInt money", async () => { const result = await new VariantsService(store()).create(productId, input); expect(result.priceMinor).toBe("24999"); expect(result.costMinor).toBeNull(); });
  it("accepts one Size and one Color selection", async () => { await expect(new VariantsService(store([sizeOption, colorOption])).create(productId, { ...input, optionValueIds: [sizeValue, colorValue] })).resolves.toMatchObject({ sku: input.sku }); });
  it("rejects foreign, duplicate-option, and incomplete selections", async () => { const repository = store([sizeOption, colorOption]); await expect(new VariantsService(repository).create(productId, { ...input, optionValueIds: [sizeValue, otherProductId] })).rejects.toMatchObject({ code: "VARIANT_OPTION_VALUE_INVALID" }); vi.mocked(repository.selectionContext).mockResolvedValue({ optionIds: [sizeOption, colorOption], values: [{ id: sizeValue, optionId: sizeOption, option: { productId } }, { id: colorValue, optionId: sizeOption, option: { productId } }] }); await expect(new VariantsService(repository).create(productId, { ...input, optionValueIds: [sizeValue, colorValue] })).rejects.toMatchObject({ code: "VARIANT_OPTION_DUPLICATE" }); await expect(new VariantsService(store([sizeOption, colorOption])).create(productId, { ...input, optionValueIds: [sizeValue] })).rejects.toMatchObject({ code: "VARIANT_OPTION_INCOMPLETE" }); });
});

describe("variant prices, identity, and lifecycle", () => {
  it("rejects compare-at below price", async () => { await expect(new VariantsService(store()).create(productId, { ...input, compareAtPriceMinor: "20000" })).rejects.toMatchObject({ code: "VARIANT_PRICE_INVALID" }); });
  it.each([["DUPLICATE_SKU", "VARIANT_SKU_ALREADY_EXISTS"], ["DUPLICATE_BARCODE", "VARIANT_BARCODE_ALREADY_EXISTS"]] as const)("maps %s", async (repositoryCode, apiCode) => { const repository = store(); vi.mocked(repository.create).mockRejectedValue(new VariantsRepositoryError(repositoryCode)); await expect(new VariantsService(repository).create(productId, input)).rejects.toMatchObject({ statusCode: 409, code: apiCode }); });
  it("protects the last active variant of an active product", async () => { const repository = store(); vi.mocked(repository.findProduct).mockResolvedValue({ id: productId, status: "ACTIVE" }); vi.mocked(repository.countOtherActive).mockResolvedValue(0); await expect(new VariantsService(repository).delete(productId, variantId)).rejects.toMatchObject({ code: "PRODUCT_WOULD_BECOME_INVALID" }); });
  it("soft-deletes when another active variant remains", async () => { const repository = store(); await new VariantsService(repository).delete(productId, variantId); expect(repository.softDelete).toHaveBeenCalledWith(productId, variantId); });
  it("revalidates persisted option selections before reactivating a stale variant", async () => {
    const repository = store([sizeOption, colorOption]);
    vi.mocked(repository.findById).mockResolvedValue(variant({ isActive: false, optionValues: [{ optionValue: { id: sizeValue, value: "42", displayValue: null, colorHex: null, position: 0, option: { id: sizeOption, name: "Size", position: 0 } } }] }));
    await expect(new VariantsService(repository).update(productId, variantId, { isActive: true })).rejects.toMatchObject({ code: "VARIANT_OPTION_INCOMPLETE" });
    expect(repository.update).not.toHaveBeenCalled();
    await expect(new VariantsService(repository).update(productId, variantId, { isActive: true, optionValueIds: [sizeValue, colorValue] })).resolves.toMatchObject({ id: variantId });
  });
});

describe("stock operations", () => {
  it.each(["SET", "INCREMENT"] as const)("executes atomic %s", async (operation) => { const repository = store(); await new VariantsService(repository).stock(productId, variantId, { operation, quantity: 5 }); expect(operation === "SET" ? repository.setStock : repository.incrementStock).toHaveBeenCalledWith(productId, variantId, 5); });
  it("maps conditional decrement failure to insufficient stock", async () => { const repository = store(); vi.mocked(repository.decrementStock).mockResolvedValue("INSUFFICIENT"); await expect(new VariantsService(repository).stock(productId, variantId, { operation: "DECREMENT", quantity: 5 })).rejects.toMatchObject({ statusCode: 409, code: "INSUFFICIENT_STOCK" }); });
  it("maps atomic increment overflow to a stable conflict", async () => { const repository = store(); vi.mocked(repository.incrementStock).mockResolvedValue("OVERFLOW"); await expect(new VariantsService(repository).stock(productId, variantId, { operation: "INCREMENT", quantity: 1 })).rejects.toMatchObject({ statusCode: 409, code: "STOCK_LIMIT_EXCEEDED" }); });
});

describe("variant validation", () => {
  const parse = (priceMinor: unknown) => createVariantSchema.safeParse({ body: { ...input, priceMinor }, params: { productId }, query: {} }).success;
  it("accepts bounded integer strings and rejects decimals, negatives, whitespace, scientific notation, and overflow", () => { expect(parse("24999")).toBe(true); for (const invalid of [12.34, "12.34", "-1", " 12", "1e3", "9223372036854775808"]) expect(parse(invalid)).toBe(false); });
});
