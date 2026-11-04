import { z } from "zod";

const empty = z.object({}).strict();
const emptyBody = z.preprocess((value) => value ?? {}, empty);
export const readStoreSettingsSchema = z.object({ body: emptyBody, params: empty, query: empty }).strict();
export const updateStoreSettingsSchema = z.object({
  body: z.object({
    storeName: z.string().trim().min(1).max(150).optional(),
    whatsappNumber: z.string().trim().regex(/^\+216[2-9]\d{7}$/, "Use +216 followed by eight Tunisian digits").nullable().optional(),
    supportPhone: z.string().trim().min(1).max(32).nullable().optional(),
    supportEmail: z.email().max(320).nullable().optional(),
    shippingPolicy: z.string().trim().min(1).max(10_000).nullable().optional(),
    returnWindowDays: z.number().int().min(0).max(365).optional(),
    exchangeWindowDays: z.number().int().min(0).max(365).optional(),
    whatsappConfirmationEnabled: z.boolean().optional(),
  }).strict().refine((value) => Object.keys(value).length > 0, "At least one setting is required"),
  params: empty,
  query: empty,
}).strict();
export type UpdateStoreSettingsInput = z.infer<typeof updateStoreSettingsSchema>["body"];
