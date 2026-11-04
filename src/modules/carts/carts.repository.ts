import { Prisma, type PrismaClient } from "@prisma/client";
import { randomBytes } from "node:crypto";
import { prisma } from "../../config/database";
import { isSerializableTransactionConflict } from "../../common/utils/prisma-transaction";
import { POSTGRES_INT_MAX } from "../../common/validation/postgres-int";
import { CommercePricingService } from "../../services/commerce-pricing.service";
import { cartSelect, type CartMutationResult, type CartRecord } from "./carts.types";
import { guestCartExpiry, validGuestCartWhere } from "./guest-cart-expiry";

const sellableVariantWhere = (variantId: string, now: Date): Prisma.ProductVariantWhereInput => ({
  id: variantId,
  isActive: true,
  deletedAt: null,
  product: {
    status: "ACTIVE",
    deletedAt: null,
    publishedAt: { lte: now },
    brand: { isActive: true },
    productCategories: { some: { category: { isActive: true } } },
  },
});

export type CartOwner = string | { sessionToken: string };
const cartOwnerWhere = (owner: CartOwner): Prisma.CartWhereInput => typeof owner === "string" ? { userId: owner } : { sessionToken: owner.sessionToken, userId: null, ...validGuestCartWhere(new Date()) };

export class CartsRepository {
  constructor(private readonly client: PrismaClient = prisma, private readonly pricing = new CommercePricingService()) {}

  private async serializable<T>(operation: (transaction: Prisma.TransactionClient) => Promise<T>): Promise<T> {
    for (let attempt = 1; attempt <= 3; attempt += 1) {
      try { return await this.client.$transaction(operation, { isolationLevel: "Serializable" }); }
      catch (error: unknown) {
        if (!isSerializableTransactionConflict(error) || attempt === 3) throw error;
      }
    }
    throw new Error("Serializable retry exhausted");
  }

  private findActive(transaction: Prisma.TransactionClient, owner: CartOwner): Promise<CartRecord | null> {
    return transaction.cart.findFirst({ where: { ...cartOwnerWhere(owner), status: "ACTIVE" }, select: cartSelect });
  }

  private async activeOrCreate(transaction: Prisma.TransactionClient, owner: CartOwner): Promise<CartRecord | "CART_SESSION_INVALID"> {
    const current = await this.findActive(transaction, owner);
    if (current) return current;
    if (typeof owner !== "string") return "CART_SESSION_INVALID";
    return transaction.cart.create({ data: { userId: owner, status: "ACTIVE", currency: "TND" }, select: cartSelect });
  }
  private async touchGuest(owner: CartOwner, now = new Date()) {
    if (typeof owner !== "string") await this.client.cart.updateMany({ where: { ...cartOwnerWhere(owner), status: "ACTIVE" }, data: { expiresAt: guestCartExpiry(now) } });
  }

  async createGuestSession(now = new Date()) {
    const sessionToken = randomBytes(32).toString("base64url");
    await this.client.cart.create({ data: { sessionToken, status: "ACTIVE", currency: "TND", expiresAt: guestCartExpiry(now) } });
    return sessionToken;
  }
  async validGuestSession(sessionToken: string, now = new Date()) {
    return Boolean(await this.client.cart.findFirst({ where: { sessionToken, userId: null, status: "ACTIVE", ...validGuestCartWhere(now) }, select: { id: true } }));
  }

  addFirstGuestItem(variantId: string, quantity: number, now: Date) {
    return this.serializable(async (transaction) => {
      const variant = await transaction.productVariant.findFirst({ where: sellableVariantWhere(variantId, now), select: { id: true, stockQuantity: true, priceMinor: true } });
      if (!variant) return { kind: "VARIANT_UNAVAILABLE" as const };
      if (quantity > variant.stockQuantity) return { kind: "INSUFFICIENT_STOCK" as const };
      const sessionToken = randomBytes(32).toString("base64url");
      const cart = await transaction.cart.create({ data: { sessionToken, status: "ACTIVE", currency: "TND", expiresAt: guestCartExpiry(now) }, select: { id: true } });
      await transaction.cartItem.create({ data: { cartId: cart.id, variantId, quantity, unitPriceMinor: variant.priceMinor, discountMinor: 0n, addedAt: now } });
      return { kind: "CREATED" as const, sessionToken };
    });
  }

  async getPriced(owner: CartOwner, now: Date, discountCodeOverride?: string | null) {
    return this.client.$transaction(async (transaction) => {
      const cart = await this.findActive(transaction, owner);
      if (!cart) return { cart: null, calculation: null };
      const lines = cart.items.map((item) => ({
        variantId: item.variantId,
        productId: item.variant.productId,
        categoryIds: item.variant.product.productCategories.filter((link) => link.category.isActive).map((link) => link.category.id),
        collectionIds: (item.variant.product.collectionProducts ?? []).filter((link) => link.collection.isActive && (!link.collection.startsAt || link.collection.startsAt <= now) && (!link.collection.endsAt || link.collection.endsAt > now)).map((link) => link.collection.id),
        unitPriceMinor: item.variant.priceMinor,
        quantity: item.quantity,
      }));
      const calculation = await this.pricing.calculate(transaction, {
        lines,
        userId: typeof owner === "string" ? owner : null,
        currency: cart.currency,
        shippingMinor: 0n,
        couponCode: discountCodeOverride === undefined ? cart.discountCode : discountCodeOverride,
        now,
      });
      return { cart, calculation };
    }, { isolationLevel: "RepeatableRead" });
  }

