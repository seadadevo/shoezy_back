import type { DiscountCalculation } from "../../services/discount-engine.service";
import type { CartRecord } from "./carts.types";

const money = (value: bigint): string => value.toString();

export function emptyCartDto() {
  return {
    id: null,
    status: "ACTIVE" as const,
    currency: "TND",
    discountCode: null,
    items: [],
    checkoutEligible: false,
    issues: ["CART_EMPTY"],
    totals: { subtotalMinor: "0", merchandiseDiscountMinor: "0", estimatedTotalMinor: "0" },
  };
}

export function toCartDto(cart: CartRecord, calculation: DiscountCalculation, now: Date) {
  const issues = new Set<string>();
  const items = cart.items.map((item, index) => {
    const product = item.variant.product;
    const productAvailable = product.status === "ACTIVE" && product.deletedAt === null && product.publishedAt !== null && product.publishedAt <= now && product.brand.isActive && product.productCategories.some((link) => link.category.isActive);
    const variantAvailable = item.variant.isActive && item.variant.deletedAt === null;
    if (!productAvailable) issues.add("PRODUCT_UNAVAILABLE");
    if (!variantAvailable) issues.add("VARIANT_UNAVAILABLE");
    if (item.quantity > item.variant.stockQuantity) issues.add("INSUFFICIENT_STOCK");
    const pricedLine = calculation.lines[index]!;
    const originalUnitPrice = item.variant.compareAtPriceMinor !== null && item.variant.compareAtPriceMinor > item.variant.priceMinor ? item.variant.compareAtPriceMinor : item.variant.priceMinor;
    return {
      id: item.id,
      quantity: item.quantity,
      available: productAvailable && variantAvailable && item.quantity <= item.variant.stockQuantity,
      product: { id: product.id, name: product.name, slug: product.slug, brand: { id: product.brand.id, name: product.brand.name, slug: product.brand.slug } },
      variant: {
        id: item.variant.id,
        sku: item.variant.sku,
        title: item.variant.title,
        stockQuantity: item.variant.stockQuantity,
        options: item.variant.optionValues.map((link) => ({
          option: link.optionValue.option,
          value: { id: link.optionValue.id, value: link.optionValue.value, displayValue: link.optionValue.displayValue, colorHex: link.optionValue.colorHex },
        })),
      },
      media: item.variant.media[0] ?? product.media[0] ?? null,
      unitOriginalPriceMinor: money(originalUnitPrice),
      unitPriceMinor: money(item.variant.priceMinor),
      lineOriginalTotalMinor: money(originalUnitPrice * BigInt(item.quantity)),
      discountMinor: money(pricedLine.discountMinor),
      lineTotalMinor: money(pricedLine.finalMinor),
    };
  });
  if (items.length === 0) issues.add("CART_EMPTY");
  return {
    id: cart.id,
    status: cart.status,
    currency: cart.currency,
    discountCode: cart.discountCode,
    items,
    appliedDiscounts: calculation.discounts.map((discount) => ({ ...discount, value: money(discount.value), amountMinor: money(discount.amountMinor) })),
    checkoutEligible: issues.size === 0,
    issues: [...issues],
    totals: {
      subtotalMinor: money(calculation.grossMerchandiseSubtotalMinor),
      merchandiseDiscountMinor: money(calculation.merchandiseDiscountMinor),
      estimatedTotalMinor: money(calculation.grandTotalMinor),
    },
    priceNotice: "Cart prices are current estimates and are recalculated during order placement.",
    stockNotice: "Cart quantities do not reserve stock.",
    updatedAt: cart.updatedAt,
  };
}
