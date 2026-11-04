import type { Prisma } from "@prisma/client";

export const publicVariantVisibility = {
  isActive: true,
  deletedAt: null,
} as const satisfies Prisma.ProductVariantWhereInput;

export function publicProductVisibility(now: Date): Prisma.ProductWhereInput {
  return {
    status: "ACTIVE",
    deletedAt: null,
    publishedAt: { lte: now },
    brand: { isActive: true },
    productCategories: { some: { category: { isActive: true } } },
    variants: { some: publicVariantVisibility },
  };
}

