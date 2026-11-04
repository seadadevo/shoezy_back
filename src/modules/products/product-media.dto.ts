import type { ProductMediaRecord } from "./product-media.types";

export function toProductMediaDto(media: ProductMediaRecord) {
  return {
    id: media.id,
    productId: media.productId,
    variantId: media.variantId,
    type: media.type,
    mediaType: media.mediaType ?? media.type,
    mimeType: media.mimeType ?? null,
    url: media.url,
    altText: media.altText,
    position: media.position,
    isPrimary: media.isPrimary,
    createdAt: media.createdAt,
  };
}
