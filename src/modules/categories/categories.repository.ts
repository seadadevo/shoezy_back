import type { Prisma, PrismaClient } from "@prisma/client";
import { prisma } from "../../config/database";
import { isSerializableTransactionConflict } from "../../common/utils/prisma-transaction";
import { isUniqueConstraintError } from "../auth/auth.errors";
import { categorySelect, type CategoryRecord } from "./categories.types";
import type { CreateCategoryInput, ListCategoriesQuery, UpdateCategoryInput } from "./categories.validation";
import { upsertTranslations } from "../../common/localization/catalog-localization";

export class CategoriesRepositoryError extends Error {
  constructor(public readonly code: "DUPLICATE_SLUG") { super(code); }
}

type CategoryVideoMetadata = {
  videoUrl?: string | null;
  videoMimeType?: string | null;
  videoStorageProvider?: string | null;
  videoStorageKey?: string | null;
};
type PersistedCategoryUpdate = Omit<UpdateCategoryInput, "removeVideo"> & CategoryVideoMetadata;

export class CategoriesRepository {
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

  async list(query: ListCategoriesQuery): Promise<{ items: CategoryRecord[]; total: number }> {
    const where: Prisma.CategoryWhereInput = {
      isActive: query.isActive,
      parentId: query.parentId,
      ...(query.search ? { OR: [
        { name: { contains: query.search, mode: "insensitive" } },
        { slug: { contains: query.search, mode: "insensitive" } },
        { translations: { some: { OR: [{ name: { contains: query.search, mode: "insensitive" } }, { description: { contains: query.search, mode: "insensitive" } }] } } },
      ] } : {}),
    };
    const [items, total] = await this.client.$transaction([
      this.client.category.findMany({ where, skip: (query.page - 1) * query.limit, take: query.limit,
        orderBy: [{ [query.sortBy]: query.sortOrder }, { name: "asc" }, { id: "asc" }], select: categorySelect }),
      this.client.category.count({ where }),
    ]);
    return { items, total };
  }
  listAll(): Promise<CategoryRecord[]> {
    return this.client.category.findMany({ orderBy: [{ sortOrder: "asc" }, { name: "asc" }, { id: "asc" }], select: categorySelect });
  }
  listParentLinks(): Promise<Array<{ id: string; parentId: string | null }>> {
    return this.client.category.findMany({ select: { id: true, parentId: true } });
  }
  findById(categoryId: string): Promise<CategoryRecord | null> {
    return this.client.category.findUnique({ where: { id: categoryId }, select: categorySelect });
  }
  async create(input: CreateCategoryInput & { slug: string } & CategoryVideoMetadata): Promise<CategoryRecord> {
    try { return await this.serializable(async (transaction) => {
      const { translations, ...data } = input;
      const created = await transaction.category.create({ data, select: { id: true } });
      const values = translations ?? { en: { name: input.name, description: input.description } };
      await upsertTranslations(values, (locale, fields) => transaction.categoryTranslation.upsert({ where: { categoryId_locale: { categoryId: created.id, locale } }, create: { categoryId: created.id, locale, ...fields }, update: fields }));
      return transaction.category.findUniqueOrThrow({ where: { id: created.id }, select: categorySelect });
    }); }
    catch (error: unknown) { if (isUniqueConstraintError(error)) throw new CategoriesRepositoryError("DUPLICATE_SLUG"); throw error; }
  }
  async update(categoryId: string, input: PersistedCategoryUpdate): Promise<CategoryRecord | "NOT_FOUND" | "PARENT_NOT_FOUND" | "SELF_PARENT" | "CYCLE" | "TREE_INVALID" | "WOULD_INVALIDATE_PRODUCT"> {
    try {
      return await this.serializable(async (transaction) => {
        const { translations, ...data } = input;
        const current = await transaction.category.findUnique({ where: { id: categoryId }, select: { id: true, isActive: true } });
        if (!current) return "NOT_FOUND";
        if (data.parentId !== undefined && data.parentId !== null) {
          if (data.parentId === categoryId) return "SELF_PARENT";
          const links = await transaction.category.findMany({ select: { id: true, parentId: true } });
          const parents = new Map(links.map((link) => [link.id, link.parentId]));
          if (!parents.has(data.parentId)) return "PARENT_NOT_FOUND";
          const visited = new Set<string>();
          let cursor: string | null | undefined = data.parentId;
          while (cursor) {
            if (cursor === categoryId) return "CYCLE";
            if (visited.has(cursor)) return "TREE_INVALID";
            visited.add(cursor);
            cursor = parents.get(cursor);
          }
        }
        if (Object.keys(data).length) await transaction.category.update({ where: { id: categoryId }, data });
        await upsertTranslations(translations, (locale, fields) => transaction.categoryTranslation.upsert({ where: { categoryId_locale: { categoryId, locale } }, create: { categoryId, locale, ...fields }, update: fields }));
        return transaction.category.findUniqueOrThrow({ where: { id: categoryId }, select: categorySelect });
      });
    } catch (error: unknown) { if (isUniqueConstraintError(error)) throw new CategoriesRepositoryError("DUPLICATE_SLUG"); throw error; }
  }
  deleteIfUnused(categoryId: string): Promise<"DELETED" | "HAS_CHILDREN" | "IN_USE" | "NOT_FOUND"> {
    return this.client.$transaction(async (transaction) => {
      if (!await transaction.category.findUnique({ where: { id: categoryId }, select: { id: true } })) return "NOT_FOUND";
      if (await transaction.category.count({ where: { parentId: categoryId } })) return "HAS_CHILDREN";
      const [products, discounts] = await Promise.all([
        transaction.productCategory.count({ where: { categoryId } }),
        transaction.discountTarget.count({ where: { categoryId } }),
      ]);
      if (products > 0 || discounts > 0) return "IN_USE";
      await transaction.category.delete({ where: { id: categoryId } });
      return "DELETED";
    }, { isolationLevel: "Serializable" });
  }
}
