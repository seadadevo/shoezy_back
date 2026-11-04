import { toCartDto } from "../carts/carts.dto";
import type { CheckoutContext } from "./checkout.repository";
export function toCheckoutPreviewDto(context: Extract<CheckoutContext, { kind: "READY" }>, now: Date) {
  const cart = toCartDto(context.cart, context.calculation, now);
  return {
    address: { ...context.address, latitude: context.address.latitude?.toString() ?? null, longitude: context.address.longitude?.toString() ?? null },
    shippingMethod: { ...context.shippingMethod, basePriceMinor: context.shippingMethod.basePriceMinor.toString() },
    shippingZone: context.shipping.zone,
    currency: context.cart.currency,
    discountCode: context.cart.discountCode,
    items: cart.items,
    appliedDiscounts: context.calculation.discounts.map((discount) => ({ ...discount, value: discount.value.toString(), amountMinor: discount.amountMinor.toString() })),
    totals: {
      itemsSubtotalMinor: context.calculation.grossMerchandiseSubtotalMinor.toString(),
      merchandiseDiscountMinor: context.calculation.merchandiseDiscountMinor.toString(),
      shippingMinor: context.calculation.grossShippingMinor.toString(),
      shippingDiscountMinor: context.calculation.shippingDiscountMinor.toString(),
      totalDiscountMinor: context.calculation.totalDiscountMinor.toString(),
      grandTotalMinor: context.calculation.grandTotalMinor.toString(),
    },
    advisory: true,
    notice: "Preview does not reserve stock. Prices, discounts, shipping, and stock are recalculated transactionally during order placement.",
  };
}
