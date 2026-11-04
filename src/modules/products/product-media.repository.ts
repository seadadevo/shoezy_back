import type { Prisma, PrismaClient } from "@prisma/client";
import { prisma } from "../../config/database";
import { isSerializableTransactionConflict } from "../../common/utils/prisma-transaction";
import { isUniqueConstraintError } from "../auth/auth.errors";
import {
  productMediaSelect,
  productVideoRecordSelect,
  type ProductMediaRecord,
  type ProductVideoRecord,
} from "./product-media.types";
import type {
  CreateProductMediaInput,
  ListProductMediaQuery,
  UpdateProductMediaInput,
} from "./product-media.validation";

export type ProductMediaMutationResult =
  | { status: "OK"; media: ProductMediaRecord }
  | { status: "PRODUCT_NOT_FOUND" }
  | { status: "MEDIA_NOT_FOUND" }
  | { status: "VARIANT_NOT_FOUND" };

export class ProductMediaRepositoryError extends Error {
  constructor(public readonly code: "PRIMARY_CONFLICT" | "VIDEO_CANNOT_BE_PRIMARY" | "VIDEO_LIMIT_EXCEEDED") { super(code); }
}

export class ProductMediaRepository {
  constructor(private readonly client: PrismaClient = prisma) {}

  async validateUploadTarget(productId: string, variantId?: string): Promise<"OK" | "PRODUCT_NOT_FOUND" | "VARIANT_NOT_FOUND"> {
    const product = await this.client.product.findFirst({ where: { id: productId, deletedAt: null }, select: { id: true } });
    if (!product) return "PRODUCT_NOT_FOUND";
    if (variantId && await this.client.productVariant.count({ where: { id: variantId, productId, deletedAt: null } }) !== 1) return "VARIANT_NOT_FOUND";
    return "OK";
  }

  async findVideo(productId: string): Promise<ProductVideoRecord | null> {
    return await this.client.productMedia.findFirst({
      where: { productId, OR: [{ type: "VIDEO" }, { mediaType: "VIDEO" }] },
      select: productVideoRecordSelect,
    });
  }

  private async serializable<T>(operation: (transaction: Prisma.TransactionClient) => Promise<T>): Promise<T> {
    for (let attempt = 1; attempt <= 3; attempt += 1) {
      try {
        return await this.client.$transaction(operation, { isolationLevel: "Serializable" });
      } catch (error: unknown) {
        if (!isSerializableTransactionConflict(error) || attempt === 3) throw error;
      }
    }
    throw new Error("Serializable retry exhausted");
  }

  private async lockActiveProduct(transaction: Prisma.TransactionClient, productId: string): Promise<boolean> {
    const locked = await transaction.$queryRaw<Array<{ id: string; deleted_at: Date | null }>>`
      SELECT "id", "deleted_at"
      FROM "products"
      WHERE "id" = ${productId}::uuid
      FOR UPDATE
    `;
    return locked.length === 1 && locked[0]?.deleted_at === null;
  }

  private async variantBelongsToProduct(
    transaction: Prisma.TransactionClient,
    productId: string,
    variantId: string | null | undefined,
  ): Promise<boolean> {
    if (!variantId) return true;
    return await transaction.productVariant.count({
      where: { id: variantId, productId, deletedAt: null },
    }) === 1;
  }

  async list(productId: string, query: ListProductMediaQuery): Promise<
    { status: "OK"; items: ProductMediaRecord[]; total: number } | { status: "PRODUCT_NOT_FOUND" }
  > {
    const product = await this.client.product.findFirst({
      where: { id: productId, deletedAt: null },
      select: { id: true },
    });
    if (!product) return { status: "PRODUCT_NOT_FOUND" };
    const [items, total] = await this.client.$transaction([
      this.client.productMedia.findMany({
        where: { productId },
        skip: (query.page - 1) * query.limit,
        take: query.limit,
        orderBy: [{ position: "asc" }, { createdAt: "asc" }, { id: "asc" }],
        select: productMediaSelect,
      }),
      this.client.productMedia.count({ where: { productId } }),
    ]);
    return { status: "OK", items, total };
  }

