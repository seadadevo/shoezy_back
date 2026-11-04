import type { Prisma } from "@prisma/client";

export const cartSelect = {
  id: true,
  userId: true,
  status: true,
  currency: true,
  discountCode: true,
  expiresAt: true,
  createdAt: true,
  updatedAt: true,
  items: {
    orderBy: [{ addedAt: "asc" as const }, { id: "asc" as const }],
    select: {
      id: true,
      cartId: true,
      variantId: true,
      quantity: true,
      unitPriceMinor: true,
      discountMinor: true,
      addedAt: true,
      updatedAt: true,
      variant: {
        select: {
          id: true,
          productId: true,
          sku: true,
          title: true,
          isActive: true,
          stockQuantity: true,
          priceMinor: true,
          costMinor: true,
          compareAtPriceMinor: true,
          deletedAt: true,
          media: { orderBy: [{ isPrimary: "desc" as const }, { position: "asc" as const }, { id: "asc" as const }], take: 1, select: { id: true, type: true, url: true, altText: true } },
          optionValues: {
            orderBy: { optionValue: { option: { position: "asc" as const } } },
            select: { optionValue: { select: { id: true, value: true, displayValue: true, colorHex: true, option: { select: { id: true, name: true } } } } },
          },
          product: {
            select: {
              id: true, name: true, slug: true, status: true, publishedAt: true, deletedAt: true,
              brand: { select: { id: true, name: true, slug: true, isActive: true } },
              productCategories: { select: { category: { select: { id: true, isActive: true } } } },
              collectionProducts: { select: { collection: { select: { id: true, isActive: true, startsAt: true, endsAt: true } } } },
              media: { where: { variantId: null }, orderBy: [{ isPrimary: "desc" as const }, { position: "asc" as const }, { id: "asc" as const }], take: 1, select: { id: true, type: true, url: true, altText: true } },
            },
          },
        },
      },
    },
  },
} as const satisfies Prisma.CartSelect;

export type CartRecord = Prisma.CartGetPayload<{ select: typeof cartSelect }>;
export type CartItemRecord = CartRecord["items"][number];
export type CartMutationResult = CartRecord | "ITEM_NOT_FOUND" | "VARIANT_UNAVAILABLE" | "INSUFFICIENT_STOCK" | "QUANTITY_OVERFLOW" | "CART_SESSION_INVALID";
