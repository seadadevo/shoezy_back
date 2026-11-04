import { z } from "zod";
const uuid = z.string().uuid(); const emptyBody = z.preprocess((value) => value ?? {}, z.object({}).strict());
export const listWishlistSchema = z.object({ body: emptyBody, params: z.object({}).strict(), query: z.object({ page: z.coerce.number().int().positive().default(1), limit: z.coerce.number().int().positive().max(100).default(20) }).strict() }).strict();
export const addWishlistItemSchema = z.object({ body: z.object({ productId: uuid, variantId: uuid.optional() }).strict(), params: z.object({}).strict(), query: z.object({}).strict() }).strict();
export const deleteWishlistItemSchema = z.object({ body: emptyBody, params: z.object({ wishlistItemId: uuid }).strict(), query: z.object({}).strict() }).strict();
export type ListWishlistQuery = z.infer<typeof listWishlistSchema>["query"];
export type AddWishlistItemInput = z.infer<typeof addWishlistItemSchema>["body"];
