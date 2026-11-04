import { z } from "zod";
import { nonnegativePostgresInt } from "../../common/validation/postgres-int";
import { httpUrlSchema } from "../../common/validation/http-url";

const uuid = z.string().uuid();
const emptyBody = z.preprocess((value) => value ?? {}, z.object({}).strict());
const emptyQuery = z.object({}).strict();
const name = z.string().trim().min(1).max(150);
const slug = z.string().trim().min(1).max(180);
const nullableDescription = z.string().trim().max(50_000).nullable().optional();
const nullableImageUrl = httpUrlSchema.nullable().optional();
const nullableDate = z.string().datetime({ offset: true }).nullable().optional();
const queryBoolean = z.preprocess((value) => {
  if (value === "true") return true;
  if (value === "false") return false;
  return value;
}, z.boolean());
const collectionProducts = z.array(z.object({ productId: uuid, position: nonnegativePostgresInt }).strict()).max(1_000).refine(
  (products) => new Set(products.map((product) => product.productId)).size === products.length, "Product IDs must be unique",
);
const translation = z.object({ name, description: nullableDescription }).strict();
const createTranslations = z.object({ ar: translation, en: translation }).strict();
const updateTranslations = z.object({ ar: translation.optional(), en: translation.optional() }).strict().refine((value) => Boolean(value.ar || value.en), "At least one translation is required");

export const listCollectionsSchema = z.object({
  body: emptyBody,
  params: z.object({}).strict(),
  query: z.object({
    page: z.coerce.number().int().positive().default(1),
    limit: z.coerce.number().int().positive().max(100).default(20),
    search: z.string().trim().min(1).max(100).optional(),
    isActive: queryBoolean.optional(),
    sortBy: z.enum(["name", "slug", "startsAt", "endsAt", "createdAt", "updatedAt"]).default("createdAt"),
    sortOrder: z.enum(["asc", "desc"]).default("desc"),
  }).strict(),
}).strict();

export const collectionIdSchema = z.object({
  body: emptyBody,
  params: z.object({ collectionId: uuid }).strict(),
  query: emptyQuery,
}).strict();

export const createCollectionSchema = z.object({
  body: z.object({
    name,
    slug: slug.optional(),
    description: nullableDescription,
    imageUrl: nullableImageUrl,
    isActive: z.boolean().optional(),
    startsAt: nullableDate,
    endsAt: nullableDate,
    products: collectionProducts.optional(),
    translations: createTranslations.optional(),
  }).strict(),
  params: z.object({}).strict(),
  query: emptyQuery,
}).strict();

export const updateCollectionSchema = z.object({
  body: z.object({
    name: name.optional(),
    slug: slug.optional(),
    description: nullableDescription,
    imageUrl: nullableImageUrl,
    removeVideo: z.boolean().optional(),
    isActive: z.boolean().optional(),
    startsAt: nullableDate,
    endsAt: nullableDate,
    products: collectionProducts.optional(),
    translations: updateTranslations.optional(),
  }).strict().refine((value) => Object.keys(value).length > 0, "At least one collection field is required"),
  params: z.object({ collectionId: uuid }).strict(),
  query: emptyQuery,
}).strict();

export const replaceCollectionProductsSchema = z.object({
  body: z.object({
    products: collectionProducts,
  }).strict(),
  params: z.object({ collectionId: uuid }).strict(),
  query: emptyQuery,
}).strict();

export type ListCollectionsQuery = z.infer<typeof listCollectionsSchema>["query"];
export type CreateCollectionInput = z.infer<typeof createCollectionSchema>["body"];
export type UpdateCollectionInput = z.infer<typeof updateCollectionSchema>["body"];
export type ReplaceCollectionProductsInput = z.infer<typeof replaceCollectionProductsSchema>["body"];
