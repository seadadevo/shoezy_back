import { z } from "zod";
import { POSTGRES_INT_MAX } from "../../common/validation/postgres-int";

const uuid = z.string().uuid();
const emptyBody = z.preprocess((value) => value ?? {}, z.object({}).strict());
const emptyParams = z.object({}).strict();
const emptyQuery = z.object({}).strict();
const quantity = z.number().int().min(1).max(POSTGRES_INT_MAX);

export const getCartSchema = z.object({ body: emptyBody, params: emptyParams, query: emptyQuery }).strict();
export const addCartItemSchema = z.object({ body: z.object({ variantId: uuid, quantity }).strict(), params: emptyParams, query: emptyQuery }).strict();
export const updateCartItemSchema = z.object({ body: z.object({ quantity }).strict(), params: z.object({ cartItemId: uuid }).strict(), query: emptyQuery }).strict();
export const deleteCartItemSchema = z.object({ body: emptyBody, params: z.object({ cartItemId: uuid }).strict(), query: emptyQuery }).strict();
export const setCartDiscountCodeSchema = z.object({ body: z.object({ code: z.string().trim().min(1).max(80).transform((value) => value.toUpperCase()) }).strict(), params: emptyParams, query: emptyQuery }).strict();

export type AddCartItemInput = z.infer<typeof addCartItemSchema>["body"];
export type UpdateCartItemInput = z.infer<typeof updateCartItemSchema>["body"];
export type SetCartDiscountCodeInput = z.infer<typeof setCartDiscountCodeSchema>["body"];
