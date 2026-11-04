import { Prisma, type PrismaClient } from "@prisma/client";
import { describe, expect, it, vi } from "vitest";
import { CatalogService, type CatalogStore } from "../../src/modules/catalog/catalog.service";
import { CatalogRepository, catalogColorSummary } from "../../src/modules/catalog/catalog.repository";
import { catalogCategorySelect, catalogColorFilterSelect, catalogProductListSelect, type CatalogProductDetailRecord, type CatalogProductListRecord, type CatalogVariantPricing } from "../../src/modules/catalog/catalog.types";
import { collectionPublicSelect } from "../../src/modules/collections/collections.types";
import { listCatalogProductsSchema } from "../../src/modules/catalog/catalog.validation";
import { ratingSummaryFromGroups } from "../../src/modules/reviews/rating-summary";
import type { CommercePricingService } from "../../src/services/commerce-pricing.service";

const productId = "11111111-1111-4111-8111-111111111111";
const brandId = "22222222-2222-4222-8222-222222222222";
const categoryId = "33333333-3333-4333-8333-333333333333";
const collectionId = "55555555-5555-4555-8555-555555555555";
const videoId = "66666666-6666-4666-8666-666666666666";
const collection = {
  id: collectionId, name: "Summer", slug: "summer", description: null, imageUrl: null, videoUrl: null, videoMimeType: null,
  isActive: true, startsAt: null, endsAt: null, createdAt: new Date(), updatedAt: new Date(),
  _count: { collectionProducts: 0 }, translations: [],
};

function product(media?: CatalogProductListRecord["media"]): CatalogProductListRecord {
  return {
    id: productId,
    name: "Trail Shoe",
    slug: "trail-shoe",
    shortDescription: "Stable on rough ground",
    basePrice: new Prisma.Decimal("249.99"),
    compareAtPrice: new Prisma.Decimal("299.99"),
    gender: "unisex",
    season: "all-season",
    publishedAt: new Date("2026-08-13T00:00:00.000Z"),
    translations: [],
    brand: { id: brandId, name: "Shoozy", slug: "shoozy", translations: [] },
    productCategories: [{ isPrimary: true, category: { id: categoryId, name: "Running", slug: "running", translations: [] } }],
    media: media ?? [{ id: categoryId, productId, type: "IMAGE", mediaType: "IMAGE", mimeType: "image/jpeg", url: "https://example.com/shoe.jpg", altText: "Trail shoe", position: 0, isPrimary: true, variant: null }],
  };
}

const previewVideo = {
  id: videoId,
  productId,
  type: "VIDEO" as const,
  mediaType: "VIDEO" as const,
  mimeType: "video/mp4",
  url: "https://example.com/shoe.mp4",
  altText: "Trail shoe preview",
  position: 3,
  isPrimary: false,
  variant: null,
};

function detail(): CatalogProductDetailRecord & { promotionPricing: Map<string, CatalogVariantPricing>; ratingSummary: ReturnType<typeof ratingSummaryFromGroups> } {
  return {
    ...product(),
    description: "A durable trail shoe",
    material: "Mesh",
    seoTitle: "Trail Shoe",
    seoDescription: "Trail shoe",
    media: [
      { id: categoryId, productId, variantId: null, type: "IMAGE", mediaType: "IMAGE", mimeType: "image/jpeg", url: "https://example.com/shoe.jpg", altText: "Trail shoe", position: 0, isPrimary: true, variant: null },
      { id: "44444444-4444-4444-8444-444444444444", productId, variantId: null, type: "VIDEO", mediaType: "VIDEO", mimeType: "video/mp4", url: "https://example.com/shoe.mp4", altText: "Shoe Video", position: 1, isPrimary: false, variant: null },
    ],
    options: [{ id: categoryId, name: "Size", position: 0, translations: [], values: [{ id: categoryId, value: "42", displayValue: "EU 42", colorHex: null, position: 0, translations: [] }] }],
    variants: [{ id: categoryId, sku: "TRAIL-42", title: "42", stockQuantity: 0, weightGrams: 300, priceMinor: 24999n, compareAtPriceMinor: 29999n, optionValues: [{ optionValue: { id: categoryId, value: "42", displayValue: "EU 42", colorHex: null, optionId: categoryId, translations: [] } }] }],
    sizeGuide: null,
    collectionProducts: [],
    promotionPricing: new Map<string, CatalogVariantPricing>(),
    ratingSummary: ratingSummaryFromGroups([]),
  };
}

