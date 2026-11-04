import { z } from "zod";

const BIGINT_MAX = 9_223_372_036_854_775_807n;
const INTEGER_PATTERN = /^(?:0|[1-9]\d*)$/;
const integerString = z.string().regex(INTEGER_PATTERN).refine(
  (value) => !INTEGER_PATTERN.test(value) || BigInt(value) <= BIGINT_MAX,
  "Exceeds signed BIGINT range",
);
const emptyBody = z.preprocess((value) => value ?? {}, z.object({}).strict());
const pagination = {
  page: z.coerce.number().int().positive().default(1),
  limit: z.coerce.number().int().positive().max(100).default(20),
};
const queryBoolean = z.preprocess((value) => {
  if (value === "true") return true;
  if (value === "false") return false;
  return value;
}, z.boolean());

export const listCatalogProductsSchema = z.object({
  body: emptyBody,
  params: z.object({}).strict(),
  query: z.object({
    ...pagination,
    search: z.string().trim().min(1).max(100).optional(),
    brand: z.string().trim().min(1).max(180).optional(),
    category: z.string().trim().min(1).max(180).optional(),
    collection: z.string().trim().min(1).max(180).optional(),
    gender: z.string().trim().min(1).max(50).optional(),
    season: z.string().trim().min(1).max(50).optional(),
    size: z.string().trim().min(1).max(100).optional(),
    color: z.string().trim().min(1).max(100).optional(),
    minPriceMinor: integerString.optional(),
    maxPriceMinor: integerString.optional(),
    inStock: queryBoolean.optional(),
    groupByModel: queryBoolean.optional(),
    sort: z.enum(["newest", "nameAsc", "nameDesc", "basePriceAsc", "basePriceDesc"]).default("newest"),
  }).strict().refine(
    (value) => value.minPriceMinor === undefined || value.maxPriceMinor === undefined
      || !INTEGER_PATTERN.test(value.minPriceMinor) || !INTEGER_PATTERN.test(value.maxPriceMinor)
      || BigInt(value.minPriceMinor) <= BigInt(value.maxPriceMinor),
    "Minimum price must not exceed maximum price",
  ),
}).strict();

export const catalogProductSlugSchema = z.object({
  body: emptyBody,
  params: z.object({ slug: z.string().trim().min(1).max(250) }).strict(),
  query: z.object({}).strict(),
}).strict();

export const relatedProductsSchema = z.object({
  body: emptyBody,
  params: z.object({ slug: z.string().trim().min(1).max(250) }).strict(),
  query: z.object({ limit: z.coerce.number().int().positive().max(20).default(8) }).strict(),
}).strict();

export const listCatalogEntitiesSchema = z.object({
  body: emptyBody,
  params: z.object({}).strict(),
  query: z.object({ ...pagination }).strict(),
}).strict();

export const listCatalogPromotionsSchema = z.object({
  body: emptyBody,
  params: z.object({}).strict(),
  query: z.object({}).strict(),
}).strict();

export const catalogFiltersSchema = z.object({
  body: emptyBody,
  params: z.object({}).strict(),
  query: z.object({}).strict(),
}).strict();

export const catalogCollectionSchema = z.object({
  body: emptyBody,
  params: z.object({ slug: z.string().trim().min(1).max(180) }).strict(),
  query: z.object({ ...pagination }).strict(),
}).strict();

export const catalogSizeGuideSchema = z.object({
  body: emptyBody,
  params: z.object({ sizeGuideId: z.string().uuid() }).strict(),
  query: z.object({ ...pagination }).strict(),
}).strict();

export type ListCatalogProductsQuery = z.infer<typeof listCatalogProductsSchema>["query"];
export type ListCatalogEntitiesQuery = z.infer<typeof listCatalogEntitiesSchema>["query"];
export type CatalogCollectionQuery = z.infer<typeof catalogCollectionSchema>["query"];
export type CatalogSizeGuideQuery = z.infer<typeof catalogSizeGuideSchema>["query"];
export type RelatedProductsQuery = z.infer<typeof relatedProductsSchema>["query"];
