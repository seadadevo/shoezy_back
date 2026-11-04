import { z } from "zod";
import { nonnegativePostgresInt } from "../../common/validation/postgres-int";
const uuid = z.string().uuid(); const emptyBody = z.preprocess((value) => value ?? {}, z.object({}).strict());
const integerString = z.string().regex(/^(?:0|[1-9]\d*)$/).refine((value) => BigInt(value) <= 9_223_372_036_854_775_807n, "Exceeds signed BIGINT range");
const currency = z.string().trim().length(3).regex(/^[A-Za-z]{3}$/).transform((value) => value.toUpperCase());
const code = z.string().trim().min(1).max(80).regex(/^[A-Za-z0-9_-]+$/).transform((value) => value.toUpperCase());
const methodFields = { code, name: z.string().trim().min(1).max(150), basePriceMinor: integerString, currency: currency.optional(), estimatedMinDays: nonnegativePostgresInt.nullable().optional(), estimatedMaxDays: nonnegativePostgresInt.nullable().optional(), isActive: z.boolean().optional() };

export const listPublicShippingMethodsSchema = z.object({ body: emptyBody, params: z.object({}).strict(), query: z.object({ page: z.coerce.number().int().positive().default(1), limit: z.coerce.number().int().positive().max(100).default(20) }).strict() }).strict();
export const listAdminShippingMethodsSchema = z.object({ body: emptyBody, params: z.object({}).strict(), query: z.object({ page: z.coerce.number().int().positive().default(1), limit: z.coerce.number().int().positive().max(100).default(20), search: z.string().trim().min(1).max(100).optional(), isActive: z.preprocess((value) => value === "true" ? true : value === "false" ? false : value, z.boolean()).optional() }).strict() }).strict();
export const shippingMethodIdSchema = z.object({ body: emptyBody, params: z.object({ shippingMethodId: uuid }).strict(), query: z.object({}).strict() }).strict();
export const createShippingMethodSchema = z.object({ body: z.object(methodFields).strict(), params: z.object({}).strict(), query: z.object({}).strict() }).strict();
export const updateShippingMethodSchema = z.object({ body: z.object({ code: code.optional(), name: z.string().trim().min(1).max(150).optional(), basePriceMinor: integerString.optional(), currency: currency.optional(), estimatedMinDays: nonnegativePostgresInt.nullable().optional(), estimatedMaxDays: nonnegativePostgresInt.nullable().optional(), isActive: z.boolean().optional() }).strict().refine((value) => Object.keys(value).length > 0, "At least one field is required"), params: z.object({ shippingMethodId: uuid }).strict(), query: z.object({}).strict() }).strict();
export const updateOrderShippingSchema = z.object({ body: z.object({ shippingProvider: z.string().trim().min(1).max(100).nullable().optional(), trackingNumber: z.string().trim().min(1).max(150).nullable().optional() }).strict().refine((value) => Object.keys(value).length > 0, "At least one shipping field is required"), params: z.object({ orderId: uuid }).strict(), query: z.object({}).strict() }).strict();
export const orderShipmentSchema = z.object({ body: emptyBody, params: z.object({ orderId: uuid }).strict(), query: z.object({}).strict() }).strict();

export type ListPublicShippingMethodsQuery = z.infer<typeof listPublicShippingMethodsSchema>["query"];
export type ListAdminShippingMethodsQuery = z.infer<typeof listAdminShippingMethodsSchema>["query"];
export type CreateShippingMethodInput = z.infer<typeof createShippingMethodSchema>["body"];
export type UpdateShippingMethodInput = z.infer<typeof updateShippingMethodSchema>["body"];
export type UpdateOrderShippingInput = z.infer<typeof updateOrderShippingSchema>["body"];
