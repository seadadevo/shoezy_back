import type { Prisma } from "@prisma/client";
import type { ProductOptionRecord } from "./product-options.types";
import type { VariantRecord } from "../variants/variants.types";
import type { ProductMediaRecord } from "./product-media.types";
export const productSelect = {
  id: true, groupId: true, colorName: true, colorHex: true, isFeatured: true, priority: true, brandId: true, sizeGuideId: true, name: true, slug: true, skuPrefix: true,
  shortDescription: true, basePrice: true, compareAtPrice: true, description: true,
  material: true, gender: true, season: true, status: true, seoTitle: true,
  seoDescription: true, publishedAt: true, createdAt: true, updatedAt: true, deletedAt: true,
  translations: { orderBy: { locale: "asc" }, select: { locale: true, name: true, shortDescription: true, description: true, material: true, seoTitle: true, seoDescription: true } },
  media: {
    where: { type: "IMAGE" },
    orderBy: [{ isPrimary: "desc" as const }, { position: "asc" as const }, { id: "asc" as const }],
    take: 1,
    select: { id: true, url: true, altText: true },
  },
} as const satisfies Prisma.ProductSelect;
export type ProductRecord = Prisma.ProductGetPayload<{ select: typeof productSelect }>;
export type ProductDetailRecord = Omit<ProductRecord, "media"> & {
  brand: { id: string; name: string; slug: string; isActive: boolean; translations: Array<{ locale: string; name: string; description: string | null }> };
  sizeGuide: { id: string; name: string } | null;
  productCategories: Array<{ isPrimary: boolean; category: { id: string; name: string; slug: string; isActive: boolean; translations: Array<{ locale: string; name: string; description: string | null }> } }>;
  options?: ProductOptionRecord[];
  variants?: VariantRecord[];
  media?: ProductMediaRecord[];
};
export type ProductReadinessRecord = {
  brand: { isActive: boolean };
  productCategories: Array<{ isPrimary: boolean; category: { isActive: boolean } }>;
  options: Array<{ id: string }>;
  variants: Array<{
    priceMinor: bigint;
    costMinor: bigint | null;
    compareAtPriceMinor: bigint | null;
    optionValues: Array<{ optionValue: { option: { id: string; productId: string } } }>;
  }>;
};
