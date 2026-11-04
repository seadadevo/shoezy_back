import { z } from "zod";
import { nonnegativePostgresInt } from "../../common/validation/postgres-int";
import { httpUrlSchema } from "../../common/validation/http-url";

const uuid = z.string().uuid();
const emptyBody = z.preprocess((value) => value ?? {}, z.object({}).strict());
const emptyQuery = z.object({}).strict();
const nullableAltText = z.string().trim().max(255).nullable().optional();
const nullableVariantId = uuid.nullable().optional();

export const listProductMediaSchema = z.object({
  body: emptyBody,
  params: z.object({ productId: uuid }).strict(),
  query: z.object({
    page: z.coerce.number().int().positive().default(1),
    limit: z.coerce.number().int().positive().max(100).default(20),
  }).strict(),
}).strict();

export const createProductMediaSchema = z.object({
  body: z.object({
    variantId: nullableVariantId,
    type: z.enum(["IMAGE", "VIDEO"]).optional(),
    mediaType: z.enum(["IMAGE", "VIDEO"]).optional(),
    mimeType: z.string().trim().max(100).nullable().optional(),
    url: httpUrlSchema,
    altText: nullableAltText,
    position: nonnegativePostgresInt.optional(),
    isPrimary: z.boolean().optional(),
  }).strict()
    .refine((data) => Boolean(data.type || data.mediaType), "Either type or mediaType is required")
    .refine(
      (data) => !((data.type === "VIDEO" || data.mediaType === "VIDEO") && data.isPrimary === true),
      { message: "Video media cannot be used as the product primary cover", path: ["isPrimary"] },
    ),
  params: z.object({ productId: uuid }).strict(),
  query: emptyQuery,
}).strict();

export const updateProductMediaSchema = z.object({
  body: z.object({
    variantId: nullableVariantId,
    type: z.enum(["IMAGE", "VIDEO"]).optional(),
    mediaType: z.enum(["IMAGE", "VIDEO"]).optional(),
    mimeType: z.string().trim().max(100).nullable().optional(),
    url: httpUrlSchema.optional(),
    altText: nullableAltText,
    position: nonnegativePostgresInt.optional(),
    isPrimary: z.boolean().optional(),
  }).strict()
    .refine((value) => Object.keys(value).length > 0, "At least one media field is required")
    .refine(
      (data) => !((data.type === "VIDEO" || data.mediaType === "VIDEO") && data.isPrimary === true),
      { message: "Video media cannot be used as the product primary cover", path: ["isPrimary"] },
    ),
  params: z.object({ productId: uuid, mediaId: uuid }).strict(),
  query: emptyQuery,
}).strict();

export const deleteProductMediaSchema = z.object({
  body: emptyBody,
  params: z.object({ productId: uuid, mediaId: uuid }).strict(),
  query: emptyQuery,
}).strict();

export type ListProductMediaQuery = z.infer<typeof listProductMediaSchema>["query"];
export type CreateProductMediaInput = z.infer<typeof createProductMediaSchema>["body"];
export type UpdateProductMediaInput = z.infer<typeof updateProductMediaSchema>["body"];
