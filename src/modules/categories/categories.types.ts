import type { Prisma } from "@prisma/client";

export const categorySelect = {
  id: true,
  parentId: true,
  name: true,
  slug: true,
  description: true,
  imageUrl: true,
  videoUrl: true,
  videoMimeType: true,
  videoStorageProvider: true,
  videoStorageKey: true,
  sortOrder: true,
  isActive: true,
  createdAt: true,
  updatedAt: true,
  _count: { select: { productCategories: { where: { product: { deletedAt: null } } } } },
  translations: { orderBy: { locale: "asc" }, select: { locale: true, name: true, description: true } },
} as const satisfies Prisma.CategorySelect;

export type CategoryRecord = Prisma.CategoryGetPayload<{ select: typeof categorySelect }>;
export type CategoryTreeDto = Omit<CategoryRecord, "parentId" | "translations" | "_count" | "videoStorageProvider" | "videoStorageKey"> & { productCount: number; translations: Record<string, { name: string; description: string | null }>; children: CategoryTreeDto[] };
