import type { Prisma } from "@prisma/client";
export const variantSelect = { id: true, productId: true, sku: true, barcode: true, title: true, isActive: true,
  stockQuantity: true, weightGrams: true, priceMinor: true, costMinor: true, compareAtPriceMinor: true,
  metadataJson: true, createdAt: true, updatedAt: true, deletedAt: true,
  optionValues: { orderBy: { optionValue: { option: { position: "asc" as const } } }, select: { optionValue: { select: {
    id: true, value: true, displayValue: true, colorHex: true, position: true,
    option: { select: { id: true, name: true, position: true } },
  } } } },
} as const satisfies Prisma.ProductVariantSelect;
export type VariantRecord = Prisma.ProductVariantGetPayload<{ select: typeof variantSelect }>;
export type VariantCombination = { id: string; optionValues: Array<{ optionValueId: string }> };
