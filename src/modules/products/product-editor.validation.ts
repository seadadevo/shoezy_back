import { z } from "zod";
import { nonnegativePostgresInt } from "../../common/validation/postgres-int";
import { httpUrlSchema } from "../../common/validation/http-url";
import { createOptionSchema, createOptionValueSchema } from "./product-options.validation";
import { createVariantSchema } from "../variants/variants.validation";
import { productCreateBody, productUpdateBody } from "./products.validation";

const uuid = z.string().uuid();
const key = z.string().trim().min(1).max(100).regex(/^[A-Za-z0-9_-]+$/);
const categorySelection = z.object({ categoryIds: z.array(uuid).max(500).refine((ids) => new Set(ids).size === ids.length), primaryCategoryId: uuid.nullable() }).strict().refine((v) => v.primaryCategoryId === null || v.categoryIds.includes(v.primaryCategoryId), "Primary category must be included");
const optionFields = createOptionSchema.shape.body;
const valueFields = createOptionValueSchema.shape.body;
const variantFields = createVariantSchema.shape.body.omit({ optionValueIds: true });
const optionCreate = optionFields.extend({ clientKey: key, values: z.array(valueFields.extend({ clientKey: key })).max(100) });
const variantCreate = variantFields.extend({ clientKey: key, optionValueClientKeys: z.array(key).max(10) });
const mediaFields = z.object({ fileIndex: nonnegativePostgresInt.optional(), url: httpUrlSchema.optional(), variantClientKey: key.nullable().optional(), variantId: uuid.nullable().optional(), position: nonnegativePostgresInt.optional(), isPrimary: z.boolean().optional(), altText: z.string().trim().max(255).nullable().optional() }).strict().refine((v) => (v.fileIndex === undefined) !== (v.url === undefined), "Exactly one of fileIndex or url is required");

const createBody = z.object({
  product: productCreateBody,
  categories: categorySelection.optional(),
  options: z.array(optionCreate).max(10).optional(),
  variants: z.array(variantCreate).max(500).optional(),
  media: z.array(mediaFields).max(12).optional(),
}).strict().superRefine((value, context) => {
  const optionKeys = new Set<string>(), optionNames = new Set<string>(), valueKeys = new Set<string>(), variantKeys = new Set<string>(), skus = new Set<string>(), barcodes = new Set<string>();
  value.options?.forEach((option, index) => {
    if (optionKeys.has(option.clientKey)) context.addIssue({ code: "custom", path: ["options", index, "clientKey"], message: "Duplicate option key" });
    optionKeys.add(option.clientKey);
    if (optionNames.has(option.name.toLowerCase())) context.addIssue({ code: "custom", path: ["options", index, "name"], message: "Duplicate option name" });
    optionNames.add(option.name.toLowerCase());
    option.values.forEach((entry, valueIndex) => { if (valueKeys.has(entry.clientKey)) context.addIssue({ code: "custom", path: ["options", index, "values", valueIndex, "clientKey"], message: "Duplicate value key" }); valueKeys.add(entry.clientKey); });
  });
  value.variants?.forEach((variant, index) => {
    if (variantKeys.has(variant.clientKey)) context.addIssue({ code: "custom", path: ["variants", index, "clientKey"], message: "Duplicate variant key" });
    variantKeys.add(variant.clientKey);
    if (skus.has(variant.sku)) context.addIssue({ code: "custom", path: ["variants", index, "sku"], message: "Duplicate SKU" });
    skus.add(variant.sku);
    if (variant.barcode && barcodes.has(variant.barcode)) context.addIssue({ code: "custom", path: ["variants", index, "barcode"], message: "Duplicate barcode" });
    if (variant.barcode) barcodes.add(variant.barcode);
    if (new Set(variant.optionValueClientKeys).size !== variant.optionValueClientKeys.length || variant.optionValueClientKeys.some((keyValue) => !valueKeys.has(keyValue))) context.addIssue({ code: "custom", path: ["variants", index, "optionValueClientKeys"], message: "Invalid option value mapping" });
  });
  value.media?.forEach((media, index) => { if (media.variantClientKey && !variantKeys.has(media.variantClientKey)) context.addIssue({ code: "custom", path: ["media", index, "variantClientKey"], message: "Unknown variant key" }); });
  if (value.media?.filter((media) => media.isPrimary).length && value.media.filter((media) => media.isPrimary).length > 1) context.addIssue({ code: "custom", path: ["media"], message: "Only one primary image is allowed" });
});

