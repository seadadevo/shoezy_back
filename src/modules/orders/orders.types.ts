import type { Prisma } from "@prisma/client";

export const orderListSelect = {
  id: true, orderNumber: true, status: true, paymentMethod: true, paymentStatus: true, currency: true,
  subtotalMinor: true, discountMinor: true, shippingMinor: true, totalMinor: true, paidMinor: true,
  refundedMinor: true, placedAt: true, confirmedAt: true, cancelledAt: true, createdAt: true, updatedAt: true,
  _count: { select: { items: true } },
} as const satisfies Prisma.OrderSelect;

export const orderDetailSelect = {
  id: true, orderNumber: true, userId: true, guestSessionTokenHash: true, status: true, paymentMethod: true, paymentStatus: true, currency: true,
  customerEmail: true, customerPhone: true, customerFirstName: true, customerLastName: true, subtotalMinor: true, discountMinor: true, shippingMinor: true,
  totalMinor: true, paidMinor: true, refundedMinor: true, paidAt: true, notes: true, trackingNumber: true,
  shippingProvider: true, placedAt: true, confirmedAt: true, cancelledAt: true, createdAt: true, updatedAt: true,
  shippingMethodCode: true, shippingMethodName: true, shippingZoneCode: true, shippingZoneName: true,
  whatsappConfirmationNumber: true, whatsappStoreName: true,
  address: { select: { recipientName: true, phone: true, countryCode: true, state: true, city: true, area: true, line1: true, line2: true, postalCode: true, latitude: true, longitude: true } },
  items: { orderBy: [{ id: "asc" as const }], select: {
    id: true, productId: true, variantId: true, productName: true, variantName: true, sku: true, quantity: true,
    unitPriceMinor: true, discountMinor: true, lineTotalMinor: true, snapshotJson: true,
    variant: { select: { media: {
      where: { type: "IMAGE" as const, mediaType: "IMAGE" as const },
      orderBy: [{ isPrimary: "desc" as const }, { position: "asc" as const }, { id: "asc" as const }],
      select: { productId: true, variantId: true, type: true, mediaType: true, url: true, isPrimary: true },
    } } },
    product: { select: { media: {
      where: { variantId: null, type: "IMAGE" as const, mediaType: "IMAGE" as const },
      orderBy: [{ isPrimary: "desc" as const }, { position: "asc" as const }, { id: "asc" as const }],
      select: { productId: true, variantId: true, type: true, mediaType: true, url: true, isPrimary: true },
    } } },
  } },
  statusHistory: { orderBy: [{ createdAt: "asc" as const }, { id: "asc" as const }], select: { id: true, fromStatus: true, toStatus: true, createdAt: true } },
  discountRedemptions: { orderBy: { redeemedAt: "asc" as const }, select: { discountId: true, amountMinor: true, redeemedAt: true, releasedAt: true, discount: { select: { name: true, code: true } } } },
} as const satisfies Prisma.OrderSelect;

export type OrderListRecord = Prisma.OrderGetPayload<{ select: typeof orderListSelect }>;
export type OrderDetailRecord = Prisma.OrderGetPayload<{ select: typeof orderDetailSelect }>;
type PlaceOrderFailureKind = "IDEMPOTENCY_CONFLICT" | "USER_NOT_FOUND" | "ADDRESS_NOT_FOUND" | "SHIPPING_METHOD_NOT_FOUND" | "SHIPPING_RATE_NOT_AVAILABLE" | "CART_EMPTY" | "CURRENCY_MISMATCH" | "ITEM_UNAVAILABLE" | "INSUFFICIENT_STOCK" | "DISCOUNT_NOT_ELIGIBLE" | "DISCOUNT_LIMIT_CHANGED" | "WRITE_CONFLICT";
type PlaceOrderFailure = { [Kind in PlaceOrderFailureKind]: { kind: Kind } }[PlaceOrderFailureKind];
export type PlaceOrderResult = { kind: "CREATED" | "REPLAYED"; order: OrderDetailRecord; guestAccessToken?: string | null } | PlaceOrderFailure;
export type TransitionResult =
  | { kind: "UPDATED" | "REPLAYED"; order: OrderDetailRecord }
  | { kind: "NOT_FOUND" }
  | { kind: "INVALID_TRANSITION" }
  | { kind: "SHIPPING_DETAILS_REQUIRED" }
  | { kind: "RESTORE_OVERFLOW" };
