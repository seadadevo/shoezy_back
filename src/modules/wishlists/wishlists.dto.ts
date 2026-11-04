import type { WishlistRecord } from "./wishlists.types";
export function toWishlistDto(item: WishlistRecord, now = new Date()) {
  const productAvailable = item.product.status === "ACTIVE" && item.product.deletedAt === null && item.product.publishedAt !== null && item.product.publishedAt <= now && item.product.brand.isActive && item.product.productCategories.some((link) => link.category.isActive) && item.product.variants.length > 0;
  const variantAvailable = item.variant === null || (item.variant.productId === item.productId && item.variant.isActive && item.variant.deletedAt === null);
  const available = productAvailable && variantAvailable;
  return { id: item.id, productId: item.productId, variantId: item.variantId, addedAt: item.addedAt, available,
    product: available ? { id: item.product.id, name: item.product.name, slug: item.product.slug, shortDescription: item.product.shortDescription, basePrice: item.product.basePrice.toString(), compareAtPrice: item.product.compareAtPrice?.toString() ?? null, brand: { id: item.product.brand.id, name: item.product.brand.name, slug: item.product.brand.slug }, primaryMedia: item.product.media[0] ?? null } : null,
    variant: available && item.variant ? { id: item.variant.id, title: item.variant.title, sku: item.variant.sku, priceMinor: item.variant.priceMinor.toString(), compareAtPriceMinor: item.variant.compareAtPriceMinor?.toString() ?? null, stockQuantity: item.variant.stockQuantity } : null };
}
