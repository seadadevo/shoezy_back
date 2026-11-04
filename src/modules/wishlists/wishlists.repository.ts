import type { Prisma, PrismaClient } from "@prisma/client";
import { prisma } from "../../config/database";
import { isSerializableTransactionConflict } from "../../common/utils/prisma-transaction";
import { isUniqueConstraintError } from "../auth/auth.errors";
import { wishlistSelect, type WishlistRecord } from "./wishlists.types";
import type { AddWishlistItemInput, ListWishlistQuery } from "./wishlists.validation";
export class WishlistsRepository {
  constructor(private readonly client: PrismaClient = prisma) {}
  private async serializable<T>(operation: (transaction: Prisma.TransactionClient) => Promise<T>): Promise<T> { for (let attempt = 1; attempt <= 3; attempt += 1) { try { return await this.client.$transaction(operation, { isolationLevel: "Serializable" }); } catch (error: unknown) { if (!isSerializableTransactionConflict(error) || attempt === 3) throw error; } } throw new Error("Serializable retry exhausted"); }
  async list(userId: string, query: ListWishlistQuery) { const where = { userId }; const [items, total] = await this.client.$transaction([this.client.wishlist.findMany({ where, skip: (query.page - 1) * query.limit, take: query.limit, orderBy: [{ addedAt: "desc" }, { id: "asc" }], select: wishlistSelect }), this.client.wishlist.count({ where })]); return { items, total }; }
  add(userId: string, input: AddWishlistItemInput, now: Date): Promise<WishlistRecord | "PRODUCT_NOT_FOUND" | "VARIANT_NOT_FOUND"> { return this.serializable(async (transaction) => {
    await transaction.$queryRaw`SELECT "id" FROM "users" WHERE "id" = ${userId}::uuid FOR UPDATE`;
    const product = await transaction.product.findFirst({ where: { id: input.productId, status: "ACTIVE", deletedAt: null, publishedAt: { lte: now }, brand: { isActive: true }, productCategories: { some: { category: { isActive: true } } }, variants: { some: { isActive: true, deletedAt: null } } }, select: { id: true } });
    if (!product) return "PRODUCT_NOT_FOUND";
    if (input.variantId && await transaction.productVariant.count({ where: { id: input.variantId, productId: input.productId, isActive: true, deletedAt: null } }) !== 1) return "VARIANT_NOT_FOUND";
    const existing = await transaction.wishlist.findFirst({ where: { userId, productId: input.productId, variantId: input.variantId ?? null }, select: wishlistSelect }); if (existing) return existing;
    try { return await transaction.wishlist.create({ data: { userId, productId: input.productId, variantId: input.variantId, addedAt: now }, select: wishlistSelect }); }
    catch (error: unknown) { if (!isUniqueConstraintError(error)) throw error; return transaction.wishlist.findFirstOrThrow({ where: { userId, productId: input.productId, variantId: input.variantId ?? null }, select: wishlistSelect }); }
  }); }
  async delete(userId: string, wishlistItemId: string): Promise<boolean> { return (await this.client.wishlist.deleteMany({ where: { id: wishlistItemId, userId } })).count === 1; }
}
