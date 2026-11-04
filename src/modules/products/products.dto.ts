import type { ProductDetailRecord, ProductRecord } from "./products.types";
import { toOptionDto } from "./product-options.dto";
import { toVariantDto } from "../variants/variants.dto";
import { toProductMediaDto } from "./product-media.dto";
import { translationsByLocale } from "../../common/localization/catalog-localization";
export function toProductDto(product: ProductRecord | ProductDetailRecord) {
  return { id: product.id, groupId: product.groupId, colorName: product.colorName, colorHex: product.colorHex, isFeatured: product.isFeatured, priority: product.priority, brandId: product.brandId, sizeGuideId: product.sizeGuideId, name: product.name,
    slug: product.slug, skuPrefix: product.skuPrefix, shortDescription: product.shortDescription,
    basePrice: product.basePrice.toString(), compareAtPrice: product.compareAtPrice?.toString() ?? null,
    description: product.description, material: product.material, gender: product.gender, season: product.season,
    status: product.status, seoTitle: product.seoTitle, seoDescription: product.seoDescription,
    publishedAt: product.publishedAt, createdAt: product.createdAt, updatedAt: product.updatedAt,
    deletedAt: product.deletedAt, translations: translationsByLocale(product.translations),
    primaryImageUrl: product.media?.[0]?.url ?? null };
}
export function toProductDetailDto(product: ProductDetailRecord) {
  const { translations: brandTranslations, ...brand } = product.brand;
  return { ...toProductDto(product), brand: { ...brand, translations: translationsByLocale(brandTranslations) }, sizeGuide: product.sizeGuide,
    categories: product.productCategories.map((link) => { const { translations, ...category } = link.category; return { ...category, translations: translationsByLocale(translations), isPrimary: link.isPrimary }; }),
    options: product.options?.map(toOptionDto) ?? [], variants: product.variants?.map(toVariantDto) ?? [], media: product.media?.map(toProductMediaDto) ?? [] };
}
