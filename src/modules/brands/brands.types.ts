import type { Prisma } from "@prisma/client";

export const brandSelect = {
  id: true,
  name: true,
  slug: true,
  description: true,
  logoUrl: true,
  showcaseImageUrl: true,
  isActive: true,
  createdAt: true,
  updatedAt: true,
  _count: { select: { products: { where: { deletedAt: null } } } },
  translations: { orderBy: { locale: "asc" }, select: { locale: true, name: true, description: true } },
} as const satisfies Prisma.BrandSelect;

export type BrandRecord = Prisma.BrandGetPayload<{ select: typeof brandSelect }>;
