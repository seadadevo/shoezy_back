import type { RequestHandler } from "express";
import { z } from "zod";
import { AppError } from "../../common/errors/app-error";

const uuid = z.string().uuid();
const emptyBody = z.preprocess((value) => value ?? {}, z.object({}).strict());
const idempotencyKey = z.string().trim().min(16).max(128).regex(/^[A-Za-z0-9._:-]+$/, "Idempotency-Key contains unsupported characters");

export const createOrderSchema = z.object({ body: z.object({ addressId: uuid, shippingMethodId: uuid, notes: z.string().trim().min(1).max(2_000).nullable().optional() }).strict(), params: z.object({}).strict(), query: z.object({}).strict() }).strict();
export const listOwnOrdersSchema = z.object({ body: emptyBody, params: z.object({}).strict(), query: z.object({ page: z.coerce.number().int().positive().default(1), limit: z.coerce.number().int().positive().max(100).default(20), sortBy: z.enum(["createdAt", "totalMinor", "orderNumber", "status", "updatedAt"]).default("createdAt"), sortOrder: z.enum(["asc", "desc"]).default("desc") }).strict() }).strict();
export const ownOrderIdSchema = z.object({ body: emptyBody, params: z.object({ orderId: uuid }).strict(), query: z.object({}).strict() }).strict();
const queryBoolean = z.preprocess((value) => value === "true" ? true : value === "false" ? false : value, z.boolean());
export const listAdminOrdersSchema = z.object({ body: emptyBody, params: z.object({}).strict(), query: z.object({
  page: z.coerce.number().int().positive().default(1), limit: z.coerce.number().int().positive().max(100).default(20),
  status: z.enum(["PENDING", "CONFIRMED", "SHIPPED", "DELIVERED", "RETURNED", "CANCELLED"]).optional(),
  paymentStatus: z.enum(["PENDING", "PAID", "CANCELLED"]).optional(),
  search: z.string().trim().min(1).max(100).optional(), hasTracking: queryBoolean.optional(),
  sortBy: z.enum(["createdAt", "totalMinor", "orderNumber", "status", "updatedAt"]).default("createdAt"),
  sortOrder: z.enum(["asc", "desc"]).default("desc"),
}).strict() }).strict();
export const orderTransitionSchema = z.object({ body: z.object({ reason: z.string().trim().min(1).max(255).nullable().optional() }).strict(), params: z.object({ orderId: uuid }).strict(), query: z.object({}).strict() }).strict();
export const shipOrderSchema = orderTransitionSchema.extend({ body: z.object({
  reason: z.string().trim().min(1).max(255).nullable().optional(),
  shippingProvider: z.string().trim().min(1).max(150).optional(),
  trackingNumber: z.string().trim().min(1).max(150).nullable().optional(),
}).strict() });

export const requireIdempotencyKey: RequestHandler = (request, _response, next) => {
  const result = idempotencyKey.safeParse(request.header("Idempotency-Key"));
  if (!result.success) return next(new AppError(422, "A valid Idempotency-Key header is required", "IDEMPOTENCY_KEY_INVALID", result.error.flatten()));
  request.idempotencyKey = result.data;
  next();
};

export type CreateOrderInput = z.infer<typeof createOrderSchema>["body"];
export type ListOwnOrdersQuery = z.infer<typeof listOwnOrdersSchema>["query"];
export type ListAdminOrdersQuery = z.infer<typeof listAdminOrdersSchema>["query"];
export type OrderTransitionInput = z.infer<typeof orderTransitionSchema>["body"];
export type ShipOrderInput = z.infer<typeof shipOrderSchema>["body"];
