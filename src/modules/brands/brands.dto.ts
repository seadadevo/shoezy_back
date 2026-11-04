import type { BrandRecord } from "./brands.types";
import { translationsByLocale } from "../../common/localization/catalog-localization";

export function toBrandDto(brand: BrandRecord) {
  return {
    id: brand.id,
    name: brand.name,
    slug: brand.slug,
    productCount: brand._count.products,
    description: brand.description,
    logoUrl: brand.logoUrl,
    showcaseImageUrl: brand.showcaseImageUrl,
    isActive: brand.isActive,
    createdAt: brand.createdAt,
    updatedAt: brand.updatedAt,
    translations: translationsByLocale(brand.translations),
  };
}
