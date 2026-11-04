import type { Prisma } from "@prisma/client";
export const checkoutAddressSelect = { id: true, recipientName: true, phone: true, countryCode: true, state: true, city: true, area: true, postalCode: true, line1: true, line2: true, latitude: true, longitude: true } as const satisfies Prisma.AddressSelect;
export const checkoutShippingSelect = { id: true, code: true, name: true, basePriceMinor: true, currency: true, estimatedMinDays: true, estimatedMaxDays: true } as const satisfies Prisma.ShippingMethodSelect;
export type CheckoutAddressRecord = Prisma.AddressGetPayload<{ select: typeof checkoutAddressSelect }>;
export type CheckoutShippingRecord = Prisma.ShippingMethodGetPayload<{ select: typeof checkoutShippingSelect }>;
