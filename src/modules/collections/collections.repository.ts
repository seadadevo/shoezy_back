import type { Prisma, PrismaClient } from "@prisma/client";
import { prisma } from "../../config/database";
import { AppError } from "../../common/errors/app-error";
import { AuditLogService } from "../admin-audit/audit-log.service";
import { isSerializableTransactionConflict } from "../../common/utils/prisma-transaction";
import { isCheckConstraintError } from "../../common/utils/prisma-errors";
import { isUniqueConstraintError } from "../auth/auth.errors";
import {
  collectionDetailSelect,
  collectionSelect,
  type CollectionDetailRecord,
  type CollectionRecord,
} from "./collections.types";
import type {
  CreateCollectionInput,
  ListCollectionsQuery,
  ReplaceCollectionProductsInput,
  UpdateCollectionInput,
} from "./collections.validation";
import { upsertTranslations } from "../../common/localization/catalog-localization";

export class CollectionsRepositoryError extends Error {
  constructor(public readonly code: "DUPLICATE_SLUG" | "INVALID_DATE_RANGE") { super(code); }
}

type CollectionVideoMetadata = {
  videoUrl?: string | null;
  videoMimeType?: string | null;
  videoStorageProvider?: string | null;
  videoStorageKey?: string | null;
};
type PersistedCollectionInput = Omit<CreateCollectionInput, "slug" | "startsAt" | "endsAt"> & CollectionVideoMetadata & {
  slug: string;
  startsAt?: Date | null;
  endsAt?: Date | null;
};
type PersistedCollectionUpdate = Omit<UpdateCollectionInput, "startsAt" | "endsAt" | "removeVideo"> & CollectionVideoMetadata & {
  startsAt?: Date | null;
  endsAt?: Date | null;
};

export class CollectionsRepository {
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

  async list(query: ListCollectionsQuery): Promise<{ items: CollectionRecord[]; total: number }> {
    const where: Prisma.CollectionWhereInput = {
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
      this.client.collection.findMany({
        where,
        skip: (query.page - 1) * query.limit,
        take: query.limit,
        orderBy: [{ [query.sortBy]: query.sortOrder }, { id: "asc" }],
        select: collectionSelect,
      }),
      this.client.collection.count({ where }),
    ]);
    return { items, total };
  }

  findById(collectionId: string): Promise<CollectionDetailRecord | null> {
    return this.client.collection.findUnique({ where: { id: collectionId }, select: collectionDetailSelect });
  }

  private async syncProducts(transaction: Prisma.TransactionClient, collectionId: string, products: ReplaceCollectionProductsInput["products"]) {
    const productIds = products.map((product) => product.productId);
    const valid = await transaction.product.count({ where: { id: { in: productIds }, deletedAt: null } });
    if (valid !== productIds.length) throw new AppError(404, "Product not found", "PRODUCT_NOT_FOUND");
    await transaction.collectionProduct.deleteMany({ where: { collectionId } });
    if (products.length) await transaction.collectionProduct.createMany({ data: products.map((product) => ({ collectionId, ...product })) });
  }

  async create(input: PersistedCollectionInput, actorId?: string): Promise<CollectionRecord> {
    const { products, translations, ...collection } = input;
    try { return await this.serializable(async (tx) => {
      const created = await tx.collection.create({ data: collection, select: { id: true } });
      if (products !== undefined) await this.syncProducts(tx, created.id, products);
      const values = translations ?? { en: { name: input.name, description: input.description } };
      await upsertTranslations(values, (locale, fields) => tx.collectionTranslation.upsert({ where: { collectionId_locale: { collectionId: created.id, locale } }, create: { collectionId: created.id, locale, ...fields }, update: fields }));
      if (actorId) await new AuditLogService().record({ actorUserId: actorId, action: "COLLECTION_CREATE", entityType: "COLLECTION", entityId: created.id }, tx);
      return tx.collection.findUniqueOrThrow({ where: { id: created.id }, select: collectionSelect });
    }); }
    catch (error: unknown) {
      if (isUniqueConstraintError(error)) throw new CollectionsRepositoryError("DUPLICATE_SLUG");
      if (isCheckConstraintError(error)) throw new CollectionsRepositoryError("INVALID_DATE_RANGE");
      throw error;
    }
  }

  async update(collectionId: string, input: PersistedCollectionUpdate, actorId?: string): Promise<CollectionRecord | null> {
    const { products, translations, ...collection } = input;
    try {
      return await this.serializable(async (tx) => {
        const current = await tx.collection.findUnique({ where: { id: collectionId }, select: { id: true } });
        if (!current) return null;
        if (Object.keys(collection).length) await tx.collection.update({ where: { id: collectionId }, data: collection });
        if (products !== undefined) await this.syncProducts(tx, collectionId, products);
        await upsertTranslations(translations, (locale, fields) => tx.collectionTranslation.upsert({ where: { collectionId_locale: { collectionId, locale } }, create: { collectionId, locale, ...fields }, update: fields }));
        if (actorId) await new AuditLogService().record({ actorUserId: actorId, action: "COLLECTION_UPDATE", entityType: "COLLECTION", entityId: collectionId }, tx);
        return tx.collection.findUniqueOrThrow({ where: { id: collectionId }, select: collectionSelect });
      });
    } catch (error: unknown) {
      if (isUniqueConstraintError(error)) throw new CollectionsRepositoryError("DUPLICATE_SLUG");
      if (isCheckConstraintError(error)) throw new CollectionsRepositoryError("INVALID_DATE_RANGE");
      throw error;
    }
  }

  replaceProducts(collectionId: string, input: ReplaceCollectionProductsInput): Promise<
    "UPDATED" | "COLLECTION_NOT_FOUND" | "PRODUCT_NOT_FOUND"
  > {
    return this.serializable(async (transaction) => {
      const collection = await transaction.collection.findUnique({
        where: { id: collectionId },
        select: { id: true },
      });
      if (!collection) return "COLLECTION_NOT_FOUND";
      const productIds = input.products.map((product) => product.productId);
      const validProducts = await transaction.product.count({
        where: { id: { in: productIds }, deletedAt: null },
      });
      if (validProducts !== productIds.length) return "PRODUCT_NOT_FOUND";
      await transaction.collectionProduct.deleteMany({ where: { collectionId } });
      if (input.products.length) {
        await transaction.collectionProduct.createMany({
          data: input.products.map((product) => ({ collectionId, ...product })),
        });
      }
      return "UPDATED";
    });
  }

  async delete(collectionId: string): Promise<boolean> {
    return this.serializable(async (transaction) => {
      const collection = await transaction.collection.findUnique({
        where: { id: collectionId },
        select: { id: true },
      });
      if (!collection) return false;
      await transaction.collection.delete({ where: { id: collectionId } });
      return true;
    });
  }
}
