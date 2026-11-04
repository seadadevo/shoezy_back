import type { ExchangeRecord } from "./exchanges.types";
export const toExchangeDto = (value: ExchangeRecord) => ({
  id: value.id, exchangeNumber: value.exchangeNumber, orderId: value.orderId, userId: value.userId, status: value.status, reason: value.reason,
  requestedAt: value.requestedAt, closedAt: value.closedAt, createdAt: value.createdAt, updatedAt: value.updatedAt, order: value.order,
  item: value.item && { id: value.item.id, orderItemId: value.item.orderItemId, replacementVariantId: value.item.replacementVariantId, quantity: value.item.quantity,
    original: { ...value.item.orderItem, unitPriceMinor: value.item.orderItem.unitPriceMinor.toString() },
    replacement: { ...value.item.replacementVariant, priceMinor: value.item.replacementVariant.priceMinor.toString() },
  },
});
