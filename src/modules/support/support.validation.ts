import { z } from "zod";

const empty = z.preprocess((value) => value ?? {}, z.object({}).strict());
const id = z.object({ conversationId: z.uuid() }).strict();
const noUnsafeControls = (value: string) => ![...value].some((character) => {
  const code = character.charCodeAt(0);
  return code === 127 || (code < 32 && code !== 9 && code !== 10 && code !== 13);
});
const text = z.string().trim().min(1).max(2000).refine(noUnsafeControls, "Unsupported control character");
const name = z.string().trim().min(1).max(120).refine((value) => noUnsafeControls(value) && !/[\r\n\t]/.test(value), "Invalid name");
const phone = z.string().trim().min(7).max(32).regex(/^\+?[0-9() .-]+$/, "Invalid phone");
const page = z.object({ page: z.coerce.number().int().positive().default(1), limit: z.coerce.number().int().positive().max(100).default(20) }).strict();

export const createSupportSchema = z.object({ body: z.object({
  name: name.optional(),
  phone: phone.optional(),
  email: z.preprocess((v) => (typeof v === "string" && !v.trim() ? undefined : v), z.email().max(320).optional()),
  orderNumber: z.preprocess((v) => (typeof v === "string" && !v.trim() ? undefined : v), z.string().trim().min(3).max(64).regex(/^SHZ-[A-Za-z0-9_-]+$/i, "Invalid order number format").optional()),
  message: text,
}).strict(), params: empty, query: empty }).strict();
export const supportIdSchema = z.object({ body: empty, params: id, query: empty }).strict();
export const supportMessagesSchema = z.object({ body: empty, params: id, query: page }).strict();
export const supportSendSchema = z.object({ body: z.object({ message: text }).strict(), params: id, query: empty }).strict();
export const supportListOwnSchema = z.object({ body: empty, params: empty, query: page }).strict();
export const supportAdminListSchema = z.object({ body: empty, params: empty, query: page.extend({
  status: z.enum(["OPEN", "PENDING", "CLOSED"]).optional(),
  unreadOnly: z.enum(["true", "false"]).transform((value) => value === "true").optional(),
  search: z.string().trim().min(1).max(120).optional(),
}).strict() }).strict();
export const supportStatusSchema = z.object({ body: z.object({ status: z.enum(["OPEN", "PENDING", "CLOSED"]) }).strict(), params: id, query: empty }).strict();

export type CreateSupportInput = z.infer<typeof createSupportSchema>["body"];
export type SupportPage = z.infer<typeof supportMessagesSchema>["query"];
export type SupportAdminList = z.infer<typeof supportAdminListSchema>["query"];
