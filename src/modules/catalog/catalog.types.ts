import type { Prisma } from "@prisma/client";
import { publicProductVisibility } from "./public-product-visibility";

const publicMediaWhere = {
  OR: [
    { variantId: null },
    { variant: { isActive: true, deletedAt: null } },
  ],
} as const satisfies Prisma.ProductMediaWhereInput;

export const catalogProductListSelect = {
  groupId: true,
  colorName: true,
  colorHex: true,
  isFeatured: true,
  priority: true,
  id: true,
  name: true,
  slug: true,
  shortDescription: true,
  basePrice: true,
  compareAtPrice: true,
  gender: true,
  season: true,
  publishedAt: true,
  translations: { select: { locale: true, name: true, shortDescription: true, description: true, material: true, seoTitle: true, seoDescription: true } },
  brand: { select: { id: true, name: true, slug: true, translations: { select: { locale: true, name: true, description: true } } } },
  productCategories: {
    where: { category: { isActive: true } },
    orderBy: [{ isPrimary: "desc" as const }, { category: { name: "asc" as const } }],
    select: { isPrimary: true, category: { select: { id: true, name: true, slug: true, translations: { select: { locale: true, name: true, description: true } } } } },
  },
  media: {
    where: { ...publicMediaWhere, type: { in: ["IMAGE", "VIDEO"] as const } },
    orderBy: [{ type: "desc" as const }, { isPrimary: "desc" as const }, { position: "asc" as const }, { id: "asc" as const }],
    take: 5,
    select: {
      id: true,
      productId: true,
      type: true,
      mediaType: true,
      mimeType: true,
      url: true,
      altText: true,
      position: true,
      isPrimary: true,
      variant: { select: { productId: true } },
    },
  },
} as const satisfies Prisma.ProductSelect;

export const catalogColorFilterSelect = {
  value: true,
  displayValue: true,
  colorHex: true,
  translations: { select: { locale: true, displayValue: true } },
} as const satisfies Prisma.ProductOptionValueSelect;

export function catalogProductDetailSelect(now: Date) {
  return {
    ...catalogProductListSelect,
    description: true,
    material: true,
    seoTitle: true,
    seoDescription: true,
    media: {
      where: publicMediaWhere,
      orderBy: [{ isPrimary: "desc" as const }, { position: "asc" as const }, { id: "asc" as const }],
      select: {
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
        variant: { select: { productId: true } },
      },
    },
    options: {
      orderBy: [{ position: "asc" as const }, { id: "asc" as const }],
      select: {
        id: true,
        name: true,
        position: true,
        translations: { select: { locale: true, name: true } },
        values: {
          orderBy: [{ position: "asc" as const }, { id: "asc" as const }],
          select: { id: true, value: true, displayValue: true, colorHex: true, position: true, translations: { select: { locale: true, displayValue: true } } },
        },
      },
    },
    variants: {
      where: { isActive: true, deletedAt: null },
      orderBy: [{ title: "asc" as const }, { id: "asc" as const }],
      select: {
        id: true,
        sku: true,
        title: true,
        stockQuantity: true,
        weightGrams: true,
        priceMinor: true,
        compareAtPriceMinor: true,
        optionValues: {
          select: { optionValue: { select: { id: true, value: true, displayValue: true, colorHex: true, optionId: true, translations: { select: { locale: true, displayValue: true } } } } },
        },
      },
    },
    sizeGuide: {
      select: {
        id: true,
        name: true,
        gender: true,
        brand: { select: { isActive: true } },
      },
    },
    collectionProducts: {
      where: {
        collection: {
          isActive: true,
          AND: [
            { OR: [{ startsAt: null }, { startsAt: { lte: now } }] },
            { OR: [{ endsAt: null }, { endsAt: { gt: now } }] },
          ],
        },
      },
      orderBy: [{ position: "asc" as const }, { collectionId: "asc" as const }],
      select: { collection: { select: { id: true, name: true, slug: true, translations: { select: { locale: true, name: true, description: true } } } } },
    },
  } as const satisfies Prisma.ProductSelect;
}

export function catalogCategorySelect(now: Date) {
  return {
    id: true,
    parentId: true,
    name: true,
    slug: true,
    description: true,
    imageUrl: true,
    videoUrl: true,
    videoMimeType: true,
    sortOrder: true,
    _count: { select: { productCategories: { where: { product: publicProductVisibility(now) } } } },
    translations: { select: { locale: true, name: true, description: true } },
  } as const satisfies Prisma.CategorySelect;
}

export const catalogPromotionSelect = {
  id: true,
  name: true,
  description: true,
  imageUrl: true,
  ctaUrl: true,
  code: true,
  type: true,
  scope: true,
  value: true,
  currency: true,
  minOrderMinor: true,
  maxDiscountMinor: true,
  startsAt: true,
  endsAt: true,
  sortOrder: true,
  translations: {
    select: { locale: true, name: true, description: true },
  },
} as const satisfies Prisma.DiscountSelect;

export type CatalogProductListRecord = Prisma.ProductGetPayload<{ select: typeof catalogProductListSelect }>;
export type CatalogProductDetailRecord = Prisma.ProductGetPayload<{ select: ReturnType<typeof catalogProductDetailSelect> }>;
export type CatalogColorFilterRecord = Prisma.ProductOptionValueGetPayload<{ select: typeof catalogColorFilterSelect }>;
export type CatalogPromotion = {
  discountId: string;
  name: string;
  type: "PERCENTAGE" | "FIXED_AMOUNT" | "FREE_SHIPPING";
  value: bigint;
  amountMinor: bigint;
  endsAt: Date | null;
};
export type CatalogVariantPricing = {
  variantId: string;
  originalPriceMinor: bigint;
  effectivePriceMinor: bigint;
  discountMinor: bigint;
  discountPercentageBasisPoints: bigint;
  promotions: CatalogPromotion[];
};
export type CatalogPreviewColor = {
  value: string;
  displayValue: string;
  colorHex: string | null;
};
export type CatalogVariantSummary = {
  productId: string;
  minimumPriceMinor: bigint | null;
  minimumEffectivePriceMinor?: bigint | null;
  stockQuantity: number | null;
  promotionalPricing?: CatalogVariantPricing | null;
  previewColors?: CatalogPreviewColor[];
  colorCount?: number;
  colorVariants?: ColorVariantDto[];
};

export type ColorVariantDto = {
  id: string;
  slug: string;
  colorName: string;
  colorHex: string | null;
  thumbnail: string;
  inStock: boolean;
  isCurrent?: boolean;
  basePrice?: string;
};
export type CatalogCategoryRecord = Prisma.CategoryGetPayload<{ select: ReturnType<typeof catalogCategorySelect> }>;
export type CatalogPromotionRecord = Prisma.DiscountGetPayload<{ select: typeof catalogPromotionSelect }>;
