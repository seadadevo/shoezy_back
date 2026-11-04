import { createHash, createHmac, randomUUID } from "node:crypto";
import { Prisma, type OrderStatus, type PrismaClient } from "@prisma/client";
import { prisma } from "../../config/database";
import { isSerializableTransactionConflict } from "../../common/utils/prisma-transaction";
import { POSTGRES_INT_MAX } from "../../common/validation/postgres-int";
import { CommercePricingService } from "../../services/commerce-pricing.service";
import { DiscountsRepository } from "../discounts/discounts.repository";
import { cartSelect } from "../carts/carts.types";
import { checkoutAddressSelect, checkoutShippingSelect } from "../checkout/checkout.types";
import { isUniqueConstraintError, uniqueConstraintFields } from "../auth/auth.errors";
import { orderDetailSelect, orderListSelect, type PlaceOrderResult, type TransitionResult } from "./orders.types";
import type { CreateOrderInput, ListAdminOrdersQuery, ListOwnOrdersQuery } from "./orders.validation";
import { resolveShippingRate } from "../shipping/shipping-zone-pricing";
import { recordStockMovement } from "../inventory/inventory.repository";
import { guestCheckoutAddress, type GuestCreateOrderInput } from "../checkout/guest-checkout.validation";
import { env } from "../../config/env";
import { AuditLogService } from "../admin-audit/audit-log.service";
import { validGuestCartWhere } from "../carts/guest-cart-expiry";
import { PERMISSIONS } from "../../common/auth/rbac.constants";
import { enqueueNotification } from "../notifications/notifications.outbox";
import { selectPurchasedImageUrl, type OrderImageMedia } from "./order-images";

class PlacementAbort extends Error {
  constructor(public readonly kind: "INSUFFICIENT_STOCK" | "RESTORE_OVERFLOW") { super(kind); }
}

const orderNumber = () => `SHZ-${randomUUID().replaceAll("-", "").slice(0, 24).toUpperCase()}`;
const hash = (value: string) => createHash("sha256").update(value).digest("hex");
const guestOrderToken = (sessionToken: string, idempotencyKey: string) => createHmac("sha256", env.JWT_REFRESH_SECRET).update(`guest-order:${sessionToken}:${idempotencyKey}`).digest("base64url");
type PlaceIdentity = { userId: string; sessionToken?: never } | { userId?: never; sessionToken: string };

export class OrdersRepository {
  constructor(
    private readonly client: PrismaClient = prisma,
    private readonly pricing = new CommercePricingService(),
    private readonly discounts = new DiscountsRepository(client),
  ) {}

  private async serializable<T>(operation: (transaction: Prisma.TransactionClient) => Promise<T>): Promise<T> {
    for (let attempt = 1; attempt <= 3; attempt += 1) {
      try {
        return await this.client.$transaction(operation, {
          isolationLevel: "Serializable",
          maxWait: 15000,
          timeout: 45000,
        });
      }
      catch (error: unknown) {
        if (!isSerializableTransactionConflict(error) || attempt === 3) throw error;
      }
    }
    throw new Error("Serializable retry exhausted");
  }

  private async findIdempotentOrderAfterConflict(idempotencyKey: string) {
    for (let attempt = 1; attempt <= 8; attempt += 1) {
      const existing = await this.client.order.findUnique({ where: { idempotencyKey }, select: orderDetailSelect });
      if (existing || attempt === 8) return existing;
      await new Promise((resolve) => setTimeout(resolve, 25));
    }
    return null;
  }

