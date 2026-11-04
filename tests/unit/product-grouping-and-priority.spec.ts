import { Prisma } from "@prisma/client";
import { describe, expect, it, vi } from "vitest";
import { ProductsRepositoryError } from "../../src/modules/products/products.repository";
import { ProductsService, type ProductsStore } from "../../src/modules/products/products.service";
import type { ProductRecord } from "../../src/modules/products/products.types";
import { CatalogService, type CatalogStore } from "../../src/modules/catalog/catalog.service";
import type { CatalogProductDetailRecord, ColorVariantDto } from "../../src/modules/catalog/catalog.types";
import { ratingSummaryFromGroups } from "../../src/modules/reviews/rating-summary";

const productId = "11111111-1111-4111-8111-111111111111";
const targetProductId = "22222222-2222-4222-8222-222222222222";
const targetGroupId = "33333333-3333-4333-8333-333333333333";
const brandId = "44444444-4444-4444-8444-444444444444";

function product(overrides: Partial<ProductRecord> = {}): ProductRecord {
  return {
    id: productId,
    groupId: productId,
    brandId,
    sizeGuideId: null,
    name: "Air Motion",
    slug: "air-motion",
    skuPrefix: null,
    colorName: "Triple White",
    colorHex: "#FFFFFF",
    isFeatured: false,
    priority: 0,
    shortDescription: null,
    basePrice: new Prisma.Decimal("199.99"),
    compareAtPrice: null,
    description: null,
    material: null,
    gender: null,
    season: null,
    status: "DRAFT",
    seoTitle: null,
    seoDescription: null,
    publishedAt: null,
    createdAt: new Date(),
    updatedAt: new Date(),
    deletedAt: null,
    translations: [],
    media: [],
    ...overrides,
  };
}

function productStore(): ProductsStore {
  return {
    list: vi.fn(async () => ({ items: [product()], total: 1 })),
    findById: vi.fn(async (id) => {
      if (id === targetProductId) {
        return product({ id: targetProductId, groupId: targetGroupId, name: "Air Motion OG", colorName: "Black" });
      }
      if (id === productId) return product();
      return null;
    }),
    findDetail: vi.fn(async () => null),
    findBrand: vi.fn(async (id) => ({ id, isActive: true })),
    findSizeGuide: vi.fn(async () => null),
    readiness: vi.fn(async () => null),
    searchModels: vi.fn(async () => [
      {
        groupId: targetGroupId,
        sampleProductId: targetProductId,
        name: "Air Motion",
        brandName: "Shoozy",
        thumbnail: "https://example.com/thumb.jpg",
        colorCount: 3,
      },
    ]),
    create: vi.fn(async (input) => product({
      ...input,
      basePrice: new Prisma.Decimal(input.basePrice),
      compareAtPrice: input.compareAtPrice ? new Prisma.Decimal(input.compareAtPrice) : null,
    })),
    update: vi.fn(async (id, input) => product({
      ...input,
      id,
      basePrice: input.basePrice ? new Prisma.Decimal(input.basePrice) : new Prisma.Decimal("199.99"),
    })),
    activate: vi.fn(async () => product()),
    replaceCategories: vi.fn(async () => "UPDATED" as const),
    softDelete: vi.fn(async () => true),
  };
}

