import { z } from "zod";
const uuid = z.string().uuid();
const empty = z.object({}).strict();
const emptyBody = z.preprocess((value) => value ?? {}, empty);
export const listCustomersSchema = z.object({ body: emptyBody, params: empty, query: z.object({ page: z.coerce.number().int().positive().default(1), limit: z.coerce.number().int().positive().max(100).default(20), search: z.string().trim().min(1).max(100).optional(), status: z.enum(["ACTIVE", "INACTIVE"]).optional(), sortBy: z.enum(["createdAt", "firstName", "email"]).default("createdAt"), sortOrder: z.enum(["asc", "desc"]).default("desc") }).strict() }).strict();
export const customerIdSchema = z.object({ body: emptyBody, params: z.object({ customerId: uuid }).strict(), query: empty }).strict();
export const updateCustomerStatusSchema = z.object({ body: z.object({ status: z.enum(["ACTIVE", "INACTIVE"]) }).strict(), params: z.object({ customerId: uuid }).strict(), query: empty }).strict();
export type ListCustomersQuery = z.infer<typeof listCustomersSchema>["query"];
