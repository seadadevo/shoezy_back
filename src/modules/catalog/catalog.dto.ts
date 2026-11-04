import type {
  CatalogProductDetailRecord,
  CatalogProductListRecord,
  CatalogPromotionRecord,
  CatalogVariantPricing,
  CatalogVariantSummary,
  ColorVariantDto,
} from "./catalog.types";
import { localizedField, type CatalogLocale } from "../../common/localization/catalog-localization";
import { ratingSummaryFromGroups, type RatingSummary } from "../reviews/rating-summary";

function percentageFromBasisPoints(value: bigint): string {
  const whole = value / 100n;
  const fraction = (value % 100n).toString().padStart(2, "0").replace(/0+$/, "");
  return fraction ? `${whole}.${fraction}` : whole.toString();
}

export function toCatalogPromotionDto(promotion: CatalogPromotionRecord, locale: CatalogLocale = "en") {
  return {
    id: promotion.id,
    name: localizedField(promotion.translations, locale, "name", promotion.name),
    description: localizedField(promotion.translations, locale, "description", promotion.description),
    imageUrl: promotion.imageUrl,
    ctaUrl: promotion.ctaUrl,
    activationMode: promotion.code ? "COUPON" as const : "AUTOMATIC" as const,
    discount: {
      type: promotion.type,
      percentage: promotion.type === "PERCENTAGE" ? percentageFromBasisPoints(promotion.value) : null,
      amountMinor: promotion.type === "FIXED_AMOUNT" ? promotion.value.toString() : null,
      currency: promotion.type === "FIXED_AMOUNT" ? promotion.currency : null,
    },
    scope: promotion.scope,
    minimumOrderMinor: promotion.minOrderMinor?.toString() ?? null,
    maximumDiscountMinor: promotion.maxDiscountMinor?.toString() ?? null,
    startsAt: promotion.startsAt,
    endsAt: promotion.endsAt,
    sortOrder: promotion.sortOrder,
  };
}

function entity<T extends { name: string; translations: Array<{ locale: string; name: string; description?: string | null }> }>(value: T, locale: CatalogLocale) {
  const { translations, ...fields } = value;
  return { ...fields, name: localizedField(translations, locale, "name", value.name), ...("description" in value ? { description: localizedField(translations, locale, "description", value.description) } : {}) };
}

function promotionPricing(pricing: CatalogVariantPricing | null | undefined) {
  if (!pricing || pricing.discountMinor <= 0n) return null;
  return {
    originalPriceMinor: pricing.originalPriceMinor.toString(),
    effectivePriceMinor: pricing.effectivePriceMinor.toString(),
    discountMinor: pricing.discountMinor.toString(),
    discountPercentageBasisPoints: pricing.discountPercentageBasisPoints.toString(),
    promotions: pricing.promotions.map((promotion) => ({
      ...promotion,
      value: promotion.value.toString(),
      amountMinor: promotion.amountMinor.toString(),
    })),
  };
}

type CatalogCardMediaRecord = CatalogProductListRecord["media"][number];

function cardMediaDto(media: CatalogCardMediaRecord | undefined) {
  return media ? {
    id: media.id,
    type: media.type,
    mediaType: media.mediaType ?? media.type,
    mimeType: media.mimeType ?? null,
    url: media.url,
    altText: media.altText,
    position: media.position,
    isPrimary: media.isPrimary,
  } : null;
}

