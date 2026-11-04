import { z } from "zod";
import { tunisianPhoneSchema } from "../../common/validation/tunisian-phone";
import {
  latitudeSchema,
  longitudeSchema,
  tunisiaCountryCodeSchema,
} from "../../common/validation/tunisia-address";

const uuid = z.string().uuid();
const required = (max: number) => z.string().trim().min(1).max(max);
const optional = (max: number) => required(max).nullable().optional();
export const guestAddressSchema = z.object({
  firstName: required(100),
  lastName: required(100),
  phone: tunisianPhoneSchema,
  email: z.preprocess((value) => value === "" ? null : value, z.email().max(320).nullable().optional()),
  addressLine1: required(255),
  addressLine2: optional(255),
  city: required(120),
  state: required(120),
  area: optional(120),
  postalCode: optional(32),
  countryCode: tunisiaCountryCodeSchema.default("TN"),
  latitude: latitudeSchema.nullable().optional(),
  longitude: longitudeSchema.nullable().optional(),
}).strict();
export const guestCheckoutPreviewSchema = z.object({
  body: guestAddressSchema.extend({ shippingMethodId: uuid }),
  params: z.object({}).strict(), query: z.object({}).strict(),
}).strict();
export const guestCreateOrderSchema = z.object({
  body: guestCheckoutPreviewSchema.shape.body.extend({ notes: optional(2_000) }),
  params: z.object({}).strict(), query: z.object({}).strict(),
}).strict();
export type GuestCheckoutInput = z.infer<typeof guestCheckoutPreviewSchema>["body"];
export type GuestCreateOrderInput = z.infer<typeof guestCreateOrderSchema>["body"];
export const guestCheckoutAddress = (input: GuestCheckoutInput) => ({
  id: null,
  recipientName: `${input.firstName} ${input.lastName}`,
  phone: input.phone,
  countryCode: input.countryCode,
  state: input.state,
  city: input.city,
  area: input.area ?? null,
  postalCode: input.postalCode ?? null,
  line1: input.addressLine1,
  line2: input.addressLine2 ?? null,
  latitude: input.latitude ?? null,
  longitude: input.longitude ?? null,
});
