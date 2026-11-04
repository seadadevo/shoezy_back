import "dotenv/config";
import { z } from "zod";
import { httpUrlSchema, isHttpUrl } from "../common/validation/http-url";

const durationSchema = z
  .string()
  .regex(/^\d+[smhd]$/, "Duration must use s, m, h, or d units");
const booleanSchema = z.preprocess((value) => {
  if (value === "true") return true;
  if (value === "false") return false;
  return value;
}, z.boolean());
const optionalString = z.preprocess(
  (value) => (value === "" ? undefined : value),
  z.string().min(1).optional(),
);
const corsOriginsSchema = z.preprocess(
  (value) => typeof value === "string"
    ? value.split(",").map((origin) => origin.trim()).filter(Boolean)
    : value,
  z.array(httpUrlSchema).min(1),
);

function isLoopbackUrl(value: string): boolean {
  const hostname = new URL(value).hostname.replace(/^\[|\]$/g, "").toLowerCase();
  return hostname === "localhost"
    || hostname.endsWith(".localhost")
    || hostname === "::1"
    || /^127(?:\.\d{1,3}){3}$/.test(hostname);
}

export const envSchema = z
  .object({
  NODE_ENV: z.enum(["development", "test", "production"]).default("development"),
  PORT: z.coerce.number().int().positive().default(3000),
  TRUST_PROXY_HOPS: z.coerce.number().int().min(0).max(10).default(0),
  DATABASE_URL: z.string().min(1),
  JWT_ACCESS_SECRET: z.string().min(32),
  JWT_REFRESH_SECRET: z.string().min(32),
  JWT_ACCESS_EXPIRES_IN: durationSchema.default("15m"),
  JWT_REFRESH_EXPIRES_IN: durationSchema.default("30d"),
  JWT_ISSUER: z.string().min(1).default("shoe-store-api"),
  JWT_AUDIENCE: z.string().min(1).default("shoe-store-client"),
  BCRYPT_ROUNDS: z.coerce.number().int().min(10).max(14).default(12),
  AUTH_REQUIRE_EMAIL_VERIFICATION: booleanSchema.default(true),
  AUTH_VERIFICATION_TOKEN_EXPIRES_IN: durationSchema.default("24h"),
  AUTH_RESET_TOKEN_EXPIRES_IN: durationSchema.default("30m"),
  AUTH_REFRESH_COOKIE_NAME: z.string().min(1).default("shoe_refresh"),
  AUTH_COOKIE_SECURE: booleanSchema.default(false),
  AUTH_COOKIE_SAME_SITE: z.enum(["strict", "lax", "none"]).default("lax"),
  CORS_ORIGINS: corsOriginsSchema.default(["http://localhost:3000"]),
  FRONTEND_URL: httpUrlSchema.default("http://localhost:3000"),
  SMTP_HOST: optionalString,
  SMTP_PORT: z.coerce.number().int().positive().default(587),
  SMTP_SECURE: booleanSchema.default(false),
  SMTP_USER: optionalString,
  SMTP_PASSWORD: optionalString,
  MAIL_FROM: optionalString,
  MAIL_FROM_NAME: optionalString,
  ORDER_NOTIFICATION_EMAIL: z.preprocess((value) => value === "" ? undefined : value, z.email().optional()),
  SUPPORT_NOTIFICATION_EMAIL: z.preprocess((value) => value === "" ? undefined : value, z.email().optional()),
  GOOGLE_CLIENT_ID: optionalString,
  FACEBOOK_APP_ID: optionalString,
  FACEBOOK_APP_SECRET: optionalString,
  CLOUDINARY_CLOUD_NAME: optionalString,
  CLOUDINARY_API_KEY: optionalString,
  CLOUDINARY_API_SECRET: optionalString,
  UPLOAD_STORAGE_DRIVER: z.enum(["local", "cloudinary"]).default("local"),
  UPLOAD_BASE_URL: optionalString,
  UPLOAD_LOCAL_PATH: optionalString,
  RAILWAY_VOLUME_MOUNT_PATH: optionalString,
  LOW_STOCK_THRESHOLD: z.coerce.number().int().min(0).max(1_000_000).default(5),
  })
  .superRefine((value, context) => {
    if (value.UPLOAD_BASE_URL && !isHttpUrl(value.UPLOAD_BASE_URL)) {
      context.addIssue({
        code: "custom",
        path: ["UPLOAD_BASE_URL"],
        message: "UPLOAD_BASE_URL must be a valid HTTP or HTTPS URL",
      });
    }
    if (value.JWT_ACCESS_SECRET === value.JWT_REFRESH_SECRET) {
      context.addIssue({
        code: "custom",
        path: ["JWT_REFRESH_SECRET"],
        message: "Access and refresh JWT secrets must differ",
      });
    }
    if (value.AUTH_COOKIE_SAME_SITE === "none" && !value.AUTH_COOKIE_SECURE) {
      context.addIssue({
        code: "custom",
        path: ["AUTH_COOKIE_SECURE"],
        message: "SameSite=None cookies must be secure",
      });
    }
    if (
      value.NODE_ENV === "production" &&
      (value.JWT_ACCESS_SECRET.startsWith("replace_") || value.JWT_REFRESH_SECRET.startsWith("replace_"))
    ) {
      context.addIssue({
        code: "custom",
        path: ["JWT_ACCESS_SECRET"],
        message: "Production JWT secrets must not use example placeholder values",
      });
    }
    if (value.NODE_ENV === "production" && !value.AUTH_COOKIE_SECURE) {
      context.addIssue({
        code: "custom",
        path: ["AUTH_COOKIE_SECURE"],
        message: "Production requires secure authentication cookies",
      });
    }
    if (value.NODE_ENV === "production" && isLoopbackUrl(value.FRONTEND_URL)) {
      context.addIssue({
        code: "custom",
        path: ["FRONTEND_URL"],
        message: "Production frontend URL must not use a loopback host",
      });
    }
    if (value.NODE_ENV === "production" && value.AUTH_REQUIRE_EMAIL_VERIFICATION) {
      if (!value.SMTP_HOST) {
        context.addIssue({ code: "custom", path: ["SMTP_HOST"], message: "SMTP host is required when production email verification is enabled" });
      }
      if (!value.MAIL_FROM) {
        context.addIssue({ code: "custom", path: ["MAIL_FROM"], message: "Mail sender is required when production email verification is enabled" });
      }
    }
    if (value.NODE_ENV === "production") {
      if (!value.SMTP_HOST) context.addIssue({ code: "custom", path: ["SMTP_HOST"], message: "SMTP host is required for order emails" });
      if (!value.MAIL_FROM) context.addIssue({ code: "custom", path: ["MAIL_FROM"], message: "Mail sender is required for order emails" });
      if (!value.ORDER_NOTIFICATION_EMAIL) context.addIssue({ code: "custom", path: ["ORDER_NOTIFICATION_EMAIL"], message: "Admin order email is required" });
    }
    if (Boolean(value.SMTP_USER) !== Boolean(value.SMTP_PASSWORD)) {
      context.addIssue({
        code: "custom",
        path: [value.SMTP_USER ? "SMTP_PASSWORD" : "SMTP_USER"],
        message: "SMTP username and password must either both be supplied or both be omitted",
      });
    }
  });

export function parseEnv(input: Record<string, unknown>) {
  return envSchema.parse(input);
}

export const env = parseEnv(process.env);