  create(productId: string, input: CreateProductMediaInput & { storageProvider?: string; storageKey?: string }): Promise<ProductMediaMutationResult> {
    return this.serializable<ProductMediaMutationResult>(async (transaction) => {
      if (!await this.lockActiveProduct(transaction, productId)) return { status: "PRODUCT_NOT_FOUND" };
      if (!await this.variantBelongsToProduct(transaction, productId, input.variantId)) {
        return { status: "VARIANT_NOT_FOUND" };
      }
      const resolvedType = input.mediaType ?? input.type ?? "IMAGE";
      if (resolvedType === "VIDEO" && input.isPrimary === true) {
        throw new ProductMediaRepositoryError("VIDEO_CANNOT_BE_PRIMARY");
      }
      if (resolvedType === "VIDEO") {
        const existingVideoCount = await transaction.productMedia.count({
          where: { productId, OR: [{ type: "VIDEO" }, { mediaType: "VIDEO" }] },
        });
        if (existingVideoCount > 0) {
          throw new ProductMediaRepositoryError("VIDEO_LIMIT_EXCEEDED");
        }
      }
      if (input.isPrimary === true) {
        await transaction.productMedia.updateMany({
          where: { productId, isPrimary: true },
          data: { isPrimary: false },
        });
      }
      const media = await transaction.productMedia.create({
        data: {
          productId,
          ...input,
          type: resolvedType,
          mediaType: resolvedType,
          isPrimary: resolvedType === "VIDEO" ? false : (input.isPrimary ?? false),
        },
        select: productMediaSelect,
      });
      return { status: "OK", media };
    }).catch((error: unknown) => {
      if (error instanceof ProductMediaRepositoryError) throw error;
      if (isUniqueConstraintError(error)) {
        const message = error instanceof Error ? error.message : "";
        if (message.includes("video_cannot_be_primary")) throw new ProductMediaRepositoryError("VIDEO_CANNOT_BE_PRIMARY");
        if (message.includes("one_video_per_product_key")) throw new ProductMediaRepositoryError("VIDEO_LIMIT_EXCEEDED");
        throw new ProductMediaRepositoryError("PRIMARY_CONFLICT");
      }
      throw error;
    });
  }

  update(
    productId: string,
    mediaId: string,
    input: UpdateProductMediaInput & { storageProvider?: string | null; storageKey?: string | null },
  ): Promise<ProductMediaMutationResult> {
    return this.serializable<ProductMediaMutationResult>(async (transaction) => {
      if (!await this.lockActiveProduct(transaction, productId)) return { status: "PRODUCT_NOT_FOUND" };
      const current = await transaction.productMedia.findFirst({
        where: { id: mediaId, productId },
        select: { id: true, type: true, mediaType: true, isPrimary: true },
      });
      if (!current) return { status: "MEDIA_NOT_FOUND" };
      if (!await this.variantBelongsToProduct(transaction, productId, input.variantId)) {
        return { status: "VARIANT_NOT_FOUND" };
      }
      const targetType = input.mediaType ?? input.type ?? current.mediaType ?? current.type;
      if (targetType === "VIDEO" && input.isPrimary === true) {
        throw new ProductMediaRepositoryError("VIDEO_CANNOT_BE_PRIMARY");
      }
      if (targetType === "VIDEO" && current.type !== "VIDEO" && current.mediaType !== "VIDEO") {
        const existingVideoCount = await transaction.productMedia.count({
          where: { productId, id: { not: mediaId }, OR: [{ type: "VIDEO" }, { mediaType: "VIDEO" }] },
        });
        if (existingVideoCount > 0) {
          throw new ProductMediaRepositoryError("VIDEO_LIMIT_EXCEEDED");
        }
      }
      if (input.isPrimary === true) {
        await transaction.productMedia.updateMany({
          where: { productId, isPrimary: true, id: { not: mediaId } },
          data: { isPrimary: false },
        });
      }
      const updateData: Prisma.ProductMediaUncheckedUpdateInput = {
        ...input,
        ...(input.mediaType ? { type: input.mediaType, mediaType: input.mediaType } : {}),
        ...(input.type ? { type: input.type, mediaType: input.type } : {}),
        ...(targetType === "VIDEO" ? { type: "VIDEO", mediaType: "VIDEO", isPrimary: false } : {}),
        ...(input.storageProvider !== undefined ? { storageProvider: input.storageProvider } : {}),
        ...(input.storageKey !== undefined ? { storageKey: input.storageKey } : {}),
      };
      const media = await transaction.productMedia.update({
        where: { id: mediaId },
        data: updateData,
        select: productMediaSelect,
      });
      return { status: "OK", media };
    }).catch((error: unknown) => {
      if (error instanceof ProductMediaRepositoryError) throw error;
      if (isUniqueConstraintError(error)) {
        const message = error instanceof Error ? error.message : "";
        if (message.includes("video_cannot_be_primary")) throw new ProductMediaRepositoryError("VIDEO_CANNOT_BE_PRIMARY");
        if (message.includes("one_video_per_product_key")) throw new ProductMediaRepositoryError("VIDEO_LIMIT_EXCEEDED");
        throw new ProductMediaRepositoryError("PRIMARY_CONFLICT");
      }
      throw error;
    });
  }

  delete(productId: string, mediaId: string): Promise<
    | { status: "OK"; media: ProductVideoRecord }
    | { status: "PRODUCT_NOT_FOUND" }
    | { status: "MEDIA_NOT_FOUND" }
  > {
    return this.serializable(async (transaction) => {
      if (!await this.lockActiveProduct(transaction, productId)) return { status: "PRODUCT_NOT_FOUND" };
      const media = await transaction.productMedia.findFirst({
        where: { id: mediaId, productId },
        select: productVideoRecordSelect,
      });
      if (!media) return { status: "MEDIA_NOT_FOUND" };
      await transaction.productMedia.delete({ where: { id: mediaId } });
      return { status: "OK", media };
    });
  }
}
