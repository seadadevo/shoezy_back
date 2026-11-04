import type { Prisma } from "@prisma/client";

export const collectionSelect = {
  id: true,
  name: true,
  slug: true,
  description: true,
  imageUrl: true,
  videoUrl: true,
  videoMimeType: true,
  videoStorageProvider: true,
  videoStorageKey: true,
  isActive: true,
  startsAt: true,
  endsAt: true,
  createdAt: true,
  updatedAt: true,
  _count: { select: { collectionProducts: { where: { product: { deletedAt: null } } } } },
  translations: { orderBy: { locale: "asc" }, select: { locale: true, name: true, description: true } },
} as const satisfies Prisma.CollectionSelect;

export const collectionPublicSelect = {
  id: true,
  name: true,
  slug: true,
  description: true,
  imageUrl: true,
  videoUrl: true,
  videoMimeType: true,
  isActive: true,
  startsAt: true,
  endsAt: true,
  createdAt: true,
  updatedAt: true,
  _count: { select: { collectionProducts: { where: { product: { deletedAt: null } } } } },
  translations: { orderBy: { locale: "asc" }, select: { locale: true, name: true, description: true } },
} as const satisfies Prisma.CollectionSelect;

export const collectionDetailSelect = {
  ...collectionSelect,
  collectionProducts: {
    orderBy: [{ position: "asc" as const }, { productId: "asc" as const }],
    select: {
      position: true,
      product: {
        select: { id: true, name: true, slug: true, status: true, deletedAt: true, translations: { orderBy: { locale: "asc" }, select: { locale: true, name: true } } },
      },
    },
  },
} as const satisfies Prisma.CollectionSelect;

export type CollectionRecord = Prisma.CollectionGetPayload<{ select: typeof collectionSelect }>;
export type CollectionDetailRecord = Prisma.CollectionGetPayload<{ select: typeof collectionDetailSelect }>;