describe("Product Grouping & Priority (Phase 2)", () => {
  describe("ProductsService", () => {
    it("creates a product linked to an existing model group and derives color slug", async () => {
      const store = productStore();
      const service = new ProductsService(store);

      const result = await service.create({
        brandId,
        name: "Air Motion",
        colorName: "Solar Red",
        colorHex: "#FF0000",
        basePrice: "199.99",
        linkToProductId: targetProductId,
      });

      expect(store.findById).toHaveBeenCalledWith(targetProductId);
      expect(store.create).toHaveBeenCalledWith(expect.objectContaining({
        groupId: targetGroupId,
        colorName: "Solar Red",
        colorHex: "#FF0000",
        slug: "air-motion-solar-red",
        status: "DRAFT",
      }));
      expect(result.groupId).toBe(targetGroupId);
    });

    it("requires colorName when linking to an existing model product", async () => {
      const store = productStore();
      const service = new ProductsService(store);

      await expect(service.create({
        brandId,
        name: "Air Motion",
        basePrice: "199.99",
        linkToProductId: targetProductId,
      })).rejects.toMatchObject({
        statusCode: 422,
        code: "PRODUCT_COLOR_NAME_REQUIRED",
      });
    });

    it("throws 404 when linkToProductId target does not exist", async () => {
      const store = productStore();
      const service = new ProductsService(store);

      await expect(service.create({
        brandId,
        name: "Air Motion",
        colorName: "Gold",
        basePrice: "199.99",
        linkToProductId: "00000000-0000-4000-8000-000000000000",
      })).rejects.toMatchObject({
        statusCode: 404,
        code: "TARGET_PRODUCT_NOT_FOUND",
      });
    });

    it("maps DUPLICATE_GROUP_COLOR repository error to 409 PRODUCT_COLOR_ALREADY_EXISTS", async () => {
      const store = productStore();
      vi.mocked(store.create).mockRejectedValue(new ProductsRepositoryError("DUPLICATE_GROUP_COLOR"));
      const service = new ProductsService(store);

      await expect(service.create({
        brandId,
        name: "Air Motion",
        colorName: "Black",
        basePrice: "199.99",
        linkToProductId: targetProductId,
      })).rejects.toMatchObject({
        statusCode: 409,
        code: "PRODUCT_COLOR_ALREADY_EXISTS",
      });
    });

    it("unlinks product from group on update when unlinkFromGroup is true", async () => {
      const store = productStore();
      const service = new ProductsService(store);

      await service.update(productId, {
        unlinkFromGroup: true,
      });

      expect(store.update).toHaveBeenCalledWith(productId, expect.objectContaining({
        groupId: expect.any(String),
      }));
      const calledGroupId = vi.mocked(store.update).mock.calls[0]![1].groupId;
      expect(calledGroupId).not.toBe(targetGroupId);
    });

    it("updates isFeatured and priority flags", async () => {
      const store = productStore();
      const service = new ProductsService(store);

      await service.update(productId, {
        isFeatured: true,
        priority: 100,
      });

      expect(store.update).toHaveBeenCalledWith(productId, expect.objectContaining({
        isFeatured: true,
        priority: 100,
      }));
    });

    it("delegates searchModels query to repository", async () => {
      const store = productStore();
      const service = new ProductsService(store);

      const models = await service.searchModels({ q: "Motion" });
      expect(store.searchModels).toHaveBeenCalledWith({ q: "Motion" });
      expect(models).toHaveLength(1);
      expect(models[0]!.name).toBe("Air Motion");
      expect(models[0]!.colorCount).toBe(3);
    });
  });

  describe("CatalogService ColorVariants & Priority", () => {
    function catalogStore(): CatalogStore {
      const mockDetail: CatalogProductDetailRecord & { colorVariants: ColorVariantDto[]; promotionPricing: Map<any, any>; ratingSummary: any } = {
        id: productId,
        groupId: targetGroupId,
        name: "Air Motion",
        slug: "air-motion-white",
        colorName: "Triple White",
        colorHex: "#FFFFFF",
        isFeatured: true,
        priority: 50,
        shortDescription: "Iconic shoe",
        description: "Full description",
        material: "Leather",
        basePrice: new Prisma.Decimal("199.99"),
        compareAtPrice: null,
        gender: "unisex",
        season: "all",
        seoTitle: "Air Motion White",
        seoDescription: "White Air Motion",
        publishedAt: new Date("2026-08-01T00:00:00Z"),
        translations: [],
        brand: { id: brandId, name: "Shoozy", slug: "shoozy", translations: [] },
        productCategories: [],
        media: [],
        options: [],
        variants: [],
        sizeGuide: null,
        collectionProducts: [],
        colorVariants: [
          {
            id: productId,
            slug: "air-motion-white",
            colorName: "Triple White",
            colorHex: "#FFFFFF",
            thumbnail: "https://example.com/white.jpg",
            inStock: true,
            isCurrent: true,
            basePrice: "199.99",
          },
          {
            id: targetProductId,
            slug: "air-motion-black",
            colorName: "Triple Black",
            colorHex: "#000000",
            thumbnail: "https://example.com/black.jpg",
            inStock: false,
            isCurrent: false,
            basePrice: "199.99",
          },
        ],
        promotionPricing: new Map(),
        ratingSummary: ratingSummaryFromGroups([]),
      };

      return {
        findProductBySlug: vi.fn(async () => mockDetail),
        listProducts: vi.fn(async () => ({ items: [], summaries: [], total: 0 })),
        listColorOptions: vi.fn(async () => []),
        relatedProducts: vi.fn(async () => null),
        listBrands: vi.fn(async () => ({ items: [], total: 0 })),
        listPromotions: vi.fn(async () => []),
        listCategories: vi.fn(async () => ({ items: [], total: 0 })),
        listCategoryRoots: vi.fn(async () => ({ items: [] })),
        listCategoryChildren: vi.fn(async () => []),
        listCollections: vi.fn(async () => ({ items: [], total: 0 })),
        findCollection: vi.fn(async () => null),
        findSizeGuide: vi.fn(async () => null),
      };
    }

    it("returns colorVariants in PDP response with active and out-of-stock colorways", async () => {
      const store = catalogStore();
      const service = new CatalogService(store);

      const productDetail = await service.getProduct("air-motion-white");
      expect(productDetail).toBeDefined();
      expect(productDetail.colorVariants).toHaveLength(2);
      expect(productDetail.colorVariants[0]).toMatchObject({
        slug: "air-motion-white",
        colorName: "Triple White",
        isCurrent: true,
        inStock: true,
      });
      expect(productDetail.colorVariants[1]).toMatchObject({
        slug: "air-motion-black",
        colorName: "Triple Black",
        isCurrent: false,
        inStock: false,
      });
    });
  });
});

