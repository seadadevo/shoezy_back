import { z } from "zod";
import { isHttpUrl } from "../../common/validation/http-url";
import { nonnegativePostgresInt } from "../../common/validation/postgres-int";

const uuid = z.string().uuid();
const emptyBody = z.preprocess((value) => value ?? {}, z.object({}).strict());
const emptyQuery = z.object({}).strict();

export function isValidCtaUrl(value: string): boolean {
  if (!value || value.length === 0 || value.length > 500) return false;
  const trimmed = value.trim();
  // Safe relative paths starting with /
  if (trimmed.startsWith("/")) {
    // Disallow protocol-relative // or backslash /\
    if (trimmed.startsWith("//") || trimmed.startsWith("/\\")) return false;
    try {
      // Validate parseability as path
      const parsed = new URL(trimmed, "http://localhost");
      return parsed.pathname.startsWith("/");
    } catch {
      return false;
    }
  }
  // External URLs must be valid HTTP/HTTPS
  return isHttpUrl(trimmed);
}

export const ctaUrlSchema = z
  .string()
  .trim()
  .max(500)
  .refine(isValidCtaUrl, "CTA URL must be a valid relative path starting with / or an HTTP/HTTPS URL");

export const bannerPlacementSchema = z.enum([
  "HERO_SLIDER",
  "TOP_BAR",
  "MIDDLE_BANNER",
  "SIDE_BANNER",
  "PROMO_BANNER_1",
  "PROMO_BANNER_2",
]);

const translationFields = z
  .object({
    title: z.string().trim().min(1).max(255),
    subtitle: z.string().trim().max(255).nullable().optional(),
    description: z.string().trim().max(10_000).nullable().optional(),
    ctaLabel: z.string().trim().max(100).nullable().optional(),
  })
  .strict();

const createTranslationsSchema = z
  .object({
    en: translationFields,
    ar: translationFields.optional(),
  })
  .strict();

const updateTranslationsSchema = z
  .object({
    en: translationFields.optional(),
    ar: translationFields.optional(),
  })
  .strict()
  .refine(
    (value) => Boolean(value.en || value.ar),
    "At least one translation is required when updating translations",
  );

const isoDateString = z.string().datetime({ offset: true }).or(z.string().datetime());

const queryBoolean = z.preprocess((value) => {
  if (value === "true" || value === true) return true;
  if (value === "false" || value === false) return false;
  return value;
}, z.boolean().optional());

export const bannerIdSchema = z.object({
  body: emptyBody,
  params: z.object({ bannerId: uuid }).strict(),
  query: emptyQuery,
}).strict();

export const listPublicBannersSchema = z.object({
  body: emptyBody,
  params: z.object({}).strict(),
  query: z.object({
    placement: bannerPlacementSchema.optional(),
  }).strict(),
}).strict();

export const listAdminBannersSchema = z.object({
  body: emptyBody,
  params: z.object({}).strict(),
  query: z.object({
    page: z.coerce.number().int().positive().default(1),
    limit: z.coerce.number().int().positive().max(100).default(20),
    placement: bannerPlacementSchema.optional(),
    isActive: queryBoolean,
    search: z.string().trim().min(1).max(100).optional(),
  }).strict(),
}).strict();

export const createHomepageBannerSchema = z.object({
  body: z
    .object({
      placement: bannerPlacementSchema.default("HERO_SLIDER"),
      ctaUrl: ctaUrlSchema.nullable().optional(),
      desktopImageUrl: z.string().trim().max(500).nullable().optional(),
      mobileImageUrl: z.string().trim().max(500).nullable().optional(),
      backgroundColor: z.string().trim().max(50).nullable().optional(),
      textColor: z.string().trim().max(50).nullable().optional(),
      sortOrder: nonnegativePostgresInt.default(0),
      isActive: z.boolean().default(true),
      startsAt: isoDateString.nullable().optional(),
      endsAt: isoDateString.nullable().optional(),
      promotionId: uuid.nullable().optional(),
      translations: createTranslationsSchema,
    })
    .strict()
    .refine((data) => {
      if (data.startsAt && data.endsAt) {
        return new Date(data.endsAt).getTime() > new Date(data.startsAt).getTime();
      }
      return true;
    }, {
      message: "End date must be after start date",
      path: ["endsAt"],
    }),
  params: z.object({}).strict(),
  query: emptyQuery,
}).strict();

export const updateHomepageBannerSchema = z.object({
  body: z
    .object({
      placement: bannerPlacementSchema.optional(),
      ctaUrl: ctaUrlSchema.nullable().optional(),
      desktopImageUrl: z.string().trim().max(500).nullable().optional(),
      mobileImageUrl: z.string().trim().max(500).nullable().optional(),
      backgroundColor: z.string().trim().max(50).nullable().optional(),
      textColor: z.string().trim().max(50).nullable().optional(),
      removeDesktopVideo: z.boolean().optional(),
      removeMobileVideo: z.boolean().optional(),
      sortOrder: nonnegativePostgresInt.optional(),
      isActive: z.boolean().optional(),
      startsAt: isoDateString.nullable().optional(),
      endsAt: isoDateString.nullable().optional(),
      promotionId: uuid.nullable().optional(),
      translations: updateTranslationsSchema.optional(),
    })
    .strict()
    .refine((data) => {
      if (data.startsAt && data.endsAt) {
        return new Date(data.endsAt).getTime() > new Date(data.startsAt).getTime();
      }
      return true;
    }, {
      message: "End date must be after start date",
      path: ["endsAt"],
    })
    .refine(
      (data) => Object.keys(data).length > 0,
      "At least one field is required to update a banner",
    ),
  params: z.object({ bannerId: uuid }).strict(),
  query: emptyQuery,
}).strict();

export type ListPublicBannersQuery = z.infer<typeof listPublicBannersSchema>["query"];
export type ListAdminBannersQuery = z.infer<typeof listAdminBannersSchema>["query"];
export type CreateHomepageBannerInput = z.infer<typeof createHomepageBannerSchema>["body"];
export type UpdateHomepageBannerInput = z.infer<typeof updateHomepageBannerSchema>["body"];
