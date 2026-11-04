import { type Prisma, type PrismaClient } from "@prisma/client";
import { prisma } from "../../config/database";
import { CommercePricingService } from "../../services/commerce-pricing.service";
import { cartSelect } from "../carts/carts.types";
import { checkoutAddressSelect, checkoutShippingSelect } from "./checkout.types";
import type { CheckoutPreviewInput } from "./checkout.validation";
import { resolveShippingRate } from "../shipping/shipping-zone-pricing";
import { guestCheckoutAddress, type GuestCheckoutInput } from "./guest-checkout.validation";
import { validGuestCartWhere } from "../carts/guest-cart-expiry";

export type CheckoutContext = Awaited<ReturnType<CheckoutRepository["preview"]>>;

export class CheckoutRepository {
  constructor(private readonly client: PrismaClient = prisma, private readonly pricing = new CommercePricingService()) {}

  preview(userId: string, input: CheckoutPreviewInput, now: Date) { return this.previewFor(userId, null, input, now); }
  previewGuest(sessionToken: string, input: GuestCheckoutInput, now: Date) { return this.previewFor(null, sessionToken, input, now); }
  private previewFor(userId: string | null, sessionToken: string | null, input: CheckoutPreviewInput | GuestCheckoutInput, now: Date) {
    return this.client.$transaction(async (transaction: Prisma.TransactionClient) => {
      const [address, shippingMethod, cart] = await Promise.all([
        sessionToken ? Promise.resolve(guestCheckoutAddress(input as GuestCheckoutInput)) : transaction.address.findFirst({ where: { id: (input as CheckoutPreviewInput).addressId, userId: userId! }, select: checkoutAddressSelect }),
        transaction.shippingMethod.findFirst({ where: { id: input.shippingMethodId, isActive: true }, select: checkoutShippingSelect }),
        transaction.cart.findFirst({ where: { ...(sessionToken ? { sessionToken, userId: null, ...validGuestCartWhere(now) } : { userId }), status: "ACTIVE" }, select: cartSelect }),
      ]);
      if (!address) return { kind: "ADDRESS_NOT_FOUND" as const };
      if (!shippingMethod) return { kind: "SHIPPING_METHOD_NOT_FOUND" as const };
      if (!cart || cart.items.length === 0) return { kind: "CART_EMPTY" as const };
      if (cart.currency !== shippingMethod.currency) return { kind: "CURRENCY_MISMATCH" as const };
      const shipping = await resolveShippingRate(transaction, address, shippingMethod);
      if (shipping === "NOT_AVAILABLE") return { kind: "SHIPPING_RATE_NOT_AVAILABLE" as const };
      if (shipping === "CURRENCY_MISMATCH" || shipping.currency !== cart.currency) return { kind: "CURRENCY_MISMATCH" as const };
      const unavailableVariantIds: string[] = [];
      const insufficientStockVariantIds: string[] = [];
      const lines = cart.items.map((item) => {
        const product = item.variant.product;
        const sellable = item.variant.isActive && item.variant.deletedAt === null && product.status === "ACTIVE" && product.deletedAt === null && product.publishedAt !== null && product.publishedAt <= now && product.brand.isActive && product.productCategories.some((link) => link.category.isActive);
        if (!sellable) unavailableVariantIds.push(item.variantId);
        if (item.quantity > item.variant.stockQuantity) insufficientStockVariantIds.push(item.variantId);
        return {
          variantId: item.variantId,
          productId: item.variant.productId,
          categoryIds: product.productCategories.filter((link) => link.category.isActive).map((link) => link.category.id),
          collectionIds: (product.collectionProducts ?? []).filter((link) => link.collection.isActive && (!link.collection.startsAt || link.collection.startsAt <= now) && (!link.collection.endsAt || link.collection.endsAt > now)).map((link) => link.collection.id),
          unitPriceMinor: item.variant.priceMinor,
          quantity: item.quantity,
        };
      });
      if (unavailableVariantIds.length) return { kind: "ITEM_UNAVAILABLE" as const, variantIds: unavailableVariantIds };
      if (insufficientStockVariantIds.length) return { kind: "INSUFFICIENT_STOCK" as const, variantIds: insufficientStockVariantIds };
      const calculation = await this.pricing.calculate(transaction, { lines, userId, currency: cart.currency, shippingMinor: shipping.priceMinor, couponCode: cart.discountCode, now });
      if (cart.discountCode && !calculation.eligibleCoupon) return { kind: "DISCOUNT_NOT_ELIGIBLE" as const };
      return { kind: "READY" as const, cart, address, shippingMethod, shipping, calculation };
    }, { isolationLevel: "RepeatableRead" });
  }
}
