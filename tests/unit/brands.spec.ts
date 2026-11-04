import { describe, expect, it, vi } from "vitest";
import { normalizeSlug } from "../../src/common/utils/slug";
import { BrandsRepositoryError } from "../../src/modules/brands/brands.repository";
import { BrandsService, type BrandsStore } from "../../src/modules/brands/brands.service";
import type { BrandRecord } from "../../src/modules/brands/brands.types";
import { brandSelect } from "../../src/modules/brands/brands.types";
import { createBrandSchema, listBrandsSchema, updateBrandSchema } from "../../src/modules/brands/brands.validation";

const brandId = "11111111-1111-4111-8111-111111111111";
function brand(overrides: Partial<BrandRecord> = {}): BrandRecord {
  return {
    id: brandId,
    name: "New Balance",
    slug: "new-balance",
    description: null,
    logoUrl: null,
    showcaseImageUrl: null,
    isActive: true,
    createdAt: new Date(),
    updatedAt: new Date(),
    _count: { products: 0 },
    translations: [],
    ...overrides,
  };
}
function store(): BrandsStore {
  return {
    list: vi.fn(async () => ({ items: [brand()], total: 21 })),
    findById: vi.fn(async (id) => id === brandId ? brand() : null),
    create: vi.fn(async (input) => brand(input)),
    update: vi.fn(async (id, input) => id === brandId ? brand(input) : "NOT_FOUND" as const),
    deleteIfUnused: vi.fn(async (id) => id === brandId ? "DELETED" as const : "NOT_FOUND" as const),
  };
}

describe("brand service", () => {
  it("returns numeric counts for empty and populated brands without exposing Prisma metadata", async () => {
    const repository = store();
    vi.mocked(repository.list).mockResolvedValue({ items: [brand(), brand({ id: "other", _count: { products: 2 } })], total: 2 });
    const service = new BrandsService(repository);
    const list = await service.list({ page: 1, limit: 20, sortBy: "createdAt", sortOrder: "desc" });
    expect(list.items.map((item) => item.productCount)).toEqual([0, 2]);
    expect((await service.get(brandId)).productCount).toBe(0);
    expect((await service.get(brandId)).showcaseImageUrl).toBeNull();
    expect(JSON.stringify(list)).not.toContain("_count");
    expect(brandSelect._count.select.products.where).toEqual({ deletedAt: null });
  });
  it("derives and normalizes a slug without transliterating Unicode", async () => {
    const repository = store();
    await new BrandsService(repository).create({ name: "  أحذية   رياضية  " });
    expect(repository.create).toHaveBeenCalledWith(expect.objectContaining({ slug: "أحذية-رياضية" }));
    expect(normalizeSlug(" New__Balance---Shoes ")).toBe("new-balance-shoes");
  });

  it("maps a concurrent slug collision to a stable conflict", async () => {
    const repository = store();
    vi.mocked(repository.create).mockRejectedValue(new BrandsRepositoryError("DUPLICATE_SLUG"));
    await expect(new BrandsService(repository).create({ name: "Nike" })).rejects.toMatchObject({
      statusCode: 409,
      code: "BRAND_SLUG_ALREADY_EXISTS",
    });
  });

  it("returns bounded pagination metadata", async () => {
    const result = await new BrandsService(store()).list({
      page: 2,
      limit: 20,
      sortBy: "createdAt",
      sortOrder: "desc",
    });
    expect(result.pagination).toEqual({ page: 2, limit: 20, total: 21, totalPages: 2 });
  });

  it("blocks referenced deletion", async () => {
    const repository = store();
    vi.mocked(repository.deleteIfUnused).mockResolvedValue("IN_USE");
    await expect(new BrandsService(repository).delete(brandId)).rejects.toMatchObject({
      statusCode: 409,
      code: "BRAND_IN_USE",
    });
  });
  it("prevents deactivating a brand required by an active product", async () => {
    const repository = store();
    vi.mocked(repository.update).mockResolvedValue("WOULD_INVALIDATE_PRODUCT");
    await expect(new BrandsService(repository).update(brandId, { isActive: false })).rejects.toMatchObject({
      code: "PRODUCT_WOULD_BECOME_INVALID",
    });
  });
});

describe("brand validation", () => {
  it("rejects mass-assignment and invalid URLs", () => {
    expect(createBrandSchema.safeParse({ body: { name: "Nike", id: brandId }, params: {}, query: {} }).success).toBe(false);
    expect(createBrandSchema.safeParse({ body: { name: "Nike", logoUrl: "not-a-url" }, params: {}, query: {} }).success).toBe(false);
    expect(createBrandSchema.safeParse({ body: { name: "Nike", showcaseImageUrl: "not-a-url" }, params: {}, query: {} }).success).toBe(false);
  });

  it("accepts the explicit showcase removal flag only on update", () => {
    expect(updateBrandSchema.safeParse({ body: { removeShowcaseImage: true }, params: { brandId }, query: {} }).success).toBe(true);
    expect(createBrandSchema.safeParse({ body: { name: "Nike", removeShowcaseImage: true }, params: {}, query: {} }).success).toBe(false);
  });

  it("rejects invalid pagination and parses filters", () => {
    expect(listBrandsSchema.safeParse({ body: {}, params: {}, query: { page: "0" } }).success).toBe(false);
    expect(listBrandsSchema.safeParse({ body: {}, params: {}, query: { limit: "101" } }).success).toBe(false);
    const parsed = listBrandsSchema.parse({ body: {}, params: {}, query: { isActive: "false", search: " nike " } });
    expect(parsed.query).toMatchObject({ isActive: false, search: "nike", page: 1, limit: 20 });
  });
});
