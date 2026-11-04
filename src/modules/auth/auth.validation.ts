import { z } from "zod";
import { tunisianPhoneSchema } from "../../common/validation/tunisian-phone";

export const emailSchema = z.string().trim().email().max(320);
export const passwordSchema = z
  .string()
  .min(12)
  .max(72)
  .refine((value) => Buffer.byteLength(value, "utf8") <= 72, {
    message: "Password must not exceed 72 UTF-8 bytes",
  });
export const nameSchema = z.string().trim().min(1).max(100);
const token = z.string().min(16).max(4096);
const emptyParams = z.object({}).strict();
const emptyQuery = z.object({}).strict();

function requestSchema<T extends z.ZodType>(body: T) {
  return z.object({ body, params: emptyParams, query: emptyQuery }).strict();
}

const bodylessSchema = requestSchema(
  z.preprocess((value) => value ?? {}, z.object({}).strict()),
);

export const registerSchema = requestSchema(
  z
    .object({
      email: emailSchema,
      password: passwordSchema,
      firstName: nameSchema,
      lastName: nameSchema,
      phone: tunisianPhoneSchema.optional(),
    })
    .strict(),
);

export const verifyEmailSchema = requestSchema(z.object({ token }).strict());
export const resendVerificationSchema = requestSchema(z.object({ email: emailSchema }).strict());
export const loginSchema = requestSchema(z.object({ email: emailSchema, password: passwordSchema }).strict());
export const refreshSchema = bodylessSchema;
export const logoutSchema = bodylessSchema;
export const forgotPasswordSchema = requestSchema(z.object({ email: emailSchema }).strict());
export const resetPasswordSchema = requestSchema(
  z.object({ token, newPassword: passwordSchema }).strict(),
);
export const googleSchema = requestSchema(z.object({ idToken: token }).strict());
export const facebookSchema = requestSchema(z.object({ accessToken: token }).strict());

export type RegisterInput = z.infer<typeof registerSchema>["body"];
export type LoginInput = z.infer<typeof loginSchema>["body"];
export type ResetPasswordInput = z.infer<typeof resetPasswordSchema>["body"];