function store(): CatalogStore {
  return {
    listProducts: vi.fn(async () => ({ items: [product()], summaries: [{ productId, minimumPriceMinor: 24999n, stockQuantity: 0 }], total: 1 })),
    listColorOptions: vi.fn(async () => []),
    findProductBySlug: vi.fn(async (slug) => slug === "trail-shoe" ? detail() : null),
    relatedProducts: vi.fn(async () => ({ items: [], summaries: [] })),
    listBrands: vi.fn(async () => ({ items: [{ id: brandId, name: "Shoozy", slug: "shoozy", description: null, logoUrl: null, showcaseImageUrl: null, _count: { products: 0 }, translations: [] }], total: 1 })),
    listPromotions: vi.fn(async () => []),
    listCategories: vi.fn(async () => ({ items: [{ id: categoryId, parentId: null, name: "Running", slug: "running", description: null, imageUrl: null, videoUrl: null, videoMimeType: null, sortOrder: 0, _count: { productCategories: 0 }, translations: [] }], total: 1 })),
    listCategoryRoots: vi.fn(async () => ({ items: [{ id: categoryId, parentId: null, name: "Running", slug: "running", description: null, imageUrl: null, videoUrl: null, videoMimeType: null, sortOrder: 0, _count: { productCategories: 0 }, translations: [] }], total: 1 })),
    listCategoryChildren: vi.fn(async () => []),
    listCollections: vi.fn(async () => ({ items: [], total: 0 })),
    findCollection: vi.fn(async () => null),
    findSizeGuide: vi.fn(async () => null),
  };
}

const query = {
  page: 1,
  limit: 20,
  sort: "newest" as const,
};

