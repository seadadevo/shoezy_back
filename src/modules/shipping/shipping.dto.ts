import type { AdminShippingMethodRecord, OrderShipmentRecord, PublicShippingMethodRecord } from "./shipping.types";
export const toPublicShippingMethodDto = (method: PublicShippingMethodRecord) => ({ ...method, basePriceMinor: method.basePriceMinor.toString() });
export const toAdminShippingMethodDto = (method: AdminShippingMethodRecord) => ({ ...method, basePriceMinor: method.basePriceMinor.toString() });
export const toOrderShipmentDto = (order: OrderShipmentRecord) => ({
  orderId: order.id, orderNumber: order.orderNumber, orderStatus: order.status, shippingProvider: order.shippingProvider,
  trackingNumber: order.trackingNumber, shippingMinor: order.shippingMinor.toString(), currency: order.currency,
  shippedAt: order.statusHistory.find((history) => history.toStatus === "SHIPPED")?.createdAt ?? null,
  deliveredAt: order.statusHistory.find((history) => history.toStatus === "DELIVERED")?.createdAt ?? null,
  placedAt: order.placedAt, updatedAt: order.updatedAt,
});