export function toCatalogProductListDto(product: CatalogProductListRecord, summary: CatalogVariantSummary, locale: CatalogLocale = "en") {
  const publicMedia = product.media.filter((item) => item.variant === null || item.variant.productId === product.id);
  const previewImages = publicMedia.filter((item) => item.type === "IMAGE" && item.mediaType !== "VIDEO").slice(0, 4);
  const primaryMedia = previewImages[0];
  const previewVideo = publicMedia.find((item) => item.type === "VIDEO" || item.mediaType === "VIDEO");
  return {
    id: product.id,
    name: localizedField(product.translations, locale, "name", product.name),
    slug: product.slug,
    shortDescription: localizedField(product.translations, locale, "shortDescription", product.shortDescription),
    basePrice: product.basePrice.toString(),
    compareAtPrice: product.compareAtPrice?.toString() ?? null,
    minimumVariantPriceMinor: summary.minimumPriceMinor?.toString() ?? null,
    minimumEffectivePriceMinor: (summary.minimumEffectivePriceMinor ?? summary.minimumPriceMinor)?.toString() ?? null,
    promotionalPricing: promotionPricing(summary.promotionalPricing),
    previewColors: summary.previewColors ?? [],
    colorCount: summary.colorCount ?? 0,
    inStock: (summary.stockQuantity ?? 0) > 0,
    groupId: product.groupId,
    colorName: product.colorName ?? null,
    colorHex: product.colorHex ?? null,
    isFeatured: product.isFeatured,
    priority: product.priority,
    colorVariants: summary.colorVariants ?? [],
    gender: product.gender,
    season: product.season,
    publishedAt: product.publishedAt,
    brand: entity(product.brand, locale),
    categories: product.productCategories.map((link) => ({ ...entity(link.category, locale), isPrimary: link.isPrimary })),
    primaryMedia: cardMediaDto(primaryMedia),
    previewImages: previewImages.map((image) => cardMediaDto(image)!),
    previewVideo: cardMediaDto(previewVideo),
  };
}

export function toCatalogProductDetailDto(
  product: CatalogProductDetailRecord,
  locale: CatalogLocale = "en",
  pricing?: Map<string, CatalogVariantPricing>,
  ratingSummary: RatingSummary = ratingSummaryFromGroups([]),
  colorVariants: ColorVariantDto[] = [],
) {
  const media = product.media
    .filter((item) => item.variant === null || item.variant.productId === product.id)
    .map(({ productId: _productId, variant: _variant, ...item }) => item);
  const sizeGuide = product.sizeGuide && (!product.sizeGuide.brand || product.sizeGuide.brand.isActive)
    ? { id: product.sizeGuide.id, name: product.sizeGuide.name, gender: product.sizeGuide.gender }
    : null;
  return {
    id: product.id,
    name: localizedField(product.translations, locale, "name", product.name),
    slug: product.slug,
    shortDescription: localizedField(product.translations, locale, "shortDescription", product.shortDescription),
    description: localizedField(product.translations, locale, "description", product.description),
    material: localizedField(product.translations, locale, "material", product.material),
    basePrice: product.basePrice.toString(),
    compareAtPrice: product.compareAtPrice?.toString() ?? null,
    gender: product.gender,
    season: product.season,
    seoTitle: localizedField(product.translations, locale, "seoTitle", product.seoTitle),
    seoDescription: localizedField(product.translations, locale, "seoDescription", product.seoDescription),
    publishedAt: product.publishedAt,
    ratingSummary,
    brand: entity(product.brand, locale),
    categories: product.productCategories.map((link) => ({ ...entity(link.category, locale), isPrimary: link.isPrimary })),
    media,
    options: product.options.map((option) => ({
      id: option.id,
      name: localizedField(option.translations, locale, "name", option.name),
      position: option.position,
      values: option.values.map((value) => { const { translations, ...fields } = value; return { ...fields, displayValue: localizedField(translations, locale, "displayValue", value.displayValue ?? value.value) }; }),
    })),
    variants: product.variants.map((variant) => ({
      id: variant.id,
      sku: variant.sku,
      title: variant.title,
      stockQuantity: variant.stockQuantity,
      weightGrams: variant.weightGrams,
      priceMinor: variant.priceMinor.toString(),
      compareAtPriceMinor: variant.compareAtPriceMinor?.toString() ?? null,
      promotionalPricing: promotionPricing(pricing?.get(variant.id)),
      optionValues: variant.optionValues.map((link) => { const { translations, ...fields } = link.optionValue; return { ...fields, displayValue: localizedField(translations, locale, "displayValue", link.optionValue.displayValue ?? link.optionValue.value) }; }),
    })),
    sizeGuide,
    collections: product.collectionProducts.map((link) => entity(link.collection, locale)),
    colorVariants,
  };
}