describe("public catalog DTOs", () => {
  it("returns public counts on entity lists, tree nodes, and collection detail", async () => {
    const repository = store();
    vi.mocked(repository.listBrands).mockResolvedValue({ items: [
      { id: brandId, name: "Shoozy", slug: "shoozy", description: null, logoUrl: null, showcaseImageUrl: "https://example.com/showcase.jpg", _count: { products: 2 }, translations: [] },
    ], total: 1 });
    vi.mocked(repository.listCategories).mockResolvedValue({ items: [
      { id: categoryId, parentId: null, name: "Running", slug: "running", description: null, imageUrl: null, videoUrl: "/uploads/categories/running.mp4", videoMimeType: "video/mp4", sortOrder: 0, _count: { productCategories: 2 }, translations: [] },
    ], total: 1 });
    vi.mocked(repository.listCategoryRoots).mockResolvedValue({ items: [{ id: categoryId, parentId: null, name: "Running", slug: "running", description: null, imageUrl: null, videoUrl: "/uploads/categories/running.mp4", videoMimeType: "video/mp4", sortOrder: 0, _count: { productCategories: 0 }, translations: [] }], total: 1 });
    const animatedCollection = { ...collection, videoUrl: "/uploads/collections/summer.mp4", videoMimeType: "video/mp4", _count: { collectionProducts: 2 } };
    vi.mocked(repository.listCollections).mockResolvedValue({ items: [animatedCollection], total: 1 });
    vi.mocked(repository.findCollection).mockResolvedValue({ collection: animatedCollection, products: [], summaries: [], total: 2 });
    const service = new CatalogService(repository);
    const entityQuery = { page: 1, limit: 20 };
    const publicBrand = (await service.listBrands(entityQuery)).items[0];
    expect(publicBrand).toMatchObject({ productCount: 2, showcaseImageUrl: "https://example.com/showcase.jpg", logoUrl: null });
    expect(JSON.stringify(publicBrand)).not.toMatch(/storageProvider|storageKey/);
    expect((await service.listCategories(entityQuery)).items[0]?.productCount).toBe(2);
    expect((await service.listCategories(entityQuery)).items[0]).toMatchObject({ videoUrl: "/uploads/categories/running.mp4", videoMimeType: "video/mp4" });
    expect((await service.categoryTree(entityQuery)).items[0]).toMatchObject({ productCount: 0, videoUrl: "/uploads/categories/running.mp4", videoMimeType: "video/mp4" });
    expect((await service.listCollections(entityQuery)).items[0]).toMatchObject({ productCount: 2, videoUrl: "/uploads/collections/summer.mp4", videoMimeType: "video/mp4" });
    expect((await service.getCollection("summer", entityQuery)).productCount).toBe(2);
    const publicCollections = JSON.stringify(await service.listCollections(entityQuery));
    expect(publicCollections).not.toContain("_count");
    expect(publicCollections).not.toContain("videoStorageKey");
    expect(publicCollections).not.toContain("videoStorageProvider");
    expect(catalogCategorySelect(new Date())).not.toHaveProperty("videoStorageKey");
    expect(catalogCategorySelect(new Date())).not.toHaveProperty("videoStorageProvider");
    expect(collectionPublicSelect).not.toHaveProperty("videoStorageKey");
    expect(collectionPublicSelect).not.toHaveProperty("videoStorageProvider");
  });

  it("keeps existing active/public-product Brand visibility with a safe showcase select", async () => {
    const findMany = vi.fn(async (_query: unknown) => []);
    const client = {
      $transaction: vi.fn(async (operations: Array<Promise<unknown>>) => Promise.all(operations)),
      brand: { findMany, count: vi.fn(async () => 0) },
    } as unknown as PrismaClient;

    await new CatalogRepository(client).listBrands({ page: 1, limit: 20 }, new Date("2026-08-13T00:00:00.000Z"));

    const brandQuery = findMany.mock.calls[0]![0] as { where: unknown; select: Record<string, unknown> };
    expect(brandQuery.where).toMatchObject({
      isActive: true,
      products: { some: { status: "ACTIVE", deletedAt: null, brand: { isActive: true } } },
    });
    expect(brandQuery.select).toMatchObject({ logoUrl: true, showcaseImageUrl: true });
    expect(JSON.stringify(brandQuery.select)).not.toMatch(/storageProvider|storageKey/);
  });
  it("serializes Decimal and BigInt money without exposing cost fields", async () => {
    const result = await new CatalogService(store()).listProducts(query, new Date("2026-08-13T00:00:00.000Z"));
    expect(result.items[0]).toMatchObject({ basePrice: "249.99", minimumVariantPriceMinor: "24999", inStock: false, previewVideo: null });
    expect(JSON.stringify(result)).not.toContain("costMinor");
  });

  it("returns active Variant commerce data in detail while omitting internal cost", async () => {
    const result = await new CatalogService(store()).getProduct("trail-shoe");
    expect(result.ratingSummary).toEqual(ratingSummaryFromGroups([]));
    expect(result.variants[0]).toMatchObject({ priceMinor: "24999", compareAtPriceMinor: "29999", stockQuantity: 0 });
    expect(JSON.stringify(result)).not.toContain("costMinor");
    expect(JSON.stringify(result)).not.toContain("metadataJson");
    expect(JSON.stringify(result)).not.toContain("deletedAt");
  });

  it("exposes IMAGE and VIDEO mediaTypes in detail DTO and primary image in list DTO", async () => {
    const service = new CatalogService(store());
    const detailResult = await service.getProduct("trail-shoe");
    expect(detailResult.media).toHaveLength(2);
    expect(detailResult.media[0]).toMatchObject({ type: "IMAGE", mediaType: "IMAGE", mimeType: "image/jpeg", isPrimary: true });
    expect(detailResult.media[1]).toMatchObject({ type: "VIDEO", mediaType: "VIDEO", mimeType: "video/mp4", isPrimary: false });

    const listResult = await service.listProducts(query);
    expect(listResult.items[0]?.primaryMedia).toMatchObject({
      type: "IMAGE",
      mediaType: "IMAGE",
      isPrimary: true,
    });
    expect(listResult.items[0]?.previewVideo).toBeNull();
  });

  it("returns one safe preview VIDEO while primaryMedia remains IMAGE", async () => {
    const repository = store();
    const card = product([previewVideo, ...product().media]);
    vi.mocked(repository.listProducts).mockResolvedValue({
      items: [card],
      summaries: [{ productId, minimumPriceMinor: 24999n, stockQuantity: 1 }],
      total: 1,
    });
    const result = await new CatalogService(repository).listProducts(query);

    expect(result.items[0]?.primaryMedia).toMatchObject({ type: "IMAGE", mediaType: "IMAGE", isPrimary: true });
    expect(result.items[0]?.previewImages).toEqual([expect.objectContaining({ type: "IMAGE", isPrimary: true })]);
    expect(result.items[0]?.previewVideo).toEqual({
      id: videoId,
      type: "VIDEO",
      mediaType: "VIDEO",
      mimeType: "video/mp4",
      url: "https://example.com/shoe.mp4",
      altText: "Trail shoe preview",
      position: 3,
      isPrimary: false,
    });
    expect(JSON.stringify(result.items[0]?.previewVideo)).not.toContain("storageProvider");
    expect(JSON.stringify(result.items[0]?.previewVideo)).not.toContain("storageKey");

    vi.mocked(repository.listProducts).mockResolvedValue({
      items: [product([previewVideo])],
      summaries: [{ productId, minimumPriceMinor: 24999n, stockQuantity: 1 }],
      total: 1,
    });
    const videoOnly = await new CatalogService(repository).listProducts(query);
    expect(videoOnly.items[0]?.primaryMedia).toBeNull();
    expect(videoOnly.items[0]?.previewVideo?.type).toBe("VIDEO");
  });

  it("returns at most four IMAGE-only previewImages without changing primaryMedia or previewVideo", async () => {
    const images = Array.from({ length: 5 }, (_, index) => ({
      ...product().media[0]!,
      id: `77777777-7777-4777-8777-77777777777${index}`,
      url: `https://example.com/shoe-${index}.jpg`,
      position: index,
      isPrimary: index === 0,
    }));
    const repository = store();
    vi.mocked(repository.listProducts).mockResolvedValue({
      items: [product([previewVideo, ...images])],
      summaries: [{ productId, minimumPriceMinor: 24999n, stockQuantity: 1 }],
      total: 1,
    });
    const item = (await new CatalogService(repository).listProducts(query)).items[0]!;
    expect(item.previewImages).toHaveLength(4);
    expect(item.previewImages.every((media) => media.type === "IMAGE" && media.mediaType === "IMAGE")).toBe(true);
    expect(item.primaryMedia).toEqual(item.previewImages[0]);
    expect(item.previewVideo).toMatchObject({ id: videoId, type: "VIDEO" });
    expect(JSON.stringify(item.previewImages)).not.toContain("storageProvider");
    expect(JSON.stringify(item.previewImages)).not.toContain("storageKey");
  });

  it("keeps the existing first-image fallback when no image is primary", async () => {
    const fallback = { ...product().media[0]!, id: "77777777-7777-4777-8777-777777777777", isPrimary: false, position: 1, url: "https://example.com/fallback.jpg" };
    const later = { ...product().media[0]!, id: "88888888-8888-4888-8888-888888888888", isPrimary: false, position: 5, url: "https://example.com/later.jpg" };
    const repository = store();
    vi.mocked(repository.listProducts).mockResolvedValue({
      items: [product([fallback, later])],
      summaries: [{ productId, minimumPriceMinor: 24999n, stockQuantity: 1 }],
      total: 1,
    });
    const result = await new CatalogService(repository).listProducts(query);
    expect(result.items[0]?.primaryMedia).toMatchObject({ type: "IMAGE", url: "https://example.com/fallback.jpg", isPrimary: false });
    expect(result.items[0]?.previewVideo).toBeNull();
  });

  it("uses one bounded public relation selection for four images and the first video", () => {
    expect(catalogProductListSelect.media.where).toMatchObject({
      type: { in: ["IMAGE", "VIDEO"] },
      OR: [{ variantId: null }, { variant: { isActive: true, deletedAt: null } }],
    });
    expect(catalogProductListSelect.media.take).toBe(5);
    expect(catalogProductListSelect.media.orderBy).toEqual([
      { type: "desc" },
      { isPrimary: "desc" },
      { position: "asc" },
      { id: "asc" },
    ]);
    expect(catalogProductListSelect.media.select).not.toHaveProperty("storageProvider");
    expect(catalogProductListSelect.media.select).not.toHaveProperty("storageKey");
  });

  it("returns localized, deduplicated public color filter options with colorHex", async () => {
    const repository = store();
    vi.mocked(repository.listColorOptions).mockResolvedValue([
      { value: "Blue", displayValue: "Blue", colorHex: "#2563EB", translations: [{ locale: "ar", displayValue: "أزرق" }] },
      { value: "blue", displayValue: "BLUE", colorHex: null, translations: [] },
    ]);
    const result = await new CatalogService(repository).listFilters("ar");
    expect(result).toEqual({ colors: [{ value: "Blue", displayValue: "أزرق", colorHex: "#2563EB" }] });
    expect(JSON.stringify(result)).not.toContain("metadataJson");
  });

  it("builds a bounded, localized Product Card color summary from eligible variant values", () => {
    const value = (id: string, color: string, position: number, colorHex: string | null, arabic?: string) => ({
      optionValue: {
        id,
        value: color,
        displayValue: color,
        colorHex,
        position,
        option: { position: 0 },
        translations: arabic ? [{ locale: "ar", displayValue: arabic }] : [],
      },
    });
    const summary = catalogColorSummary([
      { optionValues: [value("10000000-0000-4000-8000-000000000001", "Black", 0, null, "أسود"), value("20000000-0000-4000-8000-000000000002", "White", 1, "#FFFFFF", "أبيض")] },
      { optionValues: [value("10000000-0000-4000-8000-000000000002", "black", 0, "#000000", "أسود"), value("30000000-0000-4000-8000-000000000003", "Blue", 2, "#2563EB", "أزرق")] },
      { optionValues: [value("40000000-0000-4000-8000-000000000004", "Mystery", 3, null)] },
    ], "ar");

    expect(summary.colorCount).toBe(4);
    expect(summary.previewColors).toEqual([
      { value: "Black", displayValue: "أسود", colorHex: "#000000" },
      { value: "White", displayValue: "أبيض", colorHex: "#FFFFFF" },
      { value: "Blue", displayValue: "أزرق", colorHex: "#2563EB" },
    ]);
    expect(JSON.stringify(summary)).not.toContain("metadataJson");
  });

  it("loads canonical Product-specific colors in one bounded variant query", async () => {
    const secondProductId = "77777777-7777-4777-8777-777777777777";
    const firstVariantId = "88888888-8888-4888-8888-888888888881";
    const duplicateVariantId = "88888888-8888-4888-8888-888888888882";
    const secondVariantId = "88888888-8888-4888-8888-888888888883";
    const optionValue = (id: string, value: string, position: number, colorHex: string | null) => ({
      optionValue: { id, value, displayValue: value, colorHex, position, option: { position: 0 }, translations: [] },
    });
    const variant = (id: string, ownerId: string, values: ReturnType<typeof optionValue>[]) => ({
      id,
      productId: ownerId,
      priceMinor: 10_000n,
      stockQuantity: 1,
      optionValues: values,
      product: { productCategories: [], collectionProducts: [] },
    });
    const findVariants = vi.fn(async (_query: unknown) => [
      variant(firstVariantId, productId, [optionValue("90000000-0000-4000-8000-000000000001", "Black", 0, null)]),
      variant(duplicateVariantId, productId, [optionValue("90000000-0000-4000-8000-000000000002", "black", 0, "#000000")]),
      variant(secondVariantId, secondProductId, [optionValue("90000000-0000-4000-8000-000000000003", "Red", 0, "#FF0000")]),
    ]);
    const cards = [product(), { ...product(), id: secondProductId, slug: "second-shoe" }];
    const client = {
      $transaction: vi.fn(async (operations: Array<Promise<unknown>>) => Promise.all(operations)),
      product: { findMany: vi.fn(async () => cards), count: vi.fn(async () => cards.length) },
      productVariant: { findMany: findVariants },
    } as unknown as PrismaClient;
    const calculations = new Map([firstVariantId, duplicateVariantId, secondVariantId].map((variantId) => [variantId, {
      grandTotalMinor: 10_000n,
      totalDiscountMinor: 0n,
      discounts: [],
    }]));
    const pricing = { calculateCatalogLines: vi.fn(async () => calculations) } as unknown as CommercePricingService;

    const result = await new CatalogRepository(client, pricing).listProducts(query, new Date("2026-08-13T00:00:00.000Z"));

    expect(findVariants).toHaveBeenCalledTimes(1);
    const variantQuery = findVariants.mock.calls[0]![0] as { select: { optionValues: { select: unknown } } };
    expect(variantQuery).toMatchObject({
      where: { productId: { in: [productId, secondProductId] }, isActive: true, deletedAt: null },
      select: {
        optionValues: {
          where: { optionValue: { option: { name: { equals: "color", mode: "insensitive" } } } },
          select: { optionValue: { select: { id: true, value: true, displayValue: true, colorHex: true, position: true } } },
        },
      },
    });
    expect(result.summaries.find((summary) => summary.productId === productId)).toMatchObject({
      previewColors: [{ value: "Black", displayValue: "Black", colorHex: "#000000" }],
      colorCount: 1,
    });
    expect(result.summaries.find((summary) => summary.productId === secondProductId)).toMatchObject({
      previewColors: [{ value: "Red", displayValue: "Red", colorHex: "#FF0000" }],
      colorCount: 1,
    });
    expect(JSON.stringify(variantQuery.select.optionValues.select)).not.toContain("metadataJson");
  });

  it("exposes previewColors and total colorCount without changing Product Card media", async () => {
    const repository = store();
    vi.mocked(repository.listProducts).mockResolvedValue({
      items: [product([previewVideo, ...product().media])],
      summaries: [{
        productId,
        minimumPriceMinor: 24999n,
        stockQuantity: 1,
        previewColors: [
          { value: "Black", displayValue: "Black", colorHex: "#000000" },
          { value: "White", displayValue: "White", colorHex: "#FFFFFF" },
          { value: "Blue", displayValue: "Blue", colorHex: null },
        ],
        colorCount: 5,
      }],
      total: 1,
    });

    const item = (await new CatalogService(repository).listProducts(query)).items[0]!;
    expect(item.previewColors).toHaveLength(3);
    expect(item.colorCount).toBe(5);
    expect(item.primaryMedia?.type).toBe("IMAGE");
    expect(item.previewVideo?.type).toBe("VIDEO");
    expect(JSON.stringify(item)).not.toContain("metadataJson");
  });

  it("queries only canonical Color values linked to public products and variants with bounded safe fields", async () => {
    const findMany = vi.fn(async () => []);
    const client = { productOptionValue: { findMany } } as unknown as PrismaClient;
    const now = new Date("2026-08-13T00:00:00.000Z");
    await new CatalogRepository(client).listColorOptions(now);
    expect(findMany).toHaveBeenCalledWith(expect.objectContaining({
      take: 500,
      select: catalogColorFilterSelect,
      where: {
        option: {
          name: { equals: "color", mode: "insensitive" },
          product: expect.objectContaining({ status: "ACTIVE", deletedAt: null, variants: { some: { isActive: true, deletedAt: null } } }),
        },
        variants: { some: { variant: { isActive: true, deletedAt: null } } },
      },
    }));
    expect(catalogColorFilterSelect).not.toHaveProperty("metadataJson");
  });

  it("returns previewVideo from the shared Product Card mapping for related products", async () => {
    const repository = store();
    vi.mocked(repository.relatedProducts).mockResolvedValue({
      items: [{ ...product([previewVideo, ...product().media]), brandId, collectionProducts: [] }],
      summaries: [{ productId, minimumPriceMinor: 24999n, stockQuantity: 1 }],
    });
    const result = await new CatalogService(repository).relatedProducts("trail-shoe", 8);
    expect(result.items[0]?.primaryMedia?.type).toBe("IMAGE");
    expect(result.items[0]?.previewVideo).toMatchObject({ type: "VIDEO", mimeType: "video/mp4" });
  });

  it("keeps previewVideo on searched and filtered paginated card responses", async () => {
    const repository = store();
    vi.mocked(repository.listProducts).mockResolvedValue({
      items: [product([previewVideo, ...product().media])],
      summaries: [{ productId, minimumPriceMinor: 24999n, stockQuantity: 1 }],
      total: 21,
    });
    const result = await new CatalogService(repository).listProducts({
      ...query,
      page: 2,
      search: "trail",
      brand: "shoozy",
      category: "running",
      inStock: true,
    });
    expect(result.items[0]?.previewVideo?.type).toBe("VIDEO");
    expect(result.pagination).toEqual({ page: 2, limit: 20, total: 21, totalPages: 2 });
  });

  it("adds backward-compatible promotional prices for list and variant detail DTOs", async () => {
    const repository = store();
    const promotionalPricing = {
      variantId: categoryId,
      originalPriceMinor: 24999n,
      effectivePriceMinor: 19999n,
      discountMinor: 5000n,
      discountPercentageBasisPoints: 2000n,
      promotions: [{ discountId: brandId, name: "Weekend Sale", type: "FIXED_AMOUNT" as const, value: 5000n, amountMinor: 5000n, endsAt: null }],
    };
    vi.mocked(repository.listProducts).mockResolvedValue({
      items: [product()],
      summaries: [{ productId, minimumPriceMinor: 24999n, minimumEffectivePriceMinor: 19999n, stockQuantity: 1, promotionalPricing }],
      total: 1,
    });
    vi.mocked(repository.findProductBySlug).mockResolvedValue(Object.assign(detail(), { promotionPricing: new Map([[categoryId, promotionalPricing]]) }));
    const service = new CatalogService(repository);
    expect((await service.listProducts(query)).items[0]).toMatchObject({
      minimumVariantPriceMinor: "24999",
      minimumEffectivePriceMinor: "19999",
      promotionalPricing: { discountMinor: "5000", promotions: [{ name: "Weekend Sale", value: "5000" }] },
      previewVideo: null,
    });
    expect((await service.getProduct("trail-shoe")).variants[0]).toMatchObject({
      promotionalPricing: { originalPriceMinor: "24999", effectivePriceMinor: "19999" },
    });
  });

  it("returns a stable not-found for a product hidden by repository sellability rules", async () => {
    await expect(new CatalogService(store()).getProduct("draft-shoe"))
      .rejects.toMatchObject({ statusCode: 404, code: "PRODUCT_NOT_FOUND" });
  });

  it("builds a bounded category tree and pagination metadata", async () => {
    const repository = store();
    const childId = "44444444-4444-4444-8444-444444444444";
    vi.mocked(repository.listCategoryChildren)
      .mockResolvedValueOnce([{ id: childId, parentId: categoryId, name: "Trail", slug: "trail", description: null, imageUrl: null, videoUrl: null, videoMimeType: null, sortOrder: 0, _count: { productCategories: 0 }, translations: [] }])
      .mockResolvedValueOnce([]);
    const result = await new CatalogService(repository).categoryTree({ page: 1, limit: 20 });
    expect(result.items).toEqual([expect.objectContaining({
      id: categoryId,
      children: [expect.objectContaining({ id: childId })],
    })]);
    expect(result.pagination).toEqual({ page: 1, limit: 20, total: 1, totalPages: 1 });
    expect(repository.listCategories).not.toHaveBeenCalled();
  });

  it("hides a Product SizeGuide whose owning Brand is inactive", async () => {
    const repository = store();
    vi.mocked(repository.findProductBySlug).mockResolvedValue({
      ...detail(),
      sizeGuide: { id: categoryId, name: "Inactive guide", gender: null, brand: { isActive: false } },
    });
    expect((await new CatalogService(repository).getProduct("trail-shoe")).sizeGuide).toBeNull();
  });
});

describe("public catalog validation", () => {
  const parse = (queryValue: Record<string, unknown>) => listCatalogProductsSchema.safeParse({ body: {}, params: {}, query: queryValue });

  it("accepts supported discovery filters and trims search", () => {
    const result = parse({ search: " trail ", size: "42", color: "Black", minPriceMinor: "100", maxPriceMinor: "500", inStock: "true" });
    expect(result.success).toBe(true);
    if (result.success) expect(result.data.query.search).toBe("trail");
  });

  it("rejects unsafe money forms, inverted ranges, arbitrary sorting, and unknown filters", () => {
    for (const invalid of [
      { minPriceMinor: "1.5" },
      { minPriceMinor: "500", maxPriceMinor: "100" },
      { sort: "costMinor" },
      { orderBy: "costMinor" },
    ]) expect(parse(invalid).success).toBe(false);
  });
});
