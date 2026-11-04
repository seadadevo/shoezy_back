import { z } from "zod";
import { tunisianPhoneSchema } from "../../common/validation/tunisian-phone";
import {
  latitudeSchema,
  longitudeSchema,
  tunisiaCountryCodeSchema,
} from "../../common/validation/tunisia-address";

const uuid = z.string().uuid();
const emptyQuery = z.object({}).strict();
const emptyBody = z.preprocess((value) => value ?? {}, z.object({}).strict());
const trimmed = (maximum: number) => z.string().trim().min(1).max(maximum);
const optionalTrimmed = (maximum: number) => trimmed(maximum).nullable().optional();

const addressFields = {
  type: z.literal("BOTH").optional(),
  label: optionalTrimmed(100),
  recipientName: trimmed(200),
  phone: tunisianPhoneSchema,
  countryCode: tunisiaCountryCodeSchema,
  state: optionalTrimmed(120),
  city: trimmed(120),
  area: optionalTrimmed(120),
  postalCode: optionalTrimmed(32),
  line1: trimmed(255),
  line2: optionalTrimmed(255),
  latitude: latitudeSchema.nullable().optional(),
  longitude: longitudeSchema.nullable().optional(),
  isDefault: z.boolean().optional(),
};

export const listAddressesSchema = z
  .object({ body: emptyBody, params: z.object({}).strict(), query: emptyQuery })
  .strict();
export const addressIdSchema = z
  .object({
    body: emptyBody,
    params: z.object({ addressId: uuid }).strict(),
    query: emptyQuery,
  })
  .strict();
export const createAddressSchema = z
  .object({
    body: z.object(addressFields).strict(),
    params: z.object({}).strict(),
    query: emptyQuery,
  })
  .strict();
export const updateAddressSchema = z
  .object({
    body: z
      .object({
        type: addressFields.type,
        label: addressFields.label,
        recipientName: addressFields.recipientName.optional(),
        phone: addressFields.phone.optional(),
        countryCode: addressFields.countryCode.optional(),
        state: addressFields.state,
        city: addressFields.city.optional(),
        area: addressFields.area,
        postalCode: addressFields.postalCode,
        line1: addressFields.line1.optional(),
        line2: addressFields.line2,
        latitude: addressFields.latitude,
        longitude: addressFields.longitude,
        isDefault: addressFields.isDefault,
      })
      .strict()
      .refine((value) => Object.keys(value).length > 0, "At least one address field is required"),
    params: z.object({ addressId: uuid }).strict(),
    query: emptyQuery,
  })
  .strict();

export type CreateAddressInput = z.infer<typeof createAddressSchema>["body"];
export type UpdateAddressInput = z.infer<typeof updateAddressSchema>["body"];
