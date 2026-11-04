import { Prisma } from "@prisma/client";
import { describe, expect, it, vi } from "vitest";
import { SizeGuidesService, type SizeGuidesStore } from "../../src/modules/size-guides/size-guides.service";
import type { SizeGuideDetailRecord, SizeGuideEntryRecord, SizeGuideRecord } from "../../src/modules/size-guides/size-guides.types";
import { createSizeGuideEntrySchema } from "../../src/modules/size-guides/size-guides.validation";

const guideId = "11111111-1111-4111-8111-111111111111";
const otherGuideId = "22222222-2222-4222-8222-222222222222";
const entryId = "33333333-3333-4333-8333-333333333333";
const brandId = "44444444-4444-4444-8444-444444444444";
function guide(overrides: Partial<SizeGuideRecord> = {}): SizeGuideRecord { return { id: guideId, name: "Unisex", gender: null, brandId: null, notes: null, createdAt: new Date(), updatedAt: new Date(), ...overrides }; }
function entry(overrides: Partial<SizeGuideEntryRecord> = {}): SizeGuideEntryRecord { return { id: entryId, sizeGuideId: guideId, euSize: "42", usSize: null, ukSize: null, footLengthCm: new Prisma.Decimal("26.50"), sortOrder: 0, ...overrides }; }
function store(): SizeGuidesStore {
  return {
    list: vi.fn(async () => ({ items: [guide()], total: 1 })),
    findBrand: vi.fn(async (id) => id === brandId ? { id, isActive: false } : null),
    findById: vi.fn(async (id) => id === guideId ? guide() : null),
    findDetail: vi.fn(async (id) => id === guideId ? { ...guide(), brand: null, entries: [entry()] } as SizeGuideDetailRecord : null),
    create: vi.fn(async (input) => guide(input)),
    update: vi.fn(async (id, input) => id === guideId ? guide(input) : null),
    findEntry: vi.fn(async (id, nestedEntryId) => id === guideId && nestedEntryId === entryId ? entry() : null),
    createEntry: vi.fn(async (id, input) => entry({ sizeGuideId: id, ...input, footLengthCm: input.footLengthCm ? new Prisma.Decimal(input.footLengthCm) : null })),
    updateEntry: vi.fn(async (id, nestedEntryId, input) => id === guideId && nestedEntryId === entryId ? entry({ ...input, footLengthCm: input.footLengthCm === undefined ? new Prisma.Decimal("26.50") : input.footLengthCm === null ? null : new Prisma.Decimal(input.footLengthCm) }) : null),
    deleteEntry: vi.fn(async (id, nestedEntryId) => id === guideId && nestedEntryId === entryId),
    deleteIfUnused: vi.fn(async () => "DELETED" as const),
  };
}

describe("size guide service", () => {
  it("allows an existing inactive brand and rejects a missing brand", async () => {
    await expect(new SizeGuidesService(store()).create({ name: "Guide", brandId })).resolves.toMatchObject({ brandId });
    await expect(new SizeGuidesService(store()).create({ name: "Guide", brandId: otherGuideId })).rejects.toMatchObject({ code: "BRAND_NOT_FOUND" });
  });
  it("returns foot length as a decimal string", async () => {
    const result = await new SizeGuidesService(store()).get(guideId);
    expect(result.entries[0]?.footLengthCm).toBe("26.5");
  });
  it("denies cross-guide entry modification", async () => {
    await expect(new SizeGuidesService(store()).updateEntry(otherGuideId, entryId, { euSize: "43" })).rejects.toMatchObject({ code: "SIZE_GUIDE_ENTRY_NOT_FOUND" });
  });
  it("prevents updates that make an entry empty", async () => {
    const repository = store();
    vi.mocked(repository.findEntry).mockResolvedValue(entry({ footLengthCm: null }));
    await expect(new SizeGuidesService(repository).updateEntry(guideId, entryId, { euSize: null })).rejects.toMatchObject({ code: "SIZE_GUIDE_ENTRY_EMPTY" });
  });
  it("blocks deletion while referenced by a product", async () => {
    const repository = store(); vi.mocked(repository.deleteIfUnused).mockResolvedValue("IN_USE");
    await expect(new SizeGuidesService(repository).delete(guideId)).rejects.toMatchObject({ statusCode: 409, code: "SIZE_GUIDE_IN_USE" });
  });
});

describe("size guide entry validation", () => {
  it("rejects empty entries and non-string/out-of-range decimals", () => {
    expect(createSizeGuideEntrySchema.safeParse({ body: {}, params: { sizeGuideId: guideId }, query: {} }).success).toBe(false);
    expect(createSizeGuideEntrySchema.safeParse({ body: { footLengthCm: 26.5 }, params: { sizeGuideId: guideId }, query: {} }).success).toBe(false);
    expect(createSizeGuideEntrySchema.safeParse({ body: { footLengthCm: "1000.00" }, params: { sizeGuideId: guideId }, query: {} }).success).toBe(false);
    expect(createSizeGuideEntrySchema.safeParse({ body: { footLengthCm: "0.00" }, params: { sizeGuideId: guideId }, query: {} }).success).toBe(false);
  });
});
