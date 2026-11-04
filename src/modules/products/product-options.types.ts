import type { Prisma } from "@prisma/client";
export const optionValueSelect = { id: true, optionId: true, value: true, displayValue: true, colorHex: true, metadataJson: true, position: true, translations: { orderBy: { locale: "asc" }, select: { locale: true, displayValue: true } } } as const satisfies Prisma.ProductOptionValueSelect;
export const optionSelect = { id: true, productId: true, name: true, position: true,
  translations: { orderBy: { locale: "asc" }, select: { locale: true, name: true } },
  values: { orderBy: [{ position: "asc" as const }, { id: "asc" as const }], select: optionValueSelect },
} as const satisfies Prisma.ProductOptionSelect;
export type ProductOptionRecord = Prisma.ProductOptionGetPayload<{ select: typeof optionSelect }>;
export type ProductOptionValueRecord = Prisma.ProductOptionValueGetPayload<{ select: typeof optionValueSelect }>;
export type ProductOptionValueUsage = ProductOptionValueRecord & { _count: { variants: number } };
