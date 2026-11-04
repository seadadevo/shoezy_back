import { z } from "zod";
import { nonnegativePostgresInt, POSTGRES_INT_MAX } from "../../common/validation/postgres-int";
import { httpUrlSchema } from "../../common/validation/http-url";
import { ctaUrlSchema } from "../homepage/homepage.validation";

const BIGINT_MAX = 9_223_372_036_854_775_807n;
const INTEGER_PATTERN = /^(?:0|[1-9]\d*)$/;
const integerString = z.string().regex(INTEGER_PATTERN).refine(
  (value) => !INTEGER_PATTERN.test(value) || BigInt(value) <= BIGINT_MAX,
  "Exceeds signed BIGINT range",
);
const positiveIntegerString = integerString.refine((value) => BigInt(value) > 0n, "Must be greater than zero");
const uuid = z.string().uuid();
const emptyBody = z.preprocess((value) => value ?? {}, z.object({}).strict());
const emptyQuery = z.object({}).strict();
const queryBoolean = z.preprocess((value) => value === "true" ? true : value === "false" ? false : value, z.boolean());
const nullableMoney = integerString.nullable().optional();
const nullableLimit = z.number().int().positive().max(POSTGRES_INT_MAX).nullable().optional();
const nullableCurrency = z.string().trim().regex(/^[A-Za-z]{3}$/).transform((value) => value.toUpperCase()).nullable().optional();
const nullableCode = z.string().trim().min(1).max(80).transform((value) => value.toUpperCase()).nullable().optional();
const target = z.union([
  z.object({ productId: uuid }).strict(),
  z.object({ variantId: uuid }).strict(),
  z.object({ categoryId: uuid }).strict(),
  z.object({ collectionId: uuid }).strict(),
]);
const targets = z.array(target).max(1_000).refine((items) => {
  const keys = items.map((item) => "productId" in item ? `p:${item.productId}` : "variantId" in item ? `v:${item.variantId}` : "categoryId" in item ? `c:${item.categoryId}` : `l:${item.collectionId}`);
  return new Set(keys).size === keys.length;
}, "Discount targets must be unique");

const commonFields = {
  name: z.string().trim().min(1).max(150),
  description: z.string().trim().max(50_000).nullable().optional(),
  imageUrl: httpUrlSchema.nullable().optional(),
  showOnStorefront: z.boolean().optional(),
  sortOrder: nonnegativePostgresInt.optional(),
  ctaUrl: ctaUrlSchema.nullable().optional(),
  code: nullableCode,
  type: z.enum(["PERCENTAGE", "FIXED_AMOUNT", "FREE_SHIPPING"]),
  scope: z.enum(["ORDER", "PRODUCT", "VARIANT", "CATEGORY", "COLLECTION", "CATALOG"]),
  priority: nonnegativePostgresInt,
  value: integerString,
  currency: nullableCurrency,
  minOrderMinor: nullableMoney,
  maxDiscountMinor: nullableMoney,
  usageLimit: nullableLimit,
  perCustomerLimit: nullableLimit,
  startsAt: z.string().datetime({ offset: true }),
  endsAt: z.string().datetime({ offset: true }).nullable().optional(),
  isActive: z.boolean().optional(),
  combinable: z.boolean().optional(),
};
const translation = z.object({ name: commonFields.name, description: commonFields.description }).strict();
const createTranslations = z.object({ ar: translation, en: translation }).strict();
const updateTranslations = z.object({ ar: translation.optional(), en: translation.optional() }).strict().refine((value) => Boolean(value.ar || value.en), "At least one translation is required");

export const listDiscountsSchema = z.object({
  body: emptyBody,
  params: z.object({}).strict(),
  query: z.object({
    page: z.coerce.number().int().positive().default(1),
    limit: z.coerce.number().int().positive().max(100).default(20),
    search: z.string().trim().min(1).max(100).optional(),
    isActive: queryBoolean.optional(),
    type: z.enum(["PERCENTAGE", "FIXED_AMOUNT", "FREE_SHIPPING"]).optional(),
    scope: z.enum(["ORDER", "PRODUCT", "VARIANT", "CATEGORY", "COLLECTION", "CATALOG"]).optional(),
    sortBy: z.enum(["priority", "name", "startsAt", "endsAt", "createdAt", "updatedAt"]).default("priority"),
    sortOrder: z.enum(["asc", "desc"]).default("asc"),
  }).strict(),
}).strict();

export const discountIdSchema = z.object({ body: emptyBody, params: z.object({ discountId: uuid }).strict(), query: emptyQuery }).strict();

export const createDiscountSchema = z.object({
  body: z.object({ ...commonFields, targets, translations: createTranslations.optional() }).strict(),
  params: z.object({}).strict(),
  query: emptyQuery,
}).strict();

export const updateDiscountSchema = z.object({
  body: z.object({
    name: commonFields.name.optional(),
    description: commonFields.description,
    imageUrl: commonFields.imageUrl,
    showOnStorefront: commonFields.showOnStorefront,
    sortOrder: commonFields.sortOrder,
    ctaUrl: commonFields.ctaUrl,
    code: nullableCode,
    type: commonFields.type.optional(),
    scope: commonFields.scope.optional(),
    priority: commonFields.priority.optional(),
    value: commonFields.value.optional(),
    currency: nullableCurrency,
    minOrderMinor: nullableMoney,
    maxDiscountMinor: nullableMoney,
    usageLimit: nullableLimit,
    perCustomerLimit: nullableLimit,
    startsAt: commonFields.startsAt.optional(),
    endsAt: commonFields.endsAt,
    isActive: z.boolean().optional(),
    combinable: z.boolean().optional(),
    targets: targets.optional(),
    translations: updateTranslations.optional(),
  }).strict().refine((value) => Object.keys(value).length > 0, "At least one discount field is required"),
  params: z.object({ discountId: uuid }).strict(),
  query: emptyQuery,
}).strict();

export const replaceDiscountTargetsSchema = z.object({
  body: z.object({ targets }).strict(),
  params: z.object({ discountId: uuid }).strict(),
  query: emptyQuery,
}).strict();
export const discountActionSchema = discountIdSchema;

export type DiscountTargetInput = z.infer<typeof target>;
export type ListDiscountsQuery = z.infer<typeof listDiscountsSchema>["query"];
export type CreateDiscountInput = z.infer<typeof createDiscountSchema>["body"];
export type UpdateDiscountInput = z.infer<typeof updateDiscountSchema>["body"];
export type ReplaceDiscountTargetsInput = z.infer<typeof replaceDiscountTargetsSchema>["body"];
export { integerString as discountMoneyString, positiveIntegerString as positiveDiscountMoneyString };
