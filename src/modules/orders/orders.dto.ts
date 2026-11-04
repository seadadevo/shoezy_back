import type { OrderDetailRecord, OrderListRecord } from "./orders.types";
import { selectPurchasedImageUrl, snapshotImageUrl } from "./order-images";
const money = (value: bigint) => value.toString();
const totals = (order: Pick<OrderListRecord, "currency" | "subtotalMinor" | "discountMinor" | "shippingMinor" | "totalMinor" | "paidMinor" | "refundedMinor">) => ({
  currency: order.currency,
  subtotalMinor: money(order.subtotalMinor),
  discountMinor: money(order.discountMinor),
  shippingMinor: money(order.shippingMinor),
  totalMinor: money(order.totalMinor),
  paidMinor: money(order.paidMinor),
  refundedMinor: money(order.refundedMinor),
});
export const toOrderListDto = (order: OrderListRecord) => ({
  id: order.id, orderNumber: order.orderNumber, status: order.status, paymentMethod: order.paymentMethod,
  paymentStatus: order.paymentStatus, itemCount: order._count.items, totals: totals(order), placedAt: order.placedAt,
  confirmedAt: order.confirmedAt, cancelledAt: order.cancelledAt, createdAt: order.createdAt, updatedAt: order.updatedAt,
});
export const toOrderDetailDto = (order: OrderDetailRecord) => ({
  id: order.id, orderNumber: order.orderNumber, status: order.status, paymentMethod: order.paymentMethod,
  paymentStatus: order.paymentStatus, customerEmail: order.customerEmail, customerPhone: order.customerPhone, customerFirstName: order.customerFirstName, customerLastName: order.customerLastName,
  totals: totals(order), paidAt: order.paidAt, notes: order.notes, trackingNumber: order.trackingNumber,
  shippingProvider: order.shippingProvider, placedAt: order.placedAt, confirmedAt: order.confirmedAt,
  shippingMethod: order.shippingMethodCode ? { code: order.shippingMethodCode, name: order.shippingMethodName } : null,
  shippingZone: order.shippingZoneCode ? { code: order.shippingZoneCode, name: order.shippingZoneName } : null,
  cancelledAt: order.cancelledAt, createdAt: order.createdAt, updatedAt: order.updatedAt,
  address: order.address ? { ...order.address, latitude: order.address.latitude?.toString() ?? null, longitude: order.address.longitude?.toString() ?? null } : null,
  items: order.items.map((item) => ({
    id: item.id,
    productId: item.productId,
    variantId: item.variantId,
    productName: item.productName,
    variantName: item.variantName,
    sku: item.sku,
    quantity: item.quantity,
    unitPriceMinor: money(item.unitPriceMinor),
    discountMinor: money(item.discountMinor),
    lineTotalMinor: money(item.lineTotalMinor),
    snapshotJson: item.snapshotJson,
    imageUrl: snapshotImageUrl(item.snapshotJson)
      ?? selectPurchasedImageUrl([...item.variant.media, ...item.product.media], item.productId, item.variantId),
  })),
  discounts: order.discountRedemptions.map((redemption) => ({ discountId: redemption.discountId, name: redemption.discount.name, code: redemption.discount.code, amountMinor: money(redemption.amountMinor), redeemedAt: redemption.redeemedAt, releasedAt: redemption.releasedAt })),
  statusHistory: order.statusHistory,
});
