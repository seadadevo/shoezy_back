import type { Prisma } from "@prisma/client";
export const exchangeSelect = {
  id: true, exchangeNumber: true, orderId: true, userId: true, status: true, reason: true, requestedAt: true, closedAt: true, createdAt: true, updatedAt: true,
  order: { select: { orderNumber: true, status: true, currency: true } },
  item: { select: { id: true, orderItemId: true, replacementVariantId: true, quantity: true, orderItem: { select: { productName: true, variantName: true, sku: true, unitPriceMinor: true } }, replacementVariant: { select: { title: true, sku: true, priceMinor: true } } } },
} as const satisfies Prisma.ExchangeRequestSelect;
export type ExchangeRecord = Prisma.ExchangeRequestGetPayload<{ select: typeof exchangeSelect }>;
