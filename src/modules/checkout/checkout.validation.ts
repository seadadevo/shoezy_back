import { z } from "zod";
const uuid = z.string().uuid();
export const checkoutPreviewSchema = z.object({
  body: z.object({ addressId: uuid, shippingMethodId: uuid }).strict(),
  params: z.object({}).strict(),
  query: z.object({}).strict(),
}).strict();
export type CheckoutPreviewInput = z.infer<typeof checkoutPreviewSchema>["body"];
