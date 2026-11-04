import { Prisma } from "@prisma/client";
import { describe, expect, it, vi } from "vitest";
import { ProductsRepositoryError } from "../../src/modules/products/products.repository";
import { ProductsService, type ProductsStore } from "../../src/modules/products/products.service";
import type { ProductDetailRecord, ProductReadinessRecord, ProductRecord } from "../../src/modules/products/products.types";
import { createProductSchema, replaceProductCategoriesSchema } from "../../src/modules/products/products.validation";

const productId = "11111111-1111-4111-8111-111111111111";
const brandId = "22222222-2222-4222-8222-222222222222";
const categoryId = "33333333-3333-4333-8333-333333333333";
const replacementBrandId = "44444444-4444-4444-8444-444444444444";
function product(overrides: Partial<ProductRecord> = {}): ProductRecord { return {
  id: productId, brandId, sizeGuideId: null, name: "Trail Shoe", slug: "trail-shoe", skuPrefix: null,
  shortDescription: null, basePrice: new Prisma.Decimal("249.99"), compareAtPrice: null,
  description: null, material: null, gender: null, season: null, status: "DRAFT", seoTitle: null,
  seoDescription: null, publishedAt: null, createdAt: new Date(), updatedAt: new Date(), deletedAt: null, translations: [], media: [], ...overrides,
}; }
function readiness(overrides: Partial<ProductReadinessRecord> = {}): ProductReadinessRecord { return {
  brand: { isActive: true }, productCategories: [{ isPrimary: true, category: { isActive: true } }], options: [], variants: [], ...overrides,
}; }
function store(): ProductsStore {
  return {
    list: vi.fn(async () => ({ items: [product()], total: 1 })),
    findById: vi.fn(async (id) => id === productId ? product() : null),
    findDetail: vi.fn(async (id) => id === productId ? { ...product(), brand: { id: brandId, name: "Brand", slug: "brand", isActive: true, translations: [] }, sizeGuide: null, productCategories: [], media: [] } as ProductDetailRecord : null),
    findBrand: vi.fn(async (id) => id === brandId ? { id, isActive: true } : null),
    findSizeGuide: vi.fn(async () => null), readiness: vi.fn(async () => readiness()),
    create: vi.fn(async (input) => product({ ...input, basePrice: new Prisma.Decimal(input.basePrice), compareAtPrice: input.compareAtPrice ? new Prisma.Decimal(input.compareAtPrice) : null })),
    update: vi.fn(async (id, input) => id === productId ? product({ ...input, basePrice: input.basePrice ? new Prisma.Decimal(input.basePrice) : new Prisma.Decimal("249.99"), compareAtPrice: input.compareAtPrice === undefined ? null : input.compareAtPrice === null ? null : new Prisma.Decimal(input.compareAtPrice) }) : null),
    activate: vi.fn(async (id, input, validate) => { const state = readiness(); validate(state); return id === productId ? product({ ...input, basePrice: input.basePrice ? new Prisma.Decimal(input.basePrice) : new Prisma.Decimal("249.99"), compareAtPrice: input.compareAtPrice === undefined ? null : input.compareAtPrice === null ? null : new Prisma.Decimal(input.compareAtPrice) }) : null; }),
    replaceCategories: vi.fn(async () => "UPDATED" as const), softDelete: vi.fn(async (id) => id === productId),
  };
}

