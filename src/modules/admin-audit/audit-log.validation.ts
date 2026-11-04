import { z } from "zod";

const empty = z.preprocess((value) => value ?? {}, z.object({}).strict());
export const listAuditLogsSchema = z.object({
  body: empty,
  params: z.object({}).strict(),
  query: z.object({
    page: z.coerce.number().int().positive().default(1),
    limit: z.coerce.number().int().positive().max(100).default(20),
    actorUserId: z.string().uuid().optional(),
    action: z.string().trim().min(1).max(100).optional(),
    entityType: z.string().trim().min(1).max(80).optional(),
    entityId: z.string().trim().min(1).max(100).optional(),
    from: z.coerce.date().optional(),
    to: z.coerce.date().optional(),
  }).strict().refine((value) => !value.from || !value.to || value.from <= value.to, "from must be before to"),
}).strict();
export type ListAuditLogsQuery = z.infer<typeof listAuditLogsSchema>["query"];
