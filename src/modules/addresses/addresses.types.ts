import type { Prisma } from "@prisma/client";

export const addressSelect = {
  id: true,
  userId: true,
  type: true,
  label: true,
  recipientName: true,
  phone: true,
  countryCode: true,
  state: true,
  city: true,
  area: true,
  postalCode: true,
  line1: true,
  line2: true,
  latitude: true,
  longitude: true,
  isDefault: true,
  createdAt: true,
  updatedAt: true,
} as const satisfies Prisma.AddressSelect;

export type AddressRecord = Prisma.AddressGetPayload<{ select: typeof addressSelect }>;