describe("product service", () => {
  it("creates DRAFT, normalizes slug, and serializes Decimal prices", async () => {
    const repository = store(); const result = await new ProductsService(repository).create({ brandId, name: " Trail   Shoe ", basePrice: "249.99" });
    expect(result.status).toBe("DRAFT"); expect(result.basePrice).toBe("249.99");
    expect(repository.create).toHaveBeenCalledWith(expect.objectContaining({ slug: "trail-shoe", status: "DRAFT" }));
  });
  it("rejects invalid relations and a lower compare-at price", async () => {
    await expect(new ProductsService(store()).create({ brandId: categoryId, name: "Shoe", basePrice: "10.00" })).rejects.toMatchObject({ code: "BRAND_NOT_FOUND" });
    await expect(new ProductsService(store()).create({ brandId, name: "Shoe", basePrice: "10.00", compareAtPrice: "9.99" })).rejects.toMatchObject({ code: "PRODUCT_PRICE_INVALID" });
  });
  it("maps concurrent slug collision", async () => {
    const repository = store(); vi.mocked(repository.create).mockRejectedValue(new ProductsRepositoryError("DUPLICATE_SLUG"));
    await expect(new ProductsService(repository).create({ brandId, name: "Shoe", basePrice: "10.00" })).rejects.toMatchObject({ statusCode: 409, code: "PRODUCT_SLUG_ALREADY_EXISTS" });
  });
  it("rejects activation before any valid variant exists", async () => {
    await expect(new ProductsService(store()).update(productId, { status: "ACTIVE" })).rejects.toMatchObject({ code: "PRODUCT_NOT_READY" });
  });
  it("activates with a valid zero-stock variant and controls publishedAt", async () => {
    const repository = store();
    vi.mocked(repository.activate).mockImplementation(async (id, input, validate) => {
      validate(readiness({ variants: [{ priceMinor: 0n, costMinor: null, compareAtPriceMinor: null, optionValues: [] }] }));
      return id === productId ? product({ status: "ACTIVE", publishedAt: input.publishedAt ?? null }) : null;
    });
    const result = await new ProductsService(repository).update(productId, { status: "ACTIVE" });
    expect(result.status).toBe("ACTIVE");
    expect(repository.activate).toHaveBeenCalledWith(productId, expect.objectContaining({
      status: "ACTIVE",
      publishedAt: expect.any(Date),
    }), expect.any(Function));
  });
  it("rejects activation with an inactive brand", async () => {
    const repository = store();
    vi.mocked(repository.activate).mockImplementation(async (_id, _input, validate) => {
      validate(readiness({ brand: { isActive: false }, variants: [{ priceMinor: 0n, costMinor: null, compareAtPriceMinor: null, optionValues: [] }] }));
      return null;
    });
    await expect(new ProductsService(repository).update(productId, { status: "ACTIVE" })).rejects.toMatchObject({ code: "PRODUCT_NOT_READY" });
  });
  it("rolls back an inactive Brand reassignment when an ACTIVE product omits status", async () => {
    const repository = store();
    vi.mocked(repository.findById).mockResolvedValue(product({ status: "ACTIVE", publishedAt: new Date(), brandId }));
    vi.mocked(repository.findBrand).mockResolvedValue({ id: replacementBrandId, isActive: false });
    vi.mocked(repository.activate).mockImplementation(async (_id, _input, validate) => {
      validate(readiness({ brand: { isActive: false }, variants: [{ priceMinor: 0n, costMinor: null, compareAtPriceMinor: null, optionValues: [] }] }));
      return null;
    });
    await expect(new ProductsService(repository).update(productId, { brandId: replacementBrandId })).rejects.toMatchObject({ code: "PRODUCT_NOT_READY" });
    expect(repository.update).not.toHaveBeenCalled();
    expect(repository.activate).toHaveBeenCalledWith(productId, expect.objectContaining({ brandId: replacementBrandId }), expect.any(Function));
  });
  it("allows a safe field update on an ACTIVE product and keeps it ACTIVE", async () => {
    const repository = store();
    vi.mocked(repository.findById).mockResolvedValue(product({ status: "ACTIVE", publishedAt: new Date() }));
    vi.mocked(repository.activate).mockResolvedValue(product({ status: "ACTIVE", name: "Updated", publishedAt: new Date() }));
    await expect(new ProductsService(repository).update(productId, { name: "Updated" })).resolves.toMatchObject({ status: "ACTIVE", name: "Updated" });
    expect(repository.activate).toHaveBeenCalled();
  });
  it("allows an ACTIVE product to move to another active Brand when readiness remains valid", async () => {
    const repository = store();
    vi.mocked(repository.findById).mockResolvedValue(product({ status: "ACTIVE", publishedAt: new Date() }));
    vi.mocked(repository.findBrand).mockResolvedValue({ id: replacementBrandId, isActive: true });
    vi.mocked(repository.activate).mockResolvedValue(product({ status: "ACTIVE", brandId: replacementBrandId, publishedAt: new Date() }));
    await expect(new ProductsService(repository).update(productId, { brandId: replacementBrandId })).resolves.toMatchObject({ status: "ACTIVE", brandId: replacementBrandId });
  });
  it("allows ACTIVE to DRAFT without readiness validation and retains publishedAt", async () => {
    const publishedAt = new Date();
    const repository = store();
    vi.mocked(repository.findById).mockResolvedValue(product({ status: "ACTIVE", publishedAt }));
    vi.mocked(repository.update).mockResolvedValue(product({ status: "DRAFT", publishedAt }));
    await expect(new ProductsService(repository).update(productId, { status: "DRAFT" })).resolves.toMatchObject({ status: "DRAFT", publishedAt });
    expect(repository.activate).not.toHaveBeenCalled();
  });
  it("maps invalid category replacement and soft-deletes", async () => {
    const repository = store(); vi.mocked(repository.replaceCategories).mockResolvedValue("CATEGORY_NOT_FOUND");
    await expect(new ProductsService(repository).replaceCategories(productId, { categoryIds: [categoryId], primaryCategoryId: categoryId })).rejects.toMatchObject({ code: "CATEGORY_NOT_FOUND" });
    await expect(new ProductsService(store()).delete(productId)).resolves.toBeUndefined();
  });
  it("prevents an active product category replacement from becoming invalid", async () => {
    const repository = store();
    vi.mocked(repository.replaceCategories).mockResolvedValue("WOULD_INVALIDATE");
    await expect(new ProductsService(repository).replaceCategories(productId, {
      categoryIds: [],
      primaryCategoryId: null,
    })).rejects.toMatchObject({ code: "PRODUCT_WOULD_BECOME_INVALID" });
  });
});

describe("product validation", () => {
  it("requires decimal strings and rejects direct active creation", () => {
    const request = (body: unknown) => ({ body, params: {}, query: {} });
    expect(createProductSchema.safeParse(request({ brandId, name: "Shoe", basePrice: 12.34 })).success).toBe(false);
    expect(createProductSchema.safeParse(request({ brandId, name: "Shoe", basePrice: "12.34", status: "ACTIVE" })).success).toBe(false);
    expect(createProductSchema.safeParse(request({ brandId, name: "Shoe", basePrice: "-1" })).success).toBe(false);
  });
  it("enforces unique categories and an included primary", () => {
    const parse = (body: unknown) => replaceProductCategoriesSchema.safeParse({ body, params: { productId }, query: {} }).success;
    expect(parse({ categoryIds: [categoryId, categoryId], primaryCategoryId: categoryId })).toBe(false);
    expect(parse({ categoryIds: [], primaryCategoryId: categoryId })).toBe(false);
    expect(parse({ categoryIds: [], primaryCategoryId: null })).toBe(true);
  });
});
