import { describe, expect, it, vi } from "vitest";
import { ProductOptionsRepositoryError } from "../../src/modules/products/product-options.repository";
import { ProductOptionsService, type ProductOptionsStore } from "../../src/modules/products/product-options.service";
import type { ProductOptionRecord, ProductOptionValueRecord, ProductOptionValueUsage } from "../../src/modules/products/product-options.types";
import { createOptionValueSchema } from "../../src/modules/products/product-options.validation";

const productId = "11111111-1111-4111-8111-111111111111"; const otherProductId = "22222222-2222-4222-8222-222222222222";
const optionId = "33333333-3333-4333-8333-333333333333"; const valueId = "44444444-4444-4444-8444-444444444444";
function value(overrides: Partial<ProductOptionValueRecord> = {}): ProductOptionValueRecord { return { id: valueId, optionId, value: "42", displayValue: "EU 42", colorHex: null, metadataJson: null, position: 0, translations: [], ...overrides }; }
function option(overrides: Partial<ProductOptionRecord> = {}): ProductOptionRecord { return { id: optionId, productId, name: "Size", position: 0, translations: [], values: [value()], ...overrides }; }
function store(): ProductOptionsStore { return {
  findProduct: vi.fn(async (id) => id === productId ? { id, status: "DRAFT" as const } : null),
  list: vi.fn(async () => [option()]), findOption: vi.fn(async (id, nestedId) => id === productId && nestedId === optionId ? option() : null),
  createOption: vi.fn(async (id, input) => option({ productId: id, ...input })), updateOption: vi.fn(async (id, nestedId, input) => id === productId && nestedId === optionId ? option(input) : null),
  findValue: vi.fn(async (id, nestedOptionId, nestedValueId) => id === productId && nestedOptionId === optionId && nestedValueId === valueId ? { ...value(), _count: { variants: 0 } } as ProductOptionValueUsage : null),
  createValue: vi.fn(async (id, input) => value({ optionId: id, ...input })), updateValue: vi.fn(async (id, nestedOptionId, nestedValueId, input) => id === productId && nestedOptionId === optionId && nestedValueId === valueId ? value(input) : "NOT_FOUND" as const),
  deleteOptionIfUnused: vi.fn(async () => "DELETED" as const), deleteValueIfUnused: vi.fn(async () => "DELETED" as const),
}; }

describe("product option service", () => {
  it("creates arbitrary options and values", async () => { const repository = store(); await new ProductOptionsService(repository).create(productId, { name: "Color", position: 1 }); await new ProductOptionsService(repository).createValue(productId, optionId, { value: "Black", colorHex: "#000000" }); expect(repository.createOption).toHaveBeenCalledWith(productId, { name: "Color", position: 1 }); });
  it("maps option and value uniqueness independently", async () => { const repository = store(); vi.mocked(repository.createOption).mockRejectedValue(new ProductOptionsRepositoryError("DUPLICATE_OPTION_NAME")); await expect(new ProductOptionsService(repository).create(productId, { name: "Size" })).rejects.toMatchObject({ code: "PRODUCT_OPTION_NAME_ALREADY_EXISTS" }); vi.mocked(repository.createValue).mockRejectedValue(new ProductOptionsRepositoryError("DUPLICATE_OPTION_VALUE")); await expect(new ProductOptionsService(repository).createValue(productId, optionId, { value: "42" })).rejects.toMatchObject({ code: "PRODUCT_OPTION_VALUE_ALREADY_EXISTS" }); });
  it("denies cross-product and cross-option value mutation", async () => { await expect(new ProductOptionsService(store()).update(otherProductId, optionId, { name: "Width" })).rejects.toMatchObject({ code: "PRODUCT_NOT_FOUND" }); const repository = store(); vi.mocked(repository.updateValue).mockResolvedValue("NOT_FOUND"); await expect(new ProductOptionsService(repository).updateValue(productId, optionId, valueId, { displayValue: "New" })).rejects.toMatchObject({ code: "PRODUCT_OPTION_VALUE_NOT_FOUND" }); });
  it("protects used canonical values but permits presentation changes", async () => { const repository = store(); vi.mocked(repository.updateValue).mockResolvedValueOnce("IN_USE"); await expect(new ProductOptionsService(repository).updateValue(productId, optionId, valueId, { value: "43" })).rejects.toMatchObject({ code: "OPTION_VALUE_IN_USE" }); await expect(new ProductOptionsService(repository).updateValue(productId, optionId, valueId, { displayValue: "EU Forty Two" })).resolves.toMatchObject({ displayValue: "EU Forty Two" }); });
  it("maps atomic product status outcomes during option creation", async () => { const repository = store(); vi.mocked(repository.createOption).mockResolvedValueOnce("WOULD_INVALIDATE_PRODUCT"); await expect(new ProductOptionsService(repository).create(productId, { name: "Color" })).rejects.toMatchObject({ code: "PRODUCT_WOULD_BECOME_INVALID" }); vi.mocked(repository.createOption).mockResolvedValueOnce("PRODUCT_NOT_FOUND"); await expect(new ProductOptionsService(repository).create(otherProductId, { name: "Color" })).rejects.toMatchObject({ code: "PRODUCT_NOT_FOUND" }); });
  it("blocks deletion of referenced values and options", async () => { const repository = store(); vi.mocked(repository.deleteValueIfUnused).mockResolvedValue("IN_USE"); await expect(new ProductOptionsService(repository).deleteValue(productId, optionId, valueId)).rejects.toMatchObject({ code: "OPTION_VALUE_IN_USE" }); vi.mocked(repository.deleteOptionIfUnused).mockResolvedValue("IN_USE"); await expect(new ProductOptionsService(repository).delete(productId, optionId)).rejects.toMatchObject({ code: "OPTION_IN_USE" }); });
});

describe("option value validation", () => {
  const parse = (body: unknown) => createOptionValueSchema.safeParse({ body, params: { productId, optionId }, query: {} }).success;
  it("accepts exact color hex and JSON-compatible metadata", () => { expect(parse({ value: "Black", colorHex: "#00AaFF", metadataJson: { swatch: true } })).toBe(true); });
  it("rejects malformed color and excessive metadata", () => { expect(parse({ value: "Black", colorHex: "#000" })).toBe(false); expect(parse({ value: "Black", metadataJson: "x".repeat(50_001) })).toBe(false); });
});
