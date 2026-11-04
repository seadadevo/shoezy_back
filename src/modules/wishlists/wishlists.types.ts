import type { Prisma } from "@prisma/client";
export const wishlistSelect = {
  id: true, userId: true, productId: true, variantId: true, addedAt: true,
  product: { select: {
    id: true, name: true, slug: true, shortDescription: true, basePrice: true, compareAtPrice: true,
    status: true, deletedAt: true, publishedAt: true, brand: { select: { id: true, name: true, slug: true, isActive: true } },
    productCategories: { select: { category: { select: { id: true, name: true, slug: true, isActive: true } } } },
    variants: { where: { isActive: true, deletedAt: null }, take: 1, select: { id: true } },
    media: { where: { OR: [{ variantId: null }, { variant: { isActive: true, deletedAt: null } }] }, orderBy: [{ isPrimary: "desc" as const }, { position: "asc" as const }, { id: "asc" as const }], take: 1, select: { id: true, url: true, altText: true, type: true } },
  } },
  variant: { select: { id: true, productId: true, title: true, sku: true, priceMinor: true, compareAtPriceMinor: true, stockQuantity: true, isActive: true, deletedAt: true } },
} as const satisfies Prisma.WishlistSelect;
export type WishlistRecord = Prisma.WishlistGetPayload<{ select: typeof wishlistSelect }>;
