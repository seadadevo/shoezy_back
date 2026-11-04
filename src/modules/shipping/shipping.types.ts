import type { Prisma } from "@prisma/client";
export const publicShippingMethodSelect = { id: true, code: true, name: true, basePriceMinor: true, currency: true, estimatedMinDays: true, estimatedMaxDays: true } as const satisfies Prisma.ShippingMethodSelect;
export const adminShippingMethodSelect = { ...publicShippingMethodSelect, isActive: true, createdAt: true, updatedAt: true } as const satisfies Prisma.ShippingMethodSelect;
export const orderShipmentSelect = { id: true, orderNumber: true, userId: true, status: true, shippingProvider: true, trackingNumber: true, shippingMinor: true, currency: true, placedAt: true, updatedAt: true, statusHistory: { where: { toStatus: { in: ["SHIPPED", "DELIVERED"] } }, orderBy: [{ createdAt: "asc" as const }, { id: "asc" as const }], select: { toStatus: true, createdAt: true } } } as const satisfies Prisma.OrderSelect;
export type PublicShippingMethodRecord = Prisma.ShippingMethodGetPayload<{ select: typeof publicShippingMethodSelect }>;
export type AdminShippingMethodRecord = Prisma.ShippingMethodGetPayload<{ select: typeof adminShippingMethodSelect }>;
export type OrderShipmentRecord = Prisma.OrderGetPayload<{ select: typeof orderShipmentSelect }>;
