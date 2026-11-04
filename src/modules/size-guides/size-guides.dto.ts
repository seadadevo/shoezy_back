import type { SizeGuideDetailRecord, SizeGuideEntryRecord, SizeGuideRecord } from "./size-guides.types";
export function toSizeGuideDto(guide: SizeGuideRecord) {
  return { id: guide.id, name: guide.name, gender: guide.gender, brandId: guide.brandId, notes: guide.notes, createdAt: guide.createdAt, updatedAt: guide.updatedAt };
}
export function toSizeGuideEntryDto(entry: SizeGuideEntryRecord) {
  return { id: entry.id, sizeGuideId: entry.sizeGuideId, euSize: entry.euSize, usSize: entry.usSize,
    ukSize: entry.ukSize, footLengthCm: entry.footLengthCm?.toString() ?? null, sortOrder: entry.sortOrder };
}
export function toSizeGuideDetailDto(guide: SizeGuideDetailRecord) {
  return { ...toSizeGuideDto(guide), brand: guide.brand, entries: guide.entries.map(toSizeGuideEntryDto) };
}