  place(userId: string, idempotencyKey: string, input: CreateOrderInput, now: Date): Promise<PlaceOrderResult> {
    return this.placeFor({ userId }, idempotencyKey, input, now);
  }
  placeGuest(sessionToken: string, idempotencyKey: string, input: GuestCreateOrderInput, now: Date): Promise<PlaceOrderResult> {
    return this.placeFor({ sessionToken }, idempotencyKey, input, now);
  }
  private async placeFor(identity: PlaceIdentity, idempotencyKey: string, input: CreateOrderInput | GuestCreateOrderInput, now: Date): Promise<PlaceOrderResult> {
    const userId = identity.userId ?? null;
    const guestSessionTokenHash = identity.sessionToken ? hash(identity.sessionToken) : null;
    const accessToken = identity.sessionToken ? guestOrderToken(identity.sessionToken, idempotencyKey) : null;
    const sameIdentity = (order: { userId: string | null; guestSessionTokenHash: string | null }) => userId ? order.userId === userId : order.userId === null && order.guestSessionTokenHash === guestSessionTokenHash;
    try {
      return await this.serializable(async (transaction) => {
        if (userId) await transaction.$queryRaw`SELECT "id" FROM "users" WHERE "id" = ${userId}::uuid FOR UPDATE`;
        else await transaction.$queryRaw`SELECT "id" FROM "carts" WHERE "session_token" = ${identity.sessionToken!} AND "user_id" IS NULL FOR UPDATE`;
        const existing = await transaction.order.findUnique({ where: { idempotencyKey }, select: orderDetailSelect });
        if (existing) return sameIdentity(existing) ? { kind: "REPLAYED" as const, order: existing, guestAccessToken: accessToken } : { kind: "IDEMPOTENCY_CONFLICT" as const };
        const user = userId ? await transaction.user.findFirst({ where: { id: userId, status: "ACTIVE", deletedAt: null }, select: { id: true, email: true, firstName: true, lastName: true } }) : null;
        if (userId && !user) return { kind: "USER_NOT_FOUND" as const };
        // Sequential queries to avoid single-connection concurrency issues in interactive transaction
        const address = userId ? await transaction.address.findFirst({ where: { id: (input as CreateOrderInput).addressId, userId }, select: checkoutAddressSelect }) : guestCheckoutAddress(input as GuestCreateOrderInput);
        const shippingMethod = await transaction.shippingMethod.findFirst({ where: { id: input.shippingMethodId, isActive: true }, select: checkoutShippingSelect });
        const activeCart = await transaction.cart.findFirst({ where: { ...(userId ? { userId } : { sessionToken: identity.sessionToken, userId: null, ...validGuestCartWhere(now) }), status: "ACTIVE" }, select: { id: true } });





        if (!address) return { kind: "ADDRESS_NOT_FOUND" as const };
        if (!shippingMethod) return { kind: "SHIPPING_METHOD_NOT_FOUND" as const };
        if (!activeCart) return { kind: "CART_EMPTY" as const };
        await transaction.$queryRaw`SELECT "id" FROM "carts" WHERE "id" = ${activeCart.id}::uuid FOR UPDATE`;
        const cart = await transaction.cart.findUnique({ where: { id: activeCart.id }, select: cartSelect });
        if (!cart || cart.status !== "ACTIVE" || cart.items.length === 0) return { kind: "CART_EMPTY" as const };
        if (cart.currency !== shippingMethod.currency) return { kind: "CURRENCY_MISMATCH" as const };
        const shipping = await resolveShippingRate(transaction, address, shippingMethod);
        if (shipping === "NOT_AVAILABLE") return { kind: "SHIPPING_RATE_NOT_AVAILABLE" as const };
        if (shipping === "CURRENCY_MISMATCH" || shipping.currency !== cart.currency) return { kind: "CURRENCY_MISMATCH" as const };
        const settings = await transaction.storeSettings.findUnique({ where: { id: 1 }, select: { storeName: true, whatsappNumber: true, whatsappConfirmationEnabled: true } });
        const lines = cart.items.map((item) => ({
          variantId: item.variantId,
          productId: item.variant.productId,
          categoryIds: item.variant.product.productCategories.filter((link) => link.category.isActive).map((link) => link.category.id),
          collectionIds: (item.variant.product.collectionProducts ?? []).filter((link) => link.collection.isActive && (!link.collection.startsAt || link.collection.startsAt <= now) && (!link.collection.endsAt || link.collection.endsAt > now)).map((link) => link.collection.id),
          unitPriceMinor: item.variant.priceMinor,
          quantity: item.quantity,
        }));
        if (cart.items.some((item) => {
          const product = item.variant.product;
          return !item.variant.isActive || item.variant.deletedAt !== null || product.status !== "ACTIVE" || product.deletedAt !== null || product.publishedAt === null || product.publishedAt > now || !product.brand.isActive || !product.productCategories.some((link) => link.category.isActive);
        })) return { kind: "ITEM_UNAVAILABLE" as const };
        if (cart.items.some((item) => item.quantity > item.variant.stockQuantity)) return { kind: "INSUFFICIENT_STOCK" as const };
        const calculation = await this.pricing.calculate(transaction, { lines, userId, currency: cart.currency, shippingMinor: shipping.priceMinor, couponCode: cart.discountCode, now });
        if (cart.discountCode && !calculation.eligibleCoupon) return { kind: "DISCOUNT_NOT_ELIGIBLE" as const };
        const appliedDiscountIds = calculation.discounts.map((discount) => discount.discountId);
        if (await this.discounts.lockAndValidateUsage(transaction, appliedDiscountIds, userId) !== "OK") return { kind: "DISCOUNT_LIMIT_CHANGED" as const };

        const productIds = [...new Set(cart.items.map((item) => item.variant.productId))];
        const variantIds = cart.items.map((item) => item.variantId);
        const orderMedia: OrderImageMedia[] = await transaction.productMedia.findMany({
          where: {
            productId: { in: productIds },
            OR: [{ variantId: { in: variantIds } }, { variantId: null }],
            type: "IMAGE",
            mediaType: "IMAGE",
          },
          orderBy: [{ isPrimary: "desc" }, { position: "asc" }, { id: "asc" }],
          select: { productId: true, variantId: true, type: true, mediaType: true, url: true, isPrimary: true },
        });

        const stockChanges: { variantId: string; beforeQuantity: number; afterQuantity: number }[] = [];
        for (const item of [...cart.items].sort((left, right) => left.variantId.localeCompare(right.variantId))) {
          const updated = await transaction.productVariant.updateMany({
            where: { id: item.variantId, stockQuantity: { gte: item.quantity }, isActive: true, deletedAt: null, product: { status: "ACTIVE", deletedAt: null, publishedAt: { lte: now }, brand: { isActive: true }, productCategories: { some: { category: { isActive: true } } } } },
            data: { stockQuantity: { decrement: item.quantity } },
          });
          if (updated.count !== 1) throw new PlacementAbort("INSUFFICIENT_STOCK");
          const afterQuantity = (await transaction.productVariant.findUniqueOrThrow({ where: { id: item.variantId }, select: { stockQuantity: true } })).stockQuantity;
          stockChanges.push({ variantId: item.variantId, beforeQuantity: afterQuantity + item.quantity, afterQuantity });
        }

        const created = await transaction.order.create({
          data: {
            orderNumber: orderNumber(), idempotencyKey, userId, cartId: cart.id, status: "PENDING", paymentMethod: "COD", paymentStatus: "PENDING",
            currency: cart.currency, customerEmail: user?.email ?? (input as GuestCreateOrderInput).email ?? null, customerPhone: address.phone,
            customerFirstName: user?.firstName ?? (input as GuestCreateOrderInput).firstName,
            customerLastName: user?.lastName ?? (input as GuestCreateOrderInput).lastName,
            guestSessionTokenHash, guestAccessTokenHash: accessToken ? hash(accessToken) : null,
            subtotalMinor: calculation.grossMerchandiseSubtotalMinor, discountMinor: calculation.totalDiscountMinor,
            shippingMinor: calculation.grossShippingMinor, totalMinor: calculation.grandTotalMinor,
            shippingMethodCode: shippingMethod.code, shippingMethodName: shippingMethod.name,
            shippingZoneCode: shipping.zone?.code, shippingZoneName: shipping.zone?.name,
            whatsappConfirmationNumber: settings?.whatsappConfirmationEnabled ? settings.whatsappNumber : null,
            whatsappStoreName: settings?.whatsappConfirmationEnabled ? settings.storeName : null,
            paidMinor: 0n, refundedMinor: 0n, notes: input.notes, placedAt: now,
            address: { create: { recipientName: address.recipientName, phone: address.phone, countryCode: address.countryCode, state: address.state, city: address.city, area: address.area, line1: address.line1, line2: address.line2, postalCode: address.postalCode, latitude: address.latitude, longitude: address.longitude } },
            items: { create: cart.items.map((item, index) => {
              const priced = calculation.lines[index]!;
              return {
                productId: item.variant.productId, variantId: item.variantId, productName: item.variant.product.name,
                variantName: item.variant.title, sku: item.variant.sku, quantity: item.quantity,
                unitPriceMinor: item.variant.priceMinor, discountMinor: priced.discountMinor, lineTotalMinor: priced.finalMinor,
                unitCostMinor: item.variant.costMinor ?? 0n,
                snapshotJson: {
                  brand: { id: item.variant.product.brand.id, name: item.variant.product.brand.name },
                  imageUrl: selectPurchasedImageUrl(orderMedia, item.variant.productId, item.variantId),
                  options: item.variant.optionValues.map((link) => ({ option: link.optionValue.option.name, value: link.optionValue.displayValue ?? link.optionValue.value })),
                  pricing: {
                    originalUnitPriceMinor: item.variant.priceMinor.toString(),
                    originalLineTotalMinor: (priced.grossMinor ?? item.variant.priceMinor * BigInt(item.quantity)).toString(),
                    finalLineTotalMinor: priced.finalMinor.toString(),
                    discountMinor: priced.discountMinor.toString(),
                    promotions: (priced.discountContributions ?? []).map((contribution) => {
                      const promotion = calculation.discounts.find((discount) => discount.discountId === contribution.discountId)!;
                      return {
                        discountId: contribution.discountId,
                        name: promotion.name,
                        code: promotion.code,
                        type: promotion.type,
                        value: promotion.value.toString(),
                        amountMinor: contribution.amountMinor.toString(),
                      };
                    }),
                  },
                },
              };
            }) },
            statusHistory: { create: { fromStatus: null, toStatus: "PENDING", changedByUserId: userId, createdAt: now } },
          },
          select: { id: true },
        });
        for (const change of stockChanges) await recordStockMovement(transaction, { ...change, type: "ORDER_PLACED", referenceType: "ORDER", referenceId: created.id, actorUserId: userId ?? undefined, createdAt: now });
        await this.discounts.createRedemptions(transaction, created.id, userId, calculation.discounts.map((discount) => ({ discountId: discount.discountId, amountMinor: discount.amountMinor })));
        const notificationOrder = await transaction.order.findUniqueOrThrow({ where: { id: created.id }, select: { orderNumber: true } });
        await enqueueNotification(transaction, {
          audience: "ADMIN",
          recipientPermission: PERMISSIONS.ORDERS_READ_ANY,
          type: "ORDER_CREATED",
          entityType: "ORDER",
          entityId: created.id,
          templateParams: { orderNumber: notificationOrder.orderNumber },
          metadata: { orderId: created.id },
          deduplicationKey: `order:${created.id}:created:admin`,
          createdAt: now,
        });
        await transaction.cart.update({ where: { id: cart.id }, data: { status: "ORDERED" } });
        return { kind: "CREATED" as const, order: await transaction.order.findUniqueOrThrow({ where: { id: created.id }, select: orderDetailSelect }), guestAccessToken: accessToken };
      });
    } catch (error: unknown) {
      if (error instanceof PlacementAbort && error.kind === "INSUFFICIENT_STOCK") return { kind: "INSUFFICIENT_STOCK" };
      if (isSerializableTransactionConflict(error)) {
        // A competing request can commit immediately after our final Serializable
        // retry aborts. The unique key is the durable arbiter; briefly re-read it
        // so the losing request returns the committed Order instead of asking the
        // client to create a new operation.
        const existing = await this.findIdempotentOrderAfterConflict(idempotencyKey);
        if (existing) return sameIdentity(existing) ? { kind: "REPLAYED", order: existing, guestAccessToken: accessToken } : { kind: "IDEMPOTENCY_CONFLICT" };
        const cart = await this.client.cart.findFirst({ where: { ...(userId ? { userId } : { sessionToken: identity.sessionToken, userId: null }), status: "ACTIVE" }, select: { items: { select: { quantity: true, variant: { select: { stockQuantity: true } } } } } });
        return cart?.items.some((item) => item.quantity > item.variant.stockQuantity) ? { kind: "INSUFFICIENT_STOCK" } : { kind: "WRITE_CONFLICT" };
      }
      if (isUniqueConstraintError(error) && uniqueConstraintFields(error).some((field) => field.includes("idempotency"))) {
        const existing = await this.client.order.findUnique({ where: { idempotencyKey }, select: orderDetailSelect });
        return existing && sameIdentity(existing) ? { kind: "REPLAYED", order: existing, guestAccessToken: accessToken } : { kind: "IDEMPOTENCY_CONFLICT" };
      }
      throw error;
    }
  }

