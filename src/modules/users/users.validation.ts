import { z } from "zod";
import { tunisianPhoneSchema } from "../../common/validation/tunisian-phone";

const emptyParams = z.object({}).strict();
const emptyQuery = z.object({}).strict();
const emptyBody = z.preprocess((value) => value ?? {}, z.object({}).strict());
const name = z.string().trim().min(1).max(100);
const password = z
  .string()
  .min(12)
  .max(72)
  .refine((value) => Buffer.byteLength(value, "utf8") <= 72, {
    message: "Password must not exceed 72 UTF-8 bytes",
  });

export const getProfileSchema = z
  .object({ body: emptyBody, params: emptyParams, query: emptyQuery })
  .strict();

export const updateProfileSchema = z
  .object({
    body: z
      .object({
        firstName: name.optional(),
        lastName: name.optional(),
        phone: tunisianPhoneSchema.nullable().optional(),
      })
      .strict()
      .refine((value) => Object.keys(value).length > 0, "At least one profile field is required"),
    params: emptyParams,
    query: emptyQuery,
  })
  .strict();

export const changePasswordSchema = z
  .object({
    body: z.object({ currentPassword: password, newPassword: password }).strict(),
    params: emptyParams,
    query: emptyQuery,
  })
  .strict();

export type UpdateProfileInput = z.infer<typeof updateProfileSchema>["body"];
export type ChangePasswordInput = z.infer<typeof changePasswordSchema>["body"];
