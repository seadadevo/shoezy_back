import { z } from "zod";
import { httpUrlSchema } from "../../common/validation/http-url";

const emptyBody = z.preprocess((value) => value ?? {}, z.object({}).strict());
const emptyQuery = z.object({}).strict();
const uuid = z.string().uuid();
const name = z.string().trim().min(1).max(150);
const slug = z.string().trim().min(1).max(180);
const nullableText = z.string().trim().max(10_000).nullable().optional();
const nullableUrl = httpUrlSchema.nullable().optional();
const translation = z.object({ name, description: nullableText }).strict();
const createTranslations = z.object({ ar: translation, en: translation }).strict();
const updateTranslations = z.object({ ar: translation.optional(), en: translation.optional() }).strict().refine((value) => Boolean(value.ar || value.en), "At least one translation is required");
const queryBoolean = z.preprocess((value) => {
  if (value === "true") return true;
  if (value === "false") return false;
  return value;
}, z.boolean());

export const listBrandsSchema = z.object({
  body: emptyBody,
  params: z.object({}).strict(),
  query: z.object({
    page: z.coerce.number().int().positive().default(1),
    limit: z.coerce.number().int().positive().max(100).default(20),
    search: z.string().trim().min(1).max(100).optional(),
    isActive: queryBoolean.optional(),
    sortBy: z.enum(["name", "slug", "createdAt", "updatedAt"]).default("createdAt"),
    sortOrder: z.enum(["asc", "desc"]).default("desc"),
  }).strict(),
}).strict();

export const brandIdSchema = z.object({
  body: emptyBody,
  params: z.object({ brandId: uuid }).strict(),
  query: emptyQuery,
}).strict();

export const createBrandSchema = z.object({
  body: z.object({
    name,
    slug: slug.optional(),
    description: nullableText,
    logoUrl: nullableUrl,
    showcaseImageUrl: nullableUrl,
    isActive: z.boolean().optional(),
    translations: createTranslations.optional(),
  }).strict(),
  params: z.object({}).strict(),
  query: emptyQuery,
}).strict();

export const updateBrandSchema = z.object({
  body: z.object({
    name: name.optional(),
    slug: slug.optional(),
    description: nullableText,
    logoUrl: nullableUrl,
    showcaseImageUrl: nullableUrl,
    removeShowcaseImage: z.boolean().optional(),
    isActive: z.boolean().optional(),
    translations: updateTranslations.optional(),
  }).strict().refine((value) => Object.keys(value).length > 0, "At least one brand field is required"),
  params: z.object({ brandId: uuid }).strict(),
  query: emptyQuery,
}).strict();

export type ListBrandsQuery = z.infer<typeof listBrandsSchema>["query"];
export type CreateBrandInput = z.infer<typeof createBrandSchema>["body"];
export type UpdateBrandInput = z.infer<typeof updateBrandSchema>["body"];