  async listOwn(userId: string, query: ListOwnOrdersQuery) {
    const where = { userId };
    const [items, total] = await Promise.all([
      this.client.order.findMany({
        where,
        skip: (query.page - 1) * query.limit,
        take: query.limit,
        orderBy: [{ [query.sortBy]: query.sortOrder }, { id: "desc" }],
        select: orderListSelect,
      }),
      this.client.order.count({ where }),
    ]);
    return { items, total };
  }

  findOwn(userId: string, orderId: string) {
    return this.client.order.findFirst({ where: { id: orderId, userId }, select: orderDetailSelect });
  }

  findGuest(orderNumber: string, token: string) {
    return this.client.order.findFirst({ where: { orderNumber, userId: null, guestAccessTokenHash: hash(token) }, select: orderDetailSelect });
  }

  async listAny(query: ListAdminOrdersQuery) {
    const where: Prisma.OrderWhereInput = {
      status: query.status,
      paymentStatus: query.paymentStatus,
      trackingNumber: query.hasTracking === undefined ? undefined : query.hasTracking ? { not: null } : null,
      ...(query.search ? { OR: [
        { orderNumber: { contains: query.search, mode: "insensitive" } },
        { customerEmail: { contains: query.search, mode: "insensitive" } },
        { customerPhone: { contains: query.search, mode: "insensitive" } },
      ] } : {}),
    };
    const [items, total] = await Promise.all([
      this.client.order.findMany({
        where,
        skip: (query.page - 1) * query.limit,
        take: query.limit,
        orderBy: [{ [query.sortBy]: query.sortOrder }, { id: "desc" }],
        select: orderListSelect,
      }),
      this.client.order.count({ where }),
    ]);
    return { items, total };
  }