  addItem(owner: CartOwner, variantId: string, quantity: number, now: Date): Promise<CartMutationResult> {
    return this.serializable(async (transaction) => {
      if (typeof owner === "string") await transaction.$queryRaw`SELECT "id" FROM "users" WHERE "id" = ${owner}::uuid FOR UPDATE`;
      else await transaction.$queryRaw`SELECT "id" FROM "carts" WHERE "session_token" = ${owner.sessionToken} AND "user_id" IS NULL AND "status" = 'ACTIVE' FOR UPDATE`;
      const variant = await transaction.productVariant.findFirst({ where: sellableVariantWhere(variantId, now), select: { id: true, stockQuantity: true, priceMinor: true } });
      if (!variant) return "VARIANT_UNAVAILABLE";
      const cart = await this.activeOrCreate(transaction, owner);
      if (cart === "CART_SESSION_INVALID") return cart;
      const existing = cart.items.find((item) => item.variantId === variantId);
      const finalQuantity = (existing?.quantity ?? 0) + quantity;
      if (finalQuantity > POSTGRES_INT_MAX) return "QUANTITY_OVERFLOW";
      if (finalQuantity > variant.stockQuantity) return "INSUFFICIENT_STOCK";
      if (existing) await transaction.cartItem.update({ where: { id: existing.id }, data: { quantity: finalQuantity, unitPriceMinor: variant.priceMinor, discountMinor: 0n } });
      else await transaction.cartItem.create({ data: { cartId: cart.id, variantId, quantity, unitPriceMinor: variant.priceMinor, discountMinor: 0n, addedAt: now } });
      if (typeof owner !== "string") await transaction.cart.update({ where: { id: cart.id }, data: { expiresAt: guestCartExpiry(now) } });
      return transaction.cart.findUniqueOrThrow({ where: { id: cart.id }, select: cartSelect });
    });
  }

  updateItem(owner: CartOwner, cartItemId: string, quantity: number, now: Date): Promise<CartMutationResult> {
    return this.serializable(async (transaction) => {
      if (typeof owner === "string") await transaction.$queryRaw`SELECT "id" FROM "users" WHERE "id" = ${owner}::uuid FOR UPDATE`;
      else await transaction.$queryRaw`SELECT "id" FROM "carts" WHERE "session_token" = ${owner.sessionToken} AND "user_id" IS NULL AND "status" = 'ACTIVE' FOR UPDATE`;
      const item = await transaction.cartItem.findFirst({ where: { id: cartItemId, cart: { ...cartOwnerWhere(owner), status: "ACTIVE" } }, select: { id: true, cartId: true, variantId: true } });
      if (!item) return "ITEM_NOT_FOUND";
      const variant = await transaction.productVariant.findFirst({ where: sellableVariantWhere(item.variantId, now), select: { stockQuantity: true, priceMinor: true } });
      if (!variant) return "VARIANT_UNAVAILABLE";
      if (quantity > variant.stockQuantity) return "INSUFFICIENT_STOCK";
      await transaction.cartItem.update({ where: { id: item.id }, data: { quantity, unitPriceMinor: variant.priceMinor, discountMinor: 0n } });
      if (typeof owner !== "string") await transaction.cart.update({ where: { id: item.cartId }, data: { expiresAt: guestCartExpiry(now) } });
      return transaction.cart.findUniqueOrThrow({ where: { id: item.cartId }, select: cartSelect });
    });
  }

  async deleteItem(owner: CartOwner, cartItemId: string): Promise<boolean> {
    const deleted = (await this.client.cartItem.deleteMany({ where: { id: cartItemId, cart: { ...cartOwnerWhere(owner), status: "ACTIVE" } } })).count === 1;
    if (deleted) await this.touchGuest(owner);
    return deleted;
  }

  async clear(owner: CartOwner): Promise<void> {
    await this.client.cartItem.deleteMany({ where: { cart: { ...cartOwnerWhere(owner), status: "ACTIVE" } } });
    await this.touchGuest(owner);
  }

  async setDiscountCode(owner: CartOwner, code: string | null): Promise<boolean> {
    return (await this.client.cart.updateMany({ where: { ...cartOwnerWhere(owner), status: "ACTIVE" }, data: { discountCode: code, ...(typeof owner === "string" ? {} : { expiresAt: guestCartExpiry(new Date()) }) } })).count === 1;
  }
}
