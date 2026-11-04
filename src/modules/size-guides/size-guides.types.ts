import type { Prisma } from "@prisma/client";

export const sizeGuideSelect = {
  id: true, name: true, gender: true, brandId: true, notes: true, createdAt: true, updatedAt: true,
} as const satisfies Prisma.SizeGuideSelect;
export const sizeGuideEntrySelect = {
  id: true, sizeGuideId: true, euSize: true, usSize: true, ukSize: true,
  footLengthCm: true, sortOrder: true,
} as const satisfies Prisma.SizeGuideEntrySelect;
export type SizeGuideRecord = Prisma.SizeGuideGetPayload<{ select: typeof sizeGuideSelect }>;
export type SizeGuideEntryRecord = Prisma.SizeGuideEntryGetPayload<{ select: typeof sizeGuideEntrySelect }>;
export type SizeGuideDetailRecord = SizeGuideRecord & {
  brand: { id: string; name: string; isActive: boolean } | null;
  entries: SizeGuideEntryRecord[];
};
