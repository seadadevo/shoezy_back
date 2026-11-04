import { describe, expect, it } from "vitest";
import { POSTGRES_INT_MAX } from "../../src/common/validation/postgres-int";
import { createCategorySchema } from "../../src/modules/categories/categories.validation";
import { createOptionSchema, createOptionValueSchema } from "../../src/modules/products/product-options.validation";
import { createSizeGuideEntrySchema } from "../../src/modules/size-guides/size-guides.validation";
import { createVariantSchema, updateStockSchema } from "../../src/modules/variants/variants.validation";

const productId = "11111111-1111-4111-8111-111111111111";
const optionId = "22222222-2222-4222-8222-222222222222";
const variantId = "33333333-3333-4333-8333-333333333333";
const request = (body: unknown, params: Record<string, string> = {}) => ({ body, params, query: {} });

describe("PostgreSQL INTEGER request bounds", () => {
  it.each([
    ["category sortOrder", (value: number) => createCategorySchema.safeParse(request({ name: "Shoes", sortOrder: value })).success],
    ["size-guide entry sortOrder", (value: number) => createSizeGuideEntrySchema.safeParse(request({ euSize: "42", sortOrder: value }, { sizeGuideId: productId })).success],
    ["option position", (value: number) => createOptionSchema.safeParse(request({ name: "Size", position: value }, { productId })).success],
    ["option-value position", (value: number) => createOptionValueSchema.safeParse(request({ value: "42", position: value }, { productId, optionId })).success],
    ["variant stockQuantity", (value: number) => createVariantSchema.safeParse(request({ sku: "SKU", title: "Variant", stockQuantity: value, priceMinor: "0", optionValueIds: [] }, { productId })).success],
    ["variant weightGrams", (value: number) => createVariantSchema.safeParse(request({ sku: "SKU", title: "Variant", weightGrams: value, priceMinor: "0", optionValueIds: [] }, { productId })).success],
    ["stock operation quantity", (value: number) => updateStockSchema.safeParse(request({ operation: "SET", quantity: value }, { productId, variantId })).success],
  ] as const)("accepts 2147483647 and rejects 2147483648 for %s", (_name, parse) => {
    expect(parse(POSTGRES_INT_MAX)).toBe(true);
    expect(parse(POSTGRES_INT_MAX + 1)).toBe(false);
  });
});
