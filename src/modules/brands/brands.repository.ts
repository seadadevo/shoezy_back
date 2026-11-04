import type { Prisma, PrismaClient } from "@prisma/client";
import { prisma } from "../../config/database";
import { isSerializableTransactionConflict } from "../../common/utils/prisma-transaction";
import { isUniqueConstraintError } from "../auth/auth.errors";
import { brandSelect, type BrandRecord } from "./brands.types";
import type { CreateBrandInput, ListBrandsQuery, UpdateBrandInput } from "./brands.validation";
import { upsertTranslations } from "../../common/localization/catalog-localization";

export class BrandsRepositoryError extends Error {
  constructor(public readonly code: "DUPLICATE_SLUG") { super(code); }
}

type PersistedBrandUpdate = Omit<UpdateBrandInput, "removeShowcaseImage">;

export class BrandsRepository {
  constructor(private readonly client: PrismaClient = prisma) {}

  private async serializable<T>(operation: (transaction: Prisma.TransactionClient) => Promise<T>): Promise<T> {
    for (let attempt = 1; attempt <= 3; attempt += 1) {
      try { return await this.client.$transaction(operation, { isolationLevel: "Serializable" }); }
      catch (error: unknown) {
        if (!isSerializableTransactionConflict(error) || attempt === 3) throw error;
      }
    }
    throw new Error("Serializable retry exhausted");
  }

  async list(query: ListBrandsQuery): Promise<{ items: BrandRecord[]; total: number }> {
    const where: Prisma.BrandWhereInput = {
      isActive: query.isActive,
      ...(query.search ? {
        OR: [
          { name: { contains: query.search, mode: "insensitive" } },
          { slug: { contains: query.search, mode: "insensitive" } },
          { translations: { some: { OR: [{ name: { contains: query.search, mode: "insensitive" } }, { description: { contains: query.search, mode: "insensitive" } }] } } },
        ],
      } : {}),
    };
    const [items, total] = await this.client.$transaction([
      this.client.brand.findMany({
        where,
        skip: (query.page - 1) * query.limit,
        take: query.limit,
        orderBy: [{ [query.sortBy]: query.sortOrder }, { id: "asc" }],
        select: brandSelect,
      }),
      this.client.brand.count({ where }),
    ]);
    return { items, total };
  }

  findById(brandId: string): Promise<BrandRecord | null> {
    return this.client.brand.findUnique({ where: { id: brandId }, select: brandSelect });
  }

  async create(input: CreateBrandInput & { slug: string }): Promise<BrandRecord> {
    try {
      return await this.serializable(async (transaction) => {
        const { translations, ...data } = input;
        const created = await transaction.brand.create({ data, select: { id: true } });
        const values = translations ?? { en: { name: input.name, description: input.description } };
        await upsertTranslations(values, (locale, fields) => transaction.brandTranslation.upsert({
          where: { brandId_locale: { brandId: created.id, locale } }, create: { brandId: created.id, locale, ...fields }, update: fields,
        }));
        return transaction.brand.findUniqueOrThrow({ where: { id: created.id }, select: brandSelect });
      });
    } catch (error: unknown) {
      if (isUniqueConstraintError(error)) throw new BrandsRepositoryError("DUPLICATE_SLUG");
      throw error;
    }
  }

  async update(brandId: string, input: PersistedBrandUpdate): Promise<BrandRecord | "NOT_FOUND" | "WOULD_INVALIDATE_PRODUCT"> {
    try {
      return await this.serializable(async (transaction) => {
          const { translations, ...data } = input;
          const current = await transaction.brand.findUnique({ where: { id: brandId }, select: { isActive: true } });
          if (!current) return "NOT_FOUND";
          if (data.isActive === false && current.isActive && await transaction.product.count({ where: { brandId, status: "ACTIVE", deletedAt: null } }) > 0) {
            return "WOULD_INVALIDATE_PRODUCT";
          }
          if (Object.keys(data).length) await transaction.brand.update({ where: { id: brandId }, data });
          await upsertTranslations(translations, (locale, fields) => transaction.brandTranslation.upsert({
            where: { brandId_locale: { brandId, locale } }, create: { brandId, locale, ...fields }, update: fields,
          }));
          return transaction.brand.findUniqueOrThrow({ where: { id: brandId }, select: brandSelect });
        });
    } catch (error: unknown) {
      if (isUniqueConstraintError(error)) throw new BrandsRepositoryError("DUPLICATE_SLUG");
      throw error;
    }
  }

  deleteIfUnused(brandId: string): Promise<"DELETED" | "IN_USE" | "NOT_FOUND"> {
    return this.client.$transaction(async (transaction) => {
      const brand = await transaction.brand.findUnique({ where: { id: brandId }, select: { id: true } });
      if (!brand) return "NOT_FOUND";
      const [products, guides] = await Promise.all([
        transaction.product.count({ where: { brandId } }),
        transaction.sizeGuide.count({ where: { brandId } }),
      ]);
      if (products > 0 || guides > 0) return "IN_USE";
      await transaction.brand.delete({ where: { id: brandId } });
      return "DELETED";
    }, { isolationLevel: "Serializable" });
  }
}
