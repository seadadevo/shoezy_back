import { randomUUID } from "node:crypto";
import { PrismaPg } from "@prisma/adapter-pg";
import { PrismaClient } from "@prisma/client";
import { afterAll, beforeAll, describe, expect, it } from "vitest";
import { CatalogRepository } from "../../src/modules/catalog/catalog.repository";
import { CatalogService } from "../../src/modules/catalog/catalog.service";
import { BrandsRepository } from "../../src/modules/brands/brands.repository";
import { CategoriesRepository } from "../../src/modules/categories/categories.repository";
import { CollectionsRepository } from "../../src/modules/collections/collections.repository";
import { ReviewsRepository } from "../../src/modules/reviews/reviews.repository";
import { ReviewsService } from "../../src/modules/reviews/reviews.service";
import { ShippingPreviewRepository } from "../../src/modules/shipping/shipping-preview.repository";
import { ShippingPreviewService } from "../../src/modules/shipping/shipping-preview.service";
import { resolveShippingRate } from "../../src/modules/shipping/shipping-zone-pricing";

const testDatabaseUrl = process.env.TEST_DATABASE_URL;
const describeDatabase = testDatabaseUrl ? describe : describe.skip;

describeDatabase("Task 15 public Catalog against disposable PostgreSQL", () => {
  if (!testDatabaseUrl) return;
  const databaseName = new URL(testDatabaseUrl).pathname.slice(1);
  if (databaseName !== "shoe_store_tasks13_26_validation" || databaseName.includes("shineup")) throw new Error(`Unsafe TEST_DATABASE_URL database: ${databaseName}`);
  const prisma = new PrismaClient({ adapter: new PrismaPg({ connectionString: testDatabaseUrl }) });
  const service = new CatalogService(new CatalogRepository(prisma));
  const productIds: string[] = [];
  const categoryIds: string[] = [];
  const brandIds: string[] = [];
  const collectionIds: string[] = [];
  const sizeGuideIds: string[] = [];
  const userIds: string[] = [];
  const shippingMethodIds: string[] = [];
  const shippingZoneIds: string[] = [];

  beforeAll(async () => {
    const identity = await prisma.$queryRaw<Array<{ database: string }>>`SELECT current_database() AS database`;
    expect(identity[0]?.database).toBe("shoe_store_tasks13_26_validation");
  });
  afterAll(async () => {
    if (productIds.length) await prisma.product.deleteMany({ where: { id: { in: productIds } } });
    if (userIds.length) await prisma.user.deleteMany({ where: { id: { in: userIds } } });
    if (shippingZoneIds.length) await prisma.shippingZone.deleteMany({ where: { id: { in: shippingZoneIds } } });
    if (shippingMethodIds.length) await prisma.shippingMethod.deleteMany({ where: { id: { in: shippingMethodIds } } });
    if (collectionIds.length) await prisma.collection.deleteMany({ where: { id: { in: collectionIds } } });
    if (sizeGuideIds.length) await prisma.sizeGuide.deleteMany({ where: { id: { in: sizeGuideIds } } });
    if (categoryIds.length) await prisma.category.deleteMany({ where: { id: { in: categoryIds } } });
    if (brandIds.length) await prisma.brand.deleteMany({ where: { id: { in: brandIds } } });
    await prisma.$disconnect();
  });

  async function createProduct(state: { status?: "DRAFT" | "ACTIVE"; deleted?: boolean; brandActive?: boolean; categoryActive?: boolean; variantActive?: boolean; variantDeleted?: boolean; stock?: number }) {
    const brandId = randomUUID(); const categoryId = randomUUID(); const productId = randomUUID();
    brandIds.push(brandId); categoryIds.push(categoryId); productIds.push(productId);
    await prisma.brand.create({ data: { id: brandId, name: `Catalog ${brandId}`, slug: `catalog-${brandId}`, isActive: state.brandActive ?? true } });
    await prisma.category.create({ data: { id: categoryId, name: `Catalog ${categoryId}`, slug: `catalog-${categoryId}`, isActive: state.categoryActive ?? true } });
    await prisma.product.create({ data: {
      id: productId, brandId, name: `Catalog ${productId}`, slug: `catalog-${productId}`, status: state.status ?? "ACTIVE", publishedAt: new Date("2026-08-12T00:00:00.000Z"), deletedAt: state.deleted ? new Date() : null,
      productCategories: { create: { categoryId, isPrimary: true } },
      variants: { create: { sku: `CAT-${randomUUID()}`, title: "Default", isActive: state.variantActive ?? true, deletedAt: state.variantDeleted ? new Date() : null, stockQuantity: state.stock ?? 0, priceMinor: 100n, costMinor: 50n } },
    } });
    return productId;
  }

  it("shows only sellable products, keeps zero stock visible, and never exposes cost", async () => {
    const visible = await createProduct({ stock: 0 });
    await createProduct({ status: "DRAFT" });
    await createProduct({ deleted: true });
    await createProduct({ brandActive: false });
    await createProduct({ categoryActive: false });
    await createProduct({ variantActive: false });
    await createProduct({ variantDeleted: true });
    const result = await service.listProducts({ page: 1, limit: 100, sort: "newest" }, new Date("2026-08-13T00:00:00.000Z"));
    expect(result.items.map((item) => item.id)).toContain(visible);
    expect(result.items.find((item) => item.id === visible)?.inStock).toBe(false);
    expect(result.items.filter((item) => productIds.includes(item.id))).toHaveLength(1);
    expect(JSON.stringify(result)).not.toContain("costMinor");
  });

  it("filters Variant media and time-bounds Collection membership in Product detail", async () => {
    const productId = await createProduct({ stock: 1 });
    const product = await prisma.product.findUniqueOrThrow({ where: { id: productId }, include: { variants: true } });
    const activeVariant = product.variants[0]!;
    const inactiveVariant = await prisma.productVariant.create({ data: { productId, sku: `CAT-${randomUUID()}`, title: "Inactive", isActive: false, priceMinor: 100n } });
    const deletedVariant = await prisma.productVariant.create({ data: { productId, sku: `CAT-${randomUUID()}`, title: "Deleted", deletedAt: new Date(), priceMinor: 100n } });
    await prisma.productMedia.createMany({ data: [
      { productId, type: "IMAGE", url: "https://example.com/product.jpg", isPrimary: true },
      { productId, variantId: activeVariant.id, type: "IMAGE", url: "https://example.com/active.jpg" },
      { productId, variantId: inactiveVariant.id, type: "IMAGE", url: "https://example.com/inactive.jpg" },
      { productId, variantId: deletedVariant.id, type: "IMAGE", url: "https://example.com/deleted.jpg" },
    ] });
    const now = new Date("2026-08-13T12:00:00.000Z");
    const collections = await Promise.all([
      prisma.collection.create({ data: { name: `Current ${randomUUID()}`, slug: `current-${randomUUID()}`, isActive: true, startsAt: new Date("2026-08-13T00:00:00.000Z"), endsAt: new Date("2026-08-14T00:00:00.000Z") } }),
      prisma.collection.create({ data: { name: `Future ${randomUUID()}`, slug: `future-${randomUUID()}`, isActive: true, startsAt: new Date("2026-08-14T00:00:00.000Z") } }),
      prisma.collection.create({ data: { name: `Expired ${randomUUID()}`, slug: `expired-${randomUUID()}`, isActive: true, endsAt: now } }),
    ]);
    collectionIds.push(...collections.map((collection) => collection.id));
    await prisma.collectionProduct.createMany({ data: collections.map((collection) => ({ collectionId: collection.id, productId })) });
    const inactiveBrandId = randomUUID(); brandIds.push(inactiveBrandId);
    await prisma.brand.create({ data: { id: inactiveBrandId, name: `Inactive ${inactiveBrandId}`, slug: `inactive-${inactiveBrandId}`, isActive: false } });
    const sizeGuideId = randomUUID(); sizeGuideIds.push(sizeGuideId);
    await prisma.sizeGuide.create({ data: { id: sizeGuideId, brandId: inactiveBrandId, name: `Guide ${sizeGuideId}` } });
    await prisma.product.update({ where: { id: productId }, data: { sizeGuideId } });

    const detail = await service.getProduct(product.slug, now);
    expect(detail.media.map((media) => media.url)).toEqual([
      "https://example.com/product.jpg",
      "https://example.com/active.jpg",
    ]);
    expect(detail.collections.map((collection) => collection.id)).toEqual([collections[0]!.id]);
    expect(detail.sizeGuide).toBeNull();
    expect(JSON.stringify(detail)).not.toContain("metadataJson");
    expect(JSON.stringify(detail)).not.toContain("deletedAt");
  });

  it("counts direct non-deleted admin assignments and only public-visible products", async () => {
    const brandId = randomUUID();
    const parentId = randomUUID();
    const childId = randomUUID();
    const collectionId = randomUUID();
    brandIds.push(brandId);
    categoryIds.push(parentId, childId);
    collectionIds.push(collectionId);
    await prisma.brand.create({ data: { id: brandId, name: `Count ${brandId}`, slug: `count-${brandId}` } });
    await prisma.category.create({ data: { id: parentId, name: `Parent ${parentId}`, slug: `parent-${parentId}` } });
    await prisma.category.create({ data: { id: childId, parentId, name: `Child ${childId}`, slug: `child-${childId}` } });
    await prisma.collection.create({ data: { id: collectionId, name: `Count ${collectionId}`, slug: `count-${collectionId}` } });

    async function assigned(status: "ACTIVE" | "DRAFT", categoryId: string, deletedAt: Date | null = null) {
      const id = randomUUID();
      productIds.push(id);
      await prisma.product.create({ data: {
        id, brandId, name: `Count ${id}`, slug: `count-${id}`, status,
        publishedAt: new Date("2026-08-12T00:00:00.000Z"), deletedAt,
        productCategories: { create: { categoryId, isPrimary: true } },
        variants: { create: { sku: `COUNT-${randomUUID()}`, title: "Default", priceMinor: 100n } },
        collectionProducts: { create: { collectionId } },
      } });
    }
    await assigned("ACTIVE", parentId);
    await assigned("ACTIVE", parentId);
    await assigned("DRAFT", parentId);
    await assigned("ACTIVE", parentId, new Date());
    await assigned("ACTIVE", childId);

    const adminBrand = await new BrandsRepository(prisma).findById(brandId);
    const adminParent = await new CategoriesRepository(prisma).findById(parentId);
    const adminChild = await new CategoriesRepository(prisma).findById(childId);
    const adminCollection = await new CollectionsRepository(prisma).findById(collectionId);
    expect(adminBrand?._count.products).toBe(4);
    expect(adminParent?._count.productCategories).toBe(3);
    expect(adminChild?._count.productCategories).toBe(1);
    expect(adminCollection?._count.collectionProducts).toBe(4);

    const now = new Date("2026-08-13T12:00:00.000Z");
    const query = { page: 1, limit: 100 };
    const brands = await service.listBrands(query, now);
    const categories = await service.listCategories(query, "en", now);
    const tree = await service.categoryTree(query, "en", now);
    const collections = await service.listCollections(query, now);
    const detail = await service.getCollection(`count-${collectionId}`, query, now);
    expect(brands.items.find((item) => item.id === brandId)?.productCount).toBe(3);
    expect(categories.items.find((item) => item.id === parentId)?.productCount).toBe(2);
    expect(categories.items.find((item) => item.id === childId)?.productCount).toBe(1);
    const parent = tree.items.find((item) => typeof item === "object" && item !== null && "id" in item && item.id === parentId);
    expect(parent).toMatchObject({ productCount: 2, children: [expect.objectContaining({ id: childId, productCount: 1 })] });
    expect(collections.items.find((item) => item.id === collectionId)?.productCount).toBe(3);
    expect(detail.productCount).toBe(3);
    expect(detail.products.pagination.total).toBe(3);
  });

  it("uses only approved published reviews for detail and review distribution", async () => {
    const productId = await createProduct({});
    const userId = randomUUID(); userIds.push(userId);
    await prisma.user.create({ data: { id: userId, email: `rating-${userId}@example.com`, firstName: "Rating", lastName: "Buyer" } });
    await prisma.productReview.createMany({ data: [
      { productId, userId, rating: 5, status: "APPROVED", publishedAt: new Date("2026-08-13T00:00:00Z") },
      { productId, userId, rating: 4, status: "APPROVED", publishedAt: new Date("2026-08-13T00:00:00Z") },
      { productId, userId, rating: 1, status: "PENDING" },
      { productId, userId, rating: 1, status: "REJECTED" },
    ] });
    const now = new Date("2026-08-14T00:00:00Z");
    const detail = await service.getProduct(`catalog-${productId}`, now);
    expect(detail.ratingSummary).toMatchObject({
      average: 4.5, count: 2, distribution: { 5: { count: 1, percentage: 50 }, 4: { count: 1, percentage: 50 }, 1: { count: 0, percentage: 0 } },
    });
    const reviews = await new ReviewsService(new ReviewsRepository(prisma)).listPublic(productId, { page: 1, limit: 20, sort: "newest" }, now);
    expect(reviews.items).toHaveLength(2);
    expect(reviews.aggregate).toMatchObject({ count: 2, averageRating: "4.5", distribution: detail.ratingSummary.distribution });
  });

  it("ranks public related products and excludes source, drafts, and deleted products", async () => {
    const sourceId = await createProduct({});
    const source = await prisma.product.findUniqueOrThrow({ where: { id: sourceId }, include: { productCategories: true } });
    const categoryId = source.productCategories[0]!.categoryId;
    const sameCategory = await createProduct({});
    const sameBrand = await createProduct({});
    const draft = await createProduct({ status: "DRAFT" });
    const deleted = await createProduct({ deleted: true });
    for (const id of [sameCategory, draft, deleted]) await prisma.productCategory.create({ data: { productId: id, categoryId } });
    await prisma.product.update({ where: { id: sameBrand }, data: { brandId: source.brandId } });
    const result = await service.relatedProducts(source.slug, 3, new Date("2026-08-14T00:00:00Z"));
    const ids = result.items.map((item) => item.id);
    expect(ids[0]).toBe(sameCategory);
    expect(ids).toContain(sameBrand);
    expect(ids).not.toContain(sourceId);
    expect(ids).not.toContain(draft);
    expect(ids).not.toContain(deleted);
    expect(new Set(ids).size).toBe(ids.length);
    expect(JSON.stringify(result)).not.toContain("costMinor");
  });

  it("previews checkout-identical zone rates without mutating commerce records", async () => {
    const productId = await createProduct({});
    const state = `Preview ${randomUUID()}`;
    const method = await prisma.shippingMethod.create({ data: { code: `PREVIEW-${randomUUID()}`, name: "Preview Standard", currency: "TND", basePriceMinor: 999n, estimatedMinDays: 3, estimatedMaxDays: 5 } });
    const express = await prisma.shippingMethod.create({ data: { code: `EXPRESS-${randomUUID()}`, name: "Preview Express", currency: "TND", basePriceMinor: 1999n } });
    const disabled = await prisma.shippingMethod.create({ data: { code: `DISABLED-${randomUUID()}`, name: "Preview Disabled", currency: "TND", basePriceMinor: 2999n, isActive: false } });
    shippingMethodIds.push(method.id, express.id, disabled.id);
    const zone = await prisma.shippingZone.create({ data: { code: `ZONE-${randomUUID()}`, name: "Preview Zone" } });
    shippingZoneIds.push(zone.id);
    await prisma.shippingZoneArea.create({ data: { zoneId: zone.id, countryCode: "TN", state, stateKey: state.toLowerCase(), city: "Tunis", cityKey: "tunis", areaKey: "" } });
    await prisma.shippingZoneRate.createMany({ data: [
      { zoneId: zone.id, shippingMethodId: method.id, priceMinor: 2500n, currency: "TND", estimatedMinDays: 2, estimatedMaxDays: 4 },
      { zoneId: zone.id, shippingMethodId: express.id, priceMinor: 4000n, currency: "TND", estimatedMinDays: 1, estimatedMaxDays: 2 },
      { zoneId: zone.id, shippingMethodId: disabled.id, priceMinor: 5000n, currency: "TND" },
    ] });
    const countsBefore = await Promise.all([prisma.order.count(), prisma.cart.count()]);
    const address = { countryCode: "TN", state, city: "Tunis", area: null };
    const preview = await new ShippingPreviewService(new ShippingPreviewRepository(prisma)).preview(`catalog-${productId}`, address);
    const standardPreview = preview.methods.find((item) => item.id === method.id);
    expect(standardPreview).toMatchObject({ priceMinor: "2500", currency: "TND", estimatedMinDays: 2, estimatedMaxDays: 4 });
    expect(preview.methods.find((item) => item.id === express.id)?.priceMinor).toBe("4000");
    expect(preview.methods.map((item) => item.id)).not.toContain(disabled.id);
    const checkout = await prisma.$transaction((tx) => resolveShippingRate(tx, address, method));
    expect(checkout).toMatchObject({ priceMinor: 2500n, estimatedMinDays: 2, estimatedMaxDays: 4 });
    const unavailable = await new ShippingPreviewService(new ShippingPreviewRepository(prisma)).preview(`catalog-${productId}`, { ...address, countryCode: "FR" });
    expect(unavailable).toEqual({ available: false, methods: [] });
    expect(await Promise.all([prisma.order.count(), prisma.cart.count()])).toEqual(countsBefore);
  });
});
