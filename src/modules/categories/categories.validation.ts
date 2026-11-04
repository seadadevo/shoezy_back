import { z } from "zod";
import { nonnegativePostgresInt } from "../../common/validation/postgres-int";
import { httpUrlSchema } from "../../common/validation/http-url";

const uuid = z.string().uuid();
const emptyBody = z.preprocess((value) => value ?? {}, z.object({}).strict());
const emptyQuery = z.object({}).strict();
const name = z.string().trim().min(1).max(150);
const slug = z.string().trim().min(1).max(180);
const text = z.string().trim().max(10_000).nullable().optional();
const imageUrl = httpUrlSchema.nullable().optional();
const queryBoolean = z.preprocess((value) => value === "true" ? true : value === "false" ? false : value, z.boolean());
const translation = z.object({ name, description: text }).strict();
const createTranslations = z.object({ ar: translation, en: translation }).strict();
const updateTranslations = z.object({ ar: translation.optional(), en: translation.optional() }).strict().refine((value) => Boolean(value.ar || value.en), "At least one translation is required");

export const listCategoriesSchema = z.object({ body: emptyBody, params: z.object({}).strict(), query: z.object({
  page: z.coerce.number().int().positive().default(1),
  limit: z.coerce.number().int().positive().max(100).default(20),
  search: z.string().trim().min(1).max(100).optional(),
  isActive: queryBoolean.optional(),
  parentId: uuid.optional(),
  sortBy: z.enum(["name", "slug", "sortOrder", "createdAt", "updatedAt"]).default("sortOrder"),
  sortOrder: z.enum(["asc", "desc"]).default("asc"),
}).strict() }).strict();
export const categoryTreeSchema = z.object({ body: emptyBody, params: z.object({}).strict(), query: emptyQuery }).strict();
export const categoryIdSchema = z.object({ body: emptyBody, params: z.object({ categoryId: uuid }).strict(), query: emptyQuery }).strict();
export const createCategorySchema = z.object({ body: z.object({
  parentId: uuid.nullable().optional(), name, slug: slug.optional(), description: text,
  imageUrl, sortOrder: nonnegativePostgresInt.optional(), isActive: z.boolean().optional(),
  translations: createTranslations.optional(),
}).strict(), params: z.object({}).strict(), query: emptyQuery }).strict();
export const updateCategorySchema = z.object({ body: z.object({
  parentId: uuid.nullable().optional(), name: name.optional(), slug: slug.optional(), description: text,
  imageUrl, removeVideo: z.boolean().optional(), sortOrder: nonnegativePostgresInt.optional(), isActive: z.boolean().optional(),
  translations: updateTranslations.optional(),
}).strict().refine((value) => Object.keys(value).length > 0, "At least one category field is required"), params: z.object({ categoryId: uuid }).strict(), query: emptyQuery }).strict();

export type ListCategoriesQuery = z.infer<typeof listCategoriesSchema>["query"];
export type CreateCategoryInput = z.infer<typeof createCategorySchema>["body"];
export type UpdateCategoryInput = z.infer<typeof updateCategorySchema>["body"];
