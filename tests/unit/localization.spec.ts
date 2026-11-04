import { Prisma, type PrismaClient } from "@prisma/client";
import { describe, expect, it, vi } from "vitest";
import { localizedField, translationsByLocale } from "../../src/common/localization/catalog-localization";
import { CatalogRepository } from "../../src/modules/catalog/catalog.repository";
import { toCatalogProductDetailDto } from "../../src/modules/catalog/catalog.dto";
import type { CatalogProductDetailRecord } from "../../src/modules/catalog/catalog.types";
import { createBrandSchema } from "../../src/modules/brands/brands.validation";
import { createCategorySchema } from "../../src/modules/categories/categories.validation";
import { createCollectionSchema } from "../../src/modules/collections/collections.validation";
import { createOptionSchema, createOptionValueSchema } from "../../src/modules/products/product-options.validation";
import { createProductSchema } from "../../src/modules/products/products.validation";

const productId = "11111111-1111-4111-8111-111111111111";
const brandId = "22222222-2222-4222-8222-222222222222";
const categoryId = "33333333-3333-4333-8333-333333333333";

function detail(): CatalogProductDetailRecord {
  return {
    id: productId, name: "Running Shoe", slug: "running-shoe", shortDescription: "English short", description: "English description", material: "Mesh",
    basePrice: new Prisma.Decimal("120.00"), compareAtPrice: null, gender: null, season: null, seoTitle: "English SEO", seoDescription: null, publishedAt: new Date(),
    translations: [
      { locale: "en", name: "Running Shoe", shortDescription: "English short", description: "English description", material: "Mesh", seoTitle: "English SEO", seoDescription: null },
      { locale: "ar", name: "حذاء جري", shortDescription: "وصف عربي", description: "وصف عربي كامل", material: "نسيج", seoTitle: "حذاء جري", seoDescription: null },
    ],
    brand: { id: brandId, name: "Shoozy", slug: "shoozy", translations: [{ locale: "ar", name: "شوزي", description: null }] },
    productCategories: [{ isPrimary: true, category: { id: categoryId, name: "Running", slug: "running", translations: [{ locale: "ar", name: "الجري", description: null }] } }],
    media: [], options: [{ id: categoryId, name: "Color", position: 0, translations: [{ locale: "ar", name: "اللون" }], values: [{ id: categoryId, value: "black", displayValue: "Black", colorHex: "#000000", position: 0, translations: [{ locale: "ar", displayValue: "أسود" }] }] }],
    variants: [{ id: categoryId, sku: "RUN-BLK-42", title: "Black / 42", stockQuantity: 2, weightGrams: null, priceMinor: 120000n, compareAtPriceMinor: null, optionValues: [{ optionValue: { id: categoryId, optionId: categoryId, value: "black", displayValue: "Black", colorHex: "#000000", translations: [{ locale: "ar", displayValue: "أسود" }] } }] }],
    sizeGuide: null, collectionProducts: [],
  };
}

describe("catalog localization", () => {
  it("selects the requested locale, falls back to English, then to legacy fields", () => {
    expect(localizedField([{ locale: "ar", name: "حذاء" }], "ar", "name", "Legacy")).toBe("حذاء");
    expect(localizedField([{ locale: "en", name: "Shoe" }], "ar", "name", "Legacy")).toBe("Shoe");
    expect(localizedField([], "ar", "name", "Legacy")).toBe("Legacy");
    expect(translationsByLocale([{ locale: "en", name: "Shoe" }, { locale: "ar", name: "حذاء" }])).toEqual({ en: { name: "Shoe" }, ar: { name: "حذاء" } });
  });

  it("localizes product, brand, category, option, value, and SEO without changing stable commerce fields", () => {
    const dto = toCatalogProductDetailDto(detail(), "ar");
    expect(dto).toMatchObject({ id: productId, slug: "running-shoe", name: "حذاء جري", material: "نسيج", seoTitle: "حذاء جري", basePrice: "120", brand: { id: brandId, name: "شوزي" }, categories: [{ id: categoryId, name: "الجري" }], options: [{ name: "اللون", values: [{ value: "black", displayValue: "أسود" }] }], variants: [{ sku: "RUN-BLK-42", priceMinor: "120000", optionValues: [{ value: "black", displayValue: "أسود" }] }] });
  });

  it("filters translated text in PostgreSQL before pagination", async () => {
    const findMany = vi.fn(async (_args: unknown) => []);
    const count = vi.fn(async (_args: unknown) => 0);
    const client = {
      product: { findMany, count },
      productVariant: { groupBy: vi.fn(async () => []) },
      $transaction: vi.fn(async (promises: Promise<unknown>[]) => Promise.all(promises)),
    };
    await new CatalogRepository(client as unknown as PrismaClient).listProducts({ page: 2, limit: 10, search: "حذاء", sort: "newest" }, new Date());
    const call = findMany.mock.calls[0]![0] as { where: unknown; skip: number; take: number };
    expect(JSON.stringify(call.where)).toContain("translations");
    expect(JSON.stringify(call.where)).toContain("حذاء");
    expect(call).toMatchObject({ skip: 10, take: 10 });
    expect(count).toHaveBeenCalledWith({ where: call.where });
  });
});

describe("bilingual admin contracts", () => {
  const entityTranslations = { ar: { name: "اسم عربي", description: "وصف" }, en: { name: "English name", description: "Description" } };
  it("accepts bilingual product, brand, category, collection, option, and option-value payloads", () => {
    expect(createProductSchema.safeParse({ body: { brandId, name: "Legacy", basePrice: "100.00", translations: { ar: { name: "حذاء" }, en: { name: "Shoe" } } }, params: {}, query: {} }).success).toBe(true);
    expect(createBrandSchema.safeParse({ body: { name: "Legacy", translations: entityTranslations }, params: {}, query: {} }).success).toBe(true);
    expect(createCategorySchema.safeParse({ body: { name: "Legacy", translations: entityTranslations }, params: {}, query: {} }).success).toBe(true);
    expect(createCollectionSchema.safeParse({ body: { name: "Legacy", translations: entityTranslations }, params: {}, query: {} }).success).toBe(true);
    expect(createOptionSchema.safeParse({ body: { name: "Color", translations: { ar: { name: "اللون" }, en: { name: "Color" } } }, params: { productId }, query: {} }).success).toBe(true);
    expect(createOptionValueSchema.safeParse({ body: { value: "black", translations: { ar: { displayValue: "أسود" }, en: { displayValue: "Black" } } }, params: { productId, optionId: categoryId }, query: {} }).success).toBe(true);
  });
});
