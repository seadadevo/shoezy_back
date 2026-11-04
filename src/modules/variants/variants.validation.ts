import { z } from "zod";
import { nonnegativePostgresInt } from "../../common/validation/postgres-int";
const BIGINT_MAX = 9_223_372_036_854_775_807n; const INTEGER_PATTERN = /^(?:0|[1-9]\d*)$/; const uuid = z.string().uuid(); const emptyBody = z.preprocess((v) => v ?? {}, z.object({}).strict());
const integerString = z.string().regex(INTEGER_PATTERN).refine((value) => !INTEGER_PATTERN.test(value) || BigInt(value) <= BIGINT_MAX, "Exceeds signed BIGINT range");
const barcode = z.preprocess((value) => typeof value === "string" && value.trim() === "" ? null : value, z.string().trim().min(1).max(100).nullable());
const metadata = z.json().refine((value) => JSON.stringify(value).length <= 50_000, "Metadata JSON is too large").nullable().optional();
const optionIds = z.array(uuid).max(100).refine((ids) => new Set(ids).size === ids.length, "Option value IDs must be unique");
const queryBoolean = z.preprocess((v) => v === "true" ? true : v === "false" ? false : v, z.boolean());
export const listVariantsSchema = z.object({ body: emptyBody, params: z.object({ productId: uuid }).strict(), query: z.object({
  page: z.coerce.number().int().positive().default(1), limit: z.coerce.number().int().positive().max(100).default(20),
  search: z.string().trim().min(1).max(100).optional(), isActive: queryBoolean.optional(), includeDeleted: queryBoolean.default(false),
  sortBy: z.enum(["sku", "title", "stockQuantity", "priceMinor", "createdAt", "updatedAt"]).default("createdAt"), sortOrder: z.enum(["asc", "desc"]).default("desc"),
}).strict() }).strict();
export const variantIdSchema = z.object({ body: emptyBody, params: z.object({ productId: uuid, variantId: uuid }).strict(), query: z.object({}).strict() }).strict();
export const createVariantSchema = z.object({ body: z.object({ sku: z.string().trim().min(1).max(100), barcode: barcode.optional(),
  title: z.string().trim().min(1).max(220), isActive: z.boolean().optional(), stockQuantity: nonnegativePostgresInt.optional(),
  weightGrams: nonnegativePostgresInt.nullable().optional(), priceMinor: integerString, costMinor: integerString.nullable().optional(),
  compareAtPriceMinor: integerString.nullable().optional(), metadataJson: metadata, optionValueIds: optionIds,
}).strict(), params: z.object({ productId: uuid }).strict(), query: z.object({}).strict() }).strict();
export const updateVariantSchema = z.object({ body: z.object({ sku: z.string().trim().min(1).max(100).optional(), barcode: barcode.optional(),
  title: z.string().trim().min(1).max(220).optional(), isActive: z.boolean().optional(), weightGrams: nonnegativePostgresInt.nullable().optional(),
  priceMinor: integerString.optional(), costMinor: integerString.nullable().optional(), compareAtPriceMinor: integerString.nullable().optional(), metadataJson: metadata,
  optionValueIds: optionIds.optional(),
}).strict().refine((value) => Object.keys(value).length > 0, "At least one variant field is required"), params: z.object({ productId: uuid, variantId: uuid }).strict(), query: z.object({}).strict() }).strict();
export const updateStockSchema = z.object({ body: z.object({ operation: z.enum(["SET", "INCREMENT", "DECREMENT"]), quantity: nonnegativePostgresInt }).strict(), params: z.object({ productId: uuid, variantId: uuid }).strict(), query: z.object({}).strict() }).strict();
export type ListVariantsQuery = z.infer<typeof listVariantsSchema>["query"]; export type CreateVariantInput = z.infer<typeof createVariantSchema>["body"]; export type UpdateVariantInput = z.infer<typeof updateVariantSchema>["body"]; export type UpdateStockInput = z.infer<typeof updateStockSchema>["body"];
