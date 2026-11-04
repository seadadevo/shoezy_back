import type { Prisma } from "@prisma/client";

export const productMediaSelect = {
  id: true,
  productId: true,
  variantId: true,
  type: true,
  mediaType: true,
  mimeType: true,
  url: true,
  altText: true,
  position: true,
  isPrimary: true,
  createdAt: true,
} as const satisfies Prisma.ProductMediaSelect;

export type ProductMediaRecord = Prisma.ProductMediaGetPayload<{
  select: typeof productMediaSelect;
}>;

export const productVideoRecordSelect = {
  ...productMediaSelect,
  storageProvider: true,
  storageKey: true,
} as const satisfies Prisma.ProductMediaSelect;

export type ProductVideoRecord = Prisma.ProductMediaGetPayload<{
  select: typeof productVideoRecordSelect;
}>;
