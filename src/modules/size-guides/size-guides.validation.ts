import { z } from "zod";
import { nonnegativePostgresInt } from "../../common/validation/postgres-int";
const uuid = z.string().uuid();
const emptyBody = z.preprocess((value) => value ?? {}, z.object({}).strict());
const emptyQuery = z.object({}).strict();
const nullableString = (max: number) => z.string().trim().min(1).max(max).nullable().optional();
const footLength = z.string().trim().regex(/^(?:0|[1-9]\d{0,2})(?:\.\d{1,2})?$/).refine((value) => value !== "0" && !/^0\.0{1,2}$/.test(value), "Must be greater than zero");
const entryFields = {
  euSize: nullableString(20), usSize: nullableString(20), ukSize: nullableString(20),
  footLengthCm: footLength.nullable().optional(), sortOrder: nonnegativePostgresInt.optional(),
};
const hasMeasurement = (value: { euSize?: string | null; usSize?: string | null; ukSize?: string | null; footLengthCm?: string | null }) =>
  Boolean(value.euSize ?? value.usSize ?? value.ukSize ?? value.footLengthCm);
const aggregateEntry = z.object(entryFields).strict().refine(hasMeasurement, "At least one size measurement is required");
const aggregateEntryUpdate = z.object({ id: uuid.optional(), ...entryFields }).strict().refine((value) => value.id || hasMeasurement(value), "At least one size measurement is required");
const entryChanges = z.object({ upsert: z.array(aggregateEntryUpdate).max(200), deleteIds: z.array(uuid).max(200).default([]) }).strict();

export const listSizeGuidesSchema = z.object({ body: emptyBody, params: z.object({}).strict(), query: z.object({
  page: z.coerce.number().int().positive().default(1), limit: z.coerce.number().int().positive().max(100).default(20),
  search: z.string().trim().min(1).max(100).optional(), brandId: uuid.optional(),
  sortOrder: z.enum(["asc", "desc"]).default("asc"),
}).strict() }).strict();
export const sizeGuideIdSchema = z.object({ body: emptyBody, params: z.object({ sizeGuideId: uuid }).strict(), query: emptyQuery }).strict();
export const sizeGuideEntryIdSchema = z.object({ body: emptyBody, params: z.object({ sizeGuideId: uuid, entryId: uuid }).strict(), query: emptyQuery }).strict();
export const createSizeGuideSchema = z.object({ body: z.object({
  name: z.string().trim().min(1).max(150), gender: nullableString(50), brandId: uuid.nullable().optional(), notes: z.string().trim().max(10_000).nullable().optional(), entries: z.array(aggregateEntry).max(200).optional(),
}).strict(), params: z.object({}).strict(), query: emptyQuery }).strict();
export const updateSizeGuideSchema = z.object({ body: z.object({
  name: z.string().trim().min(1).max(150).optional(), gender: nullableString(50), brandId: uuid.nullable().optional(), notes: z.string().trim().max(10_000).nullable().optional(), entries: entryChanges.optional(),
}).strict().refine((value) => Object.keys(value).length > 0, "At least one size guide field is required"), params: z.object({ sizeGuideId: uuid }).strict(), query: emptyQuery }).strict();
export const createSizeGuideEntrySchema = z.object({ body: z.object(entryFields).strict().refine(hasMeasurement, "At least one size measurement is required"), params: z.object({ sizeGuideId: uuid }).strict(), query: emptyQuery }).strict();
export const updateSizeGuideEntrySchema = z.object({ body: z.object(entryFields).strict().refine((value) => Object.keys(value).length > 0, "At least one entry field is required"), params: z.object({ sizeGuideId: uuid, entryId: uuid }).strict(), query: emptyQuery }).strict();

export type ListSizeGuidesQuery = z.infer<typeof listSizeGuidesSchema>["query"];
export type CreateSizeGuideInput = z.infer<typeof createSizeGuideSchema>["body"];
export type UpdateSizeGuideInput = z.infer<typeof updateSizeGuideSchema>["body"];
export type CreateSizeGuideEntryInput = z.infer<typeof createSizeGuideEntrySchema>["body"];
export type UpdateSizeGuideEntryInput = z.infer<typeof updateSizeGuideEntrySchema>["body"];
