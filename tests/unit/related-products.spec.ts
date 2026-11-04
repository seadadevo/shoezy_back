import type { PrismaClient } from "@prisma/client";
import { Prisma } from "@prisma/client";
import { describe, expect, it, vi } from "vitest";
import type { CommercePricingService } from "../../src/services/commerce-pricing.service";
import { CatalogRepository } from "../../src/modules/catalog/catalog.repository";
import { catalogProductListSelect } from "../../src/modules/catalog/catalog.types";
import { publicProductVisibility } from "../../src/modules/catalog/public-product-visibility";
import { relatedScore, type RelatedSignals } from "../../src/modules/catalog/related-products";

const source: RelatedSignals = {
  categoryIds: new Set(["running", "trail"]), collectionIds: new Set(["summer"]),
  brandId: "brand", gender: "unisex", basePrice: 100,
};
const signals = (overrides: Partial<RelatedSignals> = {}): RelatedSignals => ({
  categoryIds: new Set(), collectionIds: new Set(), brandId: "other", gender: null, basePrice: 200,
  ...overrides,
});

describe("related product scoring", () => {
  it("weights every matching category and collection, then brand, gender, and price", () => {
    expect(relatedScore(source, signals({ categoryIds: new Set(["running"]) }))).toBe(50);
    expect(relatedScore(source, signals({ categoryIds: new Set(["running", "trail"]) }))).toBe(100);
    expect(relatedScore(source, signals({ collectionIds: new Set(["summer"]) }))).toBe(35);
    expect(relatedScore(source, signals({ brandId: "brand" }))).toBe(20);
    expect(relatedScore(source, signals({ gender: "UNISEX" }))).toBe(10);
    expect(relatedScore(source, signals({ basePrice: 100 }))).toBe(15);
    expect(relatedScore(source, signals({ basePrice: 120 }))).toBe(3);
    expect(relatedScore(source, signals({ basePrice: 130 }))).toBe(0);
  });

  it("fetches a bounded public pool, ranks it, and fills with distinct newest public products", async () => {
    const now = new Date("2026-08-13T12:00:00.000Z");
    const product = (id: string, categories: string[], collections: string[], publishedAt = now) => ({
      id, brandId: "other", gender: null, basePrice: new Prisma.Decimal(200), publishedAt,
      productCategories: categories.map((category) => ({ category: { id: category } })),
      collectionProducts: collections.map((collectionId) => ({ collectionId })),
    });
    const strong = [product("one-category", ["running"], []), product("two-categories", ["running", "trail"], [])];
    const fallback = [product("fallback", [], [])];
    const findFirst = vi.fn().mockResolvedValue({
      id: "source", brandId: "brand", gender: "unisex", basePrice: new Prisma.Decimal(100),
      productCategories: [{ categoryId: "running" }, { categoryId: "trail" }],
      collectionProducts: [{ collectionId: "summer" }],
    });
    const findMany = vi.fn().mockResolvedValueOnce(strong).mockResolvedValueOnce([]).mockResolvedValueOnce(fallback);
    const findVariants = vi.fn().mockResolvedValue([]);
    const client = { product: { findFirst, findMany }, productVariant: { findMany: findVariants } } as unknown as PrismaClient;
    const pricing = { calculateCatalogLines: vi.fn(async () => new Map()) } as unknown as CommercePricingService;
    const result = await new CatalogRepository(client, pricing).relatedProducts("source-slug", 3, now);

    expect(result?.items.map((item) => item.id)).toEqual(["two-categories", "one-category", "fallback"]);
    expect(findFirst.mock.calls[0]?.[0].where).toMatchObject({ ...publicProductVisibility(now), slug: "source-slug" });
    expect(findMany).toHaveBeenCalledTimes(3);
    expect(findMany.mock.calls[0]?.[0].where).toMatchObject({ ...publicProductVisibility(now), id: { not: "source" } });
    expect(findMany.mock.calls[0]?.[0].select.media).toEqual(catalogProductListSelect.media);
    expect(findMany.mock.calls[0]?.[0].take).toBe(200);
    expect(findMany.mock.calls[1]?.[0].where.id.notIn).toEqual(["source", "one-category", "two-categories"]);
    expect(findMany.mock.calls[1]?.[0].take).toBe(200);
    expect(findMany.mock.calls[2]?.[0].where.id.notIn).toEqual(["source", "one-category", "two-categories"]);
    expect(findMany.mock.calls[2]?.[0].take).toBe(1);
    expect(findVariants).toHaveBeenCalledTimes(1);
  });

  it("uses a stable newest-then-ID tie break", async () => {
    const now = new Date("2026-08-13T12:00:00.000Z");
    const candidate = (id: string, publishedAt: Date) => ({
      id, brandId: "brand", gender: null, basePrice: new Prisma.Decimal(200), publishedAt,
      productCategories: [], collectionProducts: [],
    });
    const client = {
      product: {
        findFirst: vi.fn().mockResolvedValue({ id: "source", brandId: "brand", gender: null, basePrice: new Prisma.Decimal(100), productCategories: [], collectionProducts: [] }),
        findMany: vi.fn().mockResolvedValue([candidate("b", now), candidate("a", now), candidate("old", new Date("2026-08-12T00:00:00Z"))]),
      },
      productVariant: { findMany: vi.fn().mockResolvedValue([]) },
    } as unknown as PrismaClient;
    const pricing = { calculateCatalogLines: vi.fn(async () => new Map()) } as unknown as CommercePricingService;
    const result = await new CatalogRepository(client, pricing).relatedProducts("source", 2, now);
    expect(result?.items.map((item) => item.id)).toEqual(["a", "b"]);
  });
});