const valueUpdate = valueFields.partial().extend({ id: uuid.optional(), clientKey: key.optional() }).refine((v) => Boolean(v.id || v.clientKey), "An ID or clientKey is required");
const optionUpdate = optionFields.partial().extend({ id: uuid.optional(), clientKey: key.optional(), values: z.object({ upsert: z.array(valueUpdate).max(100), deleteIds: z.array(uuid).max(100).default([]) }).strict().optional() }).refine((v) => Boolean(v.id || v.clientKey), "An ID or clientKey is required");
const variantUpdate = variantFields.partial().extend({ id: uuid.optional(), clientKey: key.optional(), stockQuantity: nonnegativePostgresInt.optional(), optionValueIds: z.array(uuid).max(10).optional(), optionValueClientKeys: z.array(key).max(10).optional() }).refine((v) => Boolean(v.id || v.clientKey), "An ID or clientKey is required");
const mediaExisting = z.object({ id: uuid, variantId: uuid.nullable().optional(), position: nonnegativePostgresInt.optional(), isPrimary: z.boolean().optional(), altText: z.string().trim().max(255).nullable().optional() }).strict();
const updateBody = z.object({
  product: productUpdateBody.optional(), categories: categorySelection.optional(),
  options: z.object({ upsert: z.array(optionUpdate).max(10), deleteIds: z.array(uuid).max(10).default([]) }).strict().optional(),
  variants: z.object({ upsert: z.array(variantUpdate).max(500), deleteIds: z.array(uuid).max(500).default([]) }).strict().optional(),
  media: z.object({ existing: z.array(mediaExisting).max(100).default([]), new: z.array(mediaFields).max(12).default([]), deleteIds: z.array(uuid).max(100).default([]) }).strict().optional(),
}).strict().refine((value) => Object.keys(value).length > 0, "At least one section is required").superRefine((value, context) => {
  const primary = [...(value.media?.existing ?? []), ...(value.media?.new ?? [])].filter((entry) => entry.isPrimary);
  if (primary.length > 1) context.addIssue({ code: "custom", path: ["media"], message: "Only one primary image may be selected" });
  const check = (ids: string[], path: (string | number)[]) => { if (new Set(ids).size !== ids.length) context.addIssue({ code: "custom", path, message: "Duplicate IDs" }); };
  check(value.options?.deleteIds ?? [], ["options", "deleteIds"]);
  check(value.variants?.deleteIds ?? [], ["variants", "deleteIds"]);
  check(value.media?.deleteIds ?? [], ["media", "deleteIds"]);
  check((value.media?.existing ?? []).map((entry) => entry.id), ["media", "existing"]);
  for (const [section, changes] of [["options", value.options], ["variants", value.variants]] as const) {
    if (!changes) continue;
    const upsertIds = changes.upsert.map((item) => item.id).filter((id): id is string => Boolean(id));
    check(upsertIds, [section, "upsert"]);
    if (upsertIds.some((id) => changes.deleteIds.includes(id))) context.addIssue({ code: "custom", path: [section, "deleteIds"], message: "Cannot update and delete the same item" });
  }
  if (value.media?.existing.some((entry) => value.media!.deleteIds.includes(entry.id))) context.addIssue({ code: "custom", path: ["media", "deleteIds"], message: "Cannot update and delete the same media" });
});

export const createProductEditorSchema = z.object({ body: createBody, params: z.object({}).strict(), query: z.object({}).strict() }).strict();
export const updateProductEditorSchema = z.object({ body: updateBody, params: z.object({ productId: uuid }).strict(), query: z.object({}).strict() }).strict();
export const productFormContextSchema = z.object({ body: z.preprocess((value) => value ?? {}, z.object({}).strict()), params: z.object({}).strict(), query: z.object({}).strict() }).strict();
export type ProductEditorCreateInput = z.infer<typeof createBody>;
export type ProductEditorUpdateInput = z.infer<typeof updateBody>;
