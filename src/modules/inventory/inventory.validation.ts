import { z } from "zod";
const empty = z.object({}).strict();
const emptyBody = z.preprocess((value) => value ?? {}, empty);
export const listInventoryMovementsSchema = z.object({
  body: emptyBody, params: empty,
  query: z.object({
    page: z.coerce.number().int().positive().default(1),
    limit: z.coerce.number().int().positive().max(100).default(20),
    variantId: z.string().uuid().optional(), productId: z.string().uuid().optional(),
    type: z.enum(["INITIAL_STOCK", "MANUAL_SET", "MANUAL_INCREMENT", "MANUAL_DECREMENT", "ORDER_PLACED", "ORDER_CANCELLED", "RETURN_RESTOCK", "EXCHANGE_RETURNED", "EXCHANGE_REPLACEMENT"]).optional(),
    from: z.coerce.date().optional(), to: z.coerce.date().optional(),
  }).strict().refine((q) => !q.from || !q.to || q.from <= q.to, "from must not exceed to"),
}).strict();
export type ListInventoryMovementsQuery = z.infer<typeof listInventoryMovementsSchema>["query"];
