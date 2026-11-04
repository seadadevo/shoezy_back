import type { Prisma, PrismaClient } from "@prisma/client";
import { prisma } from "../../config/database";
import { isUniqueConstraintError } from "../auth/auth.errors";
import { isSerializableTransactionConflict } from "../../common/utils/prisma-transaction";
import { productSelect, type ProductDetailRecord, type ProductReadinessRecord, type ProductRecord } from "./products.types";
import { optionSelect } from "./product-options.types";
import { variantSelect } from "../variants/variants.types";
import { productMediaSelect } from "./product-media.types";
import type { CreateProductInput, ListProductsQuery, ReplaceProductCategoriesInput, UpdateProductInput } from "./products.validation";
import { upsertTranslations } from "../../common/localization/catalog-localization";
export class ProductsRepositoryError extends Error { constructor(public readonly code: "DUPLICATE_SLUG" | "DUPLICATE_GROUP_COLOR") { super(code); } }
export const detailSelect = { ...productSelect,
  brand: { select: { id: true, name: true, slug: true, isActive: true, translations: { orderBy: { locale: "asc" }, select: { locale: true, name: true, description: true } } } }, sizeGuide: { select: { id: true, name: true } },
  productCategories: { orderBy: [{ isPrimary: "desc" }, { category: { name: "asc" } }], select: { isPrimary: true, category: { select: { id: true, name: true, slug: true, isActive: true, translations: { orderBy: { locale: "asc" }, select: { locale: true, name: true, description: true } } } } } },
  options: { orderBy: [{ position: "asc" }, { id: "asc" }], select: optionSelect },
  variants: { where: { deletedAt: null }, orderBy: [{ createdAt: "asc" }, { id: "asc" }], select: variantSelect },
  media: { orderBy: [{ position: "asc" }, { id: "asc" }], select: productMediaSelect },
} satisfies Prisma.ProductSelect;
export const readinessSelect = {
  brand: { select: { isActive: true } }, productCategories: { select: { isPrimary: true, category: { select: { isActive: true } } } }, options: { select: { id: true } },
  variants: { where: { isActive: true, deletedAt: null }, select: { priceMinor: true, costMinor: true, compareAtPriceMinor: true, optionValues: { select: { optionValue: { select: { option: { select: { id: true, productId: true } } } } } } } },
} satisfies Prisma.ProductSelect;
export class ProductsRepository {
  constructor(private readonly client: PrismaClient = prisma) {}
  private async serializable<T>(operation: (tx: Prisma.TransactionClient) => Promise<T>) { for (let attempt = 1; attempt <= 3; attempt += 1) { try { return await this.client.$transaction(operation, { isolationLevel: "Serializable" }); } catch (error: unknown) { if (!isSerializableTransactionConflict(error) || attempt === 3) throw error; } } throw new Error("Serializable retry exhausted"); }
  async searchModels(query: { q?: string; excludeProductId?: string }): Promise<Array<{
    id: string;
    sampleProductId: string;
    groupId: string;
    name: string;
    sampleSlug: string;
    slug: string;
    colorName: string | null;
    brandName: string | null;
    thumbnail: string | null;
    colorsCount: number;
  }>> {
    const where: Prisma.ProductWhereInput = {
      deletedAt: null,
      ...(query.excludeProductId ? { id: { not: query.excludeProductId } } : {}),
      ...(query.q ? {
        OR: [
          { name: { contains: query.q, mode: "insensitive" } },
          { slug: { contains: query.q, mode: "insensitive" } },
        ],
      } : {}),
    };

    const products = await this.client.product.findMany({
      where,
      orderBy: [{ priority: "desc" }, { createdAt: "desc" }],
      take: 40,
      select: {
        id: true,
        name: true,
        groupId: true,
        colorName: true,
        slug: true,
        brand: { select: { name: true } },
        media: {
          where: { isPrimary: true, type: "IMAGE" },
          take: 1,
          select: { url: true },
        },
      },
    });

    const seenGroups = new Set<string>();
    const models = [];
    for (const p of products) {
      if (!seenGroups.has(p.groupId)) {
        seenGroups.add(p.groupId);
        const colorsCount = await this.client.product.count({
          where: { groupId: p.groupId, deletedAt: null },
        });
        models.push({
          id: p.id,
          sampleProductId: p.id,
          groupId: p.groupId,
          name: p.name,
          sampleSlug: p.slug,
          slug: p.slug,
          colorName: p.colorName,
          brandName: p.brand?.name ?? null,
          thumbnail: p.media[0]?.url ?? null,
          colorsCount: Math.max(colorsCount, 1),
        });
      }
    }
    return models;
  }