  findAny(orderId: string) {
    return this.client.order.findUnique({ where: { id: orderId }, select: orderDetailSelect });
  }

  async transition(orderId: string, actorId: string, target: OrderStatus, allowedFrom: OrderStatus[], reason: string | null, ownerId?: string, now = new Date(), shipping?: { shippingProvider?: string; trackingNumber?: string | null }): Promise<TransitionResult> {
    try {
      return await this.serializable(async (transaction) => {
        await transaction.$queryRaw`SELECT "id" FROM "orders" WHERE "id" = ${orderId}::uuid FOR UPDATE`;
        const current = await transaction.order.findFirst({
          where: { id: orderId, ...(ownerId ? { userId: ownerId } : {}) },
          select: { id: true, userId: true, orderNumber: true, status: true, totalMinor: true, shippingProvider: true, items: { select: { variantId: true, quantity: true } } },
        });
        if (!current) return { kind: "NOT_FOUND" as const };
        if (current.status === target) return { kind: "REPLAYED" as const, order: await transaction.order.findUniqueOrThrow({ where: { id: orderId }, select: orderDetailSelect }) };
        if (!allowedFrom.includes(current.status)) return { kind: "INVALID_TRANSITION" as const };
        if (target === "SHIPPED" && !(shipping?.shippingProvider ?? current.shippingProvider)?.trim()) return { kind: "SHIPPING_DETAILS_REQUIRED" as const };
        if (target === "CANCELLED") {
          for (const item of [...current.items].sort((left, right) => left.variantId.localeCompare(right.variantId))) {
            const restored = await transaction.productVariant.updateMany({ where: { id: item.variantId, stockQuantity: { lte: POSTGRES_INT_MAX - item.quantity } }, data: { stockQuantity: { increment: item.quantity } } });
            if (restored.count !== 1) throw new PlacementAbort("RESTORE_OVERFLOW");
            const afterQuantity = (await transaction.productVariant.findUniqueOrThrow({ where: { id: item.variantId }, select: { stockQuantity: true } })).stockQuantity;
            await recordStockMovement(transaction, { variantId: item.variantId, type: "ORDER_CANCELLED", beforeQuantity: afterQuantity - item.quantity, afterQuantity, referenceType: "ORDER", referenceId: orderId, actorUserId: actorId, createdAt: now });
          }
        }
        const data: Prisma.OrderUpdateInput = { status: target, version: { increment: 1 } };
        if (target === "SHIPPED") {
          if (shipping?.shippingProvider !== undefined) data.shippingProvider = shipping.shippingProvider;
          if (shipping?.trackingNumber !== undefined) data.trackingNumber = shipping.trackingNumber;
        }
        if (target === "CONFIRMED") data.confirmedAt = now;
        if (target === "CANCELLED") { data.cancelledAt = now; data.paymentStatus = "CANCELLED"; }
        if (target === "DELIVERED") { data.paymentStatus = "PAID"; data.paidMinor = current.totalMinor; data.paidAt = now; }
        await transaction.order.update({ where: { id: orderId }, data });
        await transaction.orderStatusHistory.create({ data: { orderId, fromStatus: current.status, toStatus: target, reason, changedByUserId: actorId, createdAt: now } });
        if (!ownerId) await new AuditLogService().record({ actorUserId: actorId, action: `ORDER_${target}`, entityType: "ORDER", entityId: orderId, metadata: { status: { from: current.status, to: target } } }, transaction);
        if (target === "CANCELLED") {
          await transaction.discountRedemption.updateMany({ where: { orderId, releasedAt: null }, data: { releasedAt: now } });
          await enqueueNotification(transaction, {
            audience: "ADMIN", recipientPermission: PERMISSIONS.ORDERS_READ_ANY, type: "ORDER_CANCELLED", entityType: "ORDER", entityId: orderId,
            templateKey: "ORDER_CANCELLED_ADMIN", templateParams: { orderNumber: current.orderNumber }, metadata: { orderId }, deduplicationKey: `order:${orderId}:cancelled:admin`, createdAt: now,
          });
        }
        if (current.userId && ["CONFIRMED", "SHIPPED", "DELIVERED", "CANCELLED"].includes(target)) {
          await enqueueNotification(transaction, {
            audience: "USER", recipientUserId: current.userId, type: `ORDER_${target}` as "ORDER_CONFIRMED" | "ORDER_SHIPPED" | "ORDER_DELIVERED" | "ORDER_CANCELLED", entityType: "ORDER", entityId: orderId,
            templateParams: { orderNumber: current.orderNumber }, metadata: { orderId }, deduplicationKey: `order:${orderId}:${target.toLowerCase()}:customer`, createdAt: now,
          });
        }
        return { kind: "UPDATED" as const, order: await transaction.order.findUniqueOrThrow({ where: { id: orderId }, select: orderDetailSelect }) };
      });
    } catch (error: unknown) {
      if (error instanceof PlacementAbort && error.kind === "RESTORE_OVERFLOW") return { kind: "RESTORE_OVERFLOW" };
      throw error;
    }
  }
}
