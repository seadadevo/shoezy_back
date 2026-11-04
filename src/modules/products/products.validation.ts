import { z } from "zod";
const uuid = z.string().uuid(); const emptyBody = z.preprocess((v) => v ?? {}, z.object({}).strict()); const emptyQuery = z.object({}).strict();
const nullableString = (max: number) => z.string().trim().min(1).max(max).nullable().optional();
const decimalMoney = z.string().trim().regex(/^(?:0|[1-9]\d{0,7})(?:\.\d{1,2})?$/, "Must be a nonnegative decimal string with at most two fractional digits");
const queryBoolean = z.preprocess((v) => v === "true" ? true : v === "false" ? false : v, z.boolean());
const productTranslation = z.object({
  name: z.string().trim().min(1).max(220), shortDescription: nullableString(500), description: z.string().trim().max(50_000).nullable().optional(), material: nullableString(150), seoTitle: nullableString(255), seoDescription: nullableString(500),
}).strict();
const createTranslations = z.object({ ar: productTranslation, en: productTranslation }).strict();
const updateTranslations = z.object({ ar: productTranslation.optional(), en: productTranslation.optional() }).strict().refine((value) => Boolean(value.ar || value.en), "At least one translation is required");
const fields = {
  brandId: uuid, sizeGuideId: uuid.nullable().optional(), name: z.string().trim().min(1).max(220),
  slug: z.string().trim().min(1).max(250).optional(), skuPrefix: nullableString(80),
  shortDescription: nullableString(500), basePrice: decimalMoney, compareAtPrice: decimalMoney.nullable().optional(),
  description: z.string().trim().max(50_000).nullable().optional(), material: nullableString(150),
  gender: nullableString(50), season: nullableString(50), seoTitle: nullableString(255), seoDescription: nullableString(500),
  colorName: nullableString(100),
  colorHex: z.string().trim().regex(/^#(?:[0-9a-fA-F]{3}|[0-9a-fA-F]{6})$/, "Invalid hex color").nullable().optional(),
  isFeatured: z.boolean().default(false).optional(),
  priority: z.coerce.number().int().min(0).max(1000).default(0).optional(),
  translations: createTranslations.optional(),
};
export const listProductsSchema = z.object({ body: emptyBody, params: z.object({}).strict(), query: z.object({
  page: z.coerce.number().int().positive().default(1), limit: z.coerce.number().int().positive().max(100).default(20),
  search: z.string().trim().min(1).max(100).optional(), status: z.enum(["DRAFT", "ACTIVE"]).optional(),
  brandId: uuid.optional(), categoryId: uuid.optional(), includeDeleted: queryBoolean.default(false),
  sortBy: z.enum(["name", "slug", "basePrice", "status", "priority", "isFeatured", "createdAt", "updatedAt"]).default("createdAt"),
  sortOrder: z.enum(["asc", "desc"]).default("desc"),
}).strict() }).strict();
export const productIdSchema = z.object({ body: emptyBody, params: z.object({ productId: uuid }).strict(), query: emptyQuery }).strict();
export const productCreateBody = z.object({
  ...fields,
  linkToProductId: uuid.optional(),
  unlinkFromGroup: z.boolean().optional(),
  status: z.literal("DRAFT").optional(),
}).strict();
export const createProductSchema = z.object({ body: productCreateBody, params: z.object({}).strict(), query: emptyQuery }).strict();
export const productUpdateBody = z.object({
  brandId: fields.brandId.optional(), sizeGuideId: fields.sizeGuideId, name: fields.name.optional(), slug: fields.slug,
  skuPrefix: fields.skuPrefix, shortDescription: fields.shortDescription, basePrice: fields.basePrice.optional(),
  compareAtPrice: fields.compareAtPrice, description: fields.description, material: fields.material, gender: fields.gender,
  season: fields.season, status: z.enum(["DRAFT", "ACTIVE"]).optional(), seoTitle: fields.seoTitle, seoDescription: fields.seoDescription,
  colorName: fields.colorName, colorHex: fields.colorHex,
  isFeatured: z.boolean().optional(), priority: z.coerce.number().int().min(0).max(1000).optional(),
  linkToProductId: uuid.nullable().optional(),
  unlinkFromGroup: z.boolean().optional(),
  translations: updateTranslations.optional(),
}).strict();
export const updateProductSchema = z.object({ body: productUpdateBody.refine((value) => Object.keys(value).length > 0, "At least one product field is required"), params: z.object({ productId: uuid }).strict(), query: emptyQuery }).strict();
export const replaceProductCategoriesSchema = z.object({ body: z.object({
  categoryIds: z.array(uuid).max(500).refine((ids) => new Set(ids).size === ids.length, "Category IDs must be unique"),
  primaryCategoryId: uuid.nullable(),
}).strict().refine((value) => value.primaryCategoryId === null || value.categoryIds.includes(value.primaryCategoryId), "Primary category must be included in categoryIds"), params: z.object({ productId: uuid }).strict(), query: emptyQuery }).strict();
export type ListProductsQuery = z.infer<typeof listProductsSchema>["query"];
export type CreateProductInput = z.infer<typeof createProductSchema>["body"];
export type UpdateProductInput = z.infer<typeof updateProductSchema>["body"];
export type ReplaceProductCategoriesInput = z.infer<typeof replaceProductCategoriesSchema>["body"];

export const searchModelsSchema = z.object({ body: emptyBody, params: z.object({}).strict(), query: z.object({ q: z.string().trim().min(1).max(100).optional(), excludeProductId: uuid.optional() }).strict() }).strict();
export type SearchModelsQuery = z.infer<typeof searchModelsSchema>["query"];
