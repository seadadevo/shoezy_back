import type { CollectionDetailRecord, CollectionRecord } from "./collections.types";
import { translationsByLocale } from "../../common/localization/catalog-localization";

export function toCollectionDto(collection: CollectionRecord) {
  return {
    id: collection.id,
    name: collection.name,
    slug: collection.slug,
    productCount: collection._count.collectionProducts,
    description: collection.description,
    imageUrl: collection.imageUrl,
    videoUrl: collection.videoUrl,
    videoMimeType: collection.videoMimeType,
    isActive: collection.isActive,
    startsAt: collection.startsAt,
    endsAt: collection.endsAt,
    createdAt: collection.createdAt,
    updatedAt: collection.updatedAt,
    translations: translationsByLocale(collection.translations),
  };
}

export function toCollectionDetailDto(collection: CollectionDetailRecord) {
  return {
    ...toCollectionDto(collection),
    products: collection.collectionProducts.map((link) => ({
      id: link.product.id,
      name: link.product.name,
      slug: link.product.slug,
      status: link.product.status,
      deletedAt: link.product.deletedAt,
      position: link.position,
      translations: translationsByLocale(link.product.translations),
    })),
  };
}
