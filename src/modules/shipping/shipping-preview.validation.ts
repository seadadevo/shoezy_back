import { z } from "zod";
import { tunisiaCountryCodeSchema } from "../../common/validation/tunisia-address";

export const shippingPreviewSchema = z.object({
  body: z.object({
    countryCode: tunisiaCountryCodeSchema,
    state: z.string().trim().min(1).max(120),
    city: z.string().trim().min(1).max(120),
    area: z.string().trim().min(1).max(120).nullable().optional(),
  }).strict(),
  params: z.object({ slug: z.string().trim().min(1).max(250) }).strict(),
  query: z.object({}).strict(),
}).strict();

export type ShippingPreviewInput = z.infer<typeof shippingPreviewSchema>["body"];
