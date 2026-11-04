import { z } from "zod";

const empty = z.preprocess((value) => value ?? {}, z.object({}).strict());
const uuid = z.string().uuid();
const notificationType = z.enum(["ORDER_CREATED", "ORDER_CONFIRMED", "ORDER_SHIPPED", "ORDER_DELIVERED", "ORDER_CANCELLED", "RETURN_REQUESTED", "RETURN_STATUS_UPDATED", "EXCHANGE_REQUESTED", "EXCHANGE_STATUS_UPDATED", "REVIEW_PENDING", "LOW_STOCK", "SUPPORT_REQUEST"]);

export const listNotificationsSchema = z.object({
  body: empty,
  params: z.object({}).strict(),
  query: z.object({ page: z.coerce.number().int().positive().default(1), limit: z.coerce.number().int().positive().max(100).default(20), unreadOnly: z.preprocess((value) => value === "true" ? true : value === "false" || value === undefined ? false : value, z.boolean()), type: notificationType.optional() }).strict(),
}).strict();
export const notificationIdSchema = z.object({ body: empty, params: z.object({ notificationId: uuid }).strict(), query: z.object({}).strict() }).strict();
export const notificationEmptySchema = z.object({ body: empty, params: z.object({}).strict(), query: z.object({}).strict() }).strict();
export type ListNotificationsQuery = z.infer<typeof listNotificationsSchema>["query"];