  async list(query: ListProductsQuery): Promise<{ items: ProductRecord[]; total: number }> {
    const where: Prisma.ProductWhereInput = { deletedAt: query.includeDeleted ? undefined : null, status: query.status, brandId: query.brandId,
      ...(query.categoryId ? { productCategories: { some: { categoryId: query.categoryId } } } : {}),
      ...(query.search ? { OR: [{ name: { contains: query.search, mode: "insensitive" } }, { slug: { contains: query.search, mode: "insensitive" } }, { skuPrefix: { contains: query.search, mode: "insensitive" } }, { translations: { some: { OR: [{ name: { contains: query.search, mode: "insensitive" } }, { description: { contains: query.search, mode: "insensitive" } }, { shortDescription: { contains: query.search, mode: "insensitive" } }] } } }] } : {}) };
    const [items, total] = await this.client.$transaction([
      this.client.product.findMany({ where, skip: (query.page - 1) * query.limit, take: query.limit, orderBy: [{ [query.sortBy]: query.sortOrder }, { id: "asc" }], select: productSelect }), this.client.product.count({ where }),
    ]); return { items, total };
  }
  findById(productId: string, includeDeleted = false): Promise<ProductRecord | null> { return this.client.product.findFirst({ where: { id: productId, deletedAt: includeDeleted ? undefined : null }, select: productSelect }); }
  findDetail(productId: string): Promise<ProductDetailRecord | null> { return this.client.product.findFirst({ where: { id: productId, deletedAt: null }, select: detailSelect }); }
  findBrand(brandId: string): Promise<{ id: string; isActive: boolean } | null> { return this.client.brand.findUnique({ where: { id: brandId }, select: { id: true, isActive: true } }); }
  findSizeGuide(sizeGuideId: string): Promise<{ id: string } | null> { return this.client.sizeGuide.findUnique({ where: { id: sizeGuideId }, select: { id: true } }); }
  readiness(productId: string): Promise<ProductReadinessRecord | null> { return this.client.product.findUnique({ where: { id: productId }, select: readinessSelect }); }
  async create(input: CreateProductInput & { slug: string; groupId?: string }): Promise<ProductRecord> {
    try { return await this.serializable(async (transaction) => {
      const { translations, ...data } = input;
      const created = await transaction.product.create({ data: { ...data, status: "DRAFT" }, select: { id: true } });
      const values = translations ?? { en: { name: input.name, shortDescription: input.shortDescription, description: input.description, material: input.material, seoTitle: input.seoTitle, seoDescription: input.seoDescription } };
      await upsertTranslations(values, (locale, fields) => transaction.productTranslation.upsert({ where: { productId_locale: { productId: created.id, locale } }, create: { productId: created.id, locale, ...fields }, update: fields }));
      return transaction.product.findUniqueOrThrow({ where: { id: created.id }, select: productSelect });
    }); } catch (error: unknown) {
      if (isUniqueConstraintError(error)) {
        const msg = error instanceof Error ? error.message : "";
        if (msg.includes("products_group_color_uniq") || msg.includes("group_id") || msg.includes("color_name")) {
          throw new ProductsRepositoryError("DUPLICATE_GROUP_COLOR");
        }
        throw new ProductsRepositoryError("DUPLICATE_SLUG");
      }
      throw error;
    }
  }
  async update(productId: string, input: UpdateProductInput & { publishedAt?: Date }): Promise<ProductRecord | null> {
    try { return await this.serializable(async (transaction) => {
      const { translations, ...data } = input;
      const current = await transaction.product.findFirst({ where: { id: productId, deletedAt: null }, select: { id: true } });
      if (!current) return null;
      if (Object.keys(data).length) await transaction.product.update({ where: { id: productId }, data });
      await upsertTranslations(translations, (locale, fields) => transaction.productTranslation.upsert({ where: { productId_locale: { productId, locale } }, create: { productId, locale, ...fields }, update: fields }));
      return transaction.product.findUniqueOrThrow({ where: { id: productId }, select: productSelect });
    }); } catch (error: unknown) { if (isUniqueConstraintError(error)) throw new ProductsRepositoryError("DUPLICATE_SLUG"); throw error; }
  }
  async activate(productId: string, input: UpdateProductInput & { publishedAt?: Date }, validate: (state: ProductReadinessRecord) => void): Promise<ProductRecord | null> {
    try { return await this.serializable(async (transaction) => {
      const { translations, ...data } = input;
      const result = await transaction.product.updateMany({ where: { id: productId, deletedAt: null }, data });
      if (result.count !== 1) return null;
      await upsertTranslations(translations, (locale, fields) => transaction.productTranslation.upsert({ where: { productId_locale: { productId, locale } }, create: { productId, locale, ...fields }, update: fields }));
      const state = await transaction.product.findUnique({ where: { id: productId }, select: readinessSelect });
      if (!state) return null;
      validate(state);
      return transaction.product.findUnique({ where: { id: productId }, select: productSelect });
    }); } catch (error: unknown) { if (isUniqueConstraintError(error)) throw new ProductsRepositoryError("DUPLICATE_SLUG"); throw error; }
  }
  replaceCategories(productId: string, input: ReplaceProductCategoriesInput): Promise<"UPDATED" | "PRODUCT_NOT_FOUND" | "CATEGORY_NOT_FOUND" | "WOULD_INVALIDATE"> { return this.serializable(async (transaction) => {
    const product = await transaction.product.findFirst({ where: { id: productId, deletedAt: null }, select: { id: true, status: true } }); if (!product) return "PRODUCT_NOT_FOUND";
    const categories = await transaction.category.findMany({ where: { id: { in: input.categoryIds } }, select: { id: true, isActive: true } }); if (categories.length !== input.categoryIds.length) return "CATEGORY_NOT_FOUND";
    if (product.status === "ACTIVE" && (categories.every((category) => !category.isActive) || (input.primaryCategoryId !== null && !categories.find((category) => category.id === input.primaryCategoryId)?.isActive))) return "WOULD_INVALIDATE";
    await transaction.productCategory.deleteMany({ where: { productId } }); if (input.categoryIds.length) await transaction.productCategory.createMany({ data: input.categoryIds.map((categoryId) => ({ productId, categoryId, isPrimary: categoryId === input.primaryCategoryId })) }); return "UPDATED";
  }); }
  async softDelete(productId: string): Promise<boolean> { return (await this.client.product.updateMany({ where: { id: productId, deletedAt: null }, data: { deletedAt: new Date(), status: "DRAFT" } })).count === 1; }
}
