import { RequestHandler } from "express";
import { ZodTypeAny } from "zod";
import { AppError } from "../errors/app-error";
export const validate = (schema: ZodTypeAny): RequestHandler => (req, _res, next) => {
  const result = schema.safeParse({ body: req.body, params: req.params, query: req.query });
  if (!result.success) return next(new AppError(422, "Validation failed", "VALIDATION_ERROR", { ...result.error.flatten(), issues: result.error.issues.map((issue) => ({ path: issue.path, message: issue.message, code: issue.code })) }));
  const parsed = result.data as { body: unknown; params: unknown; query: unknown };
  // Express 5 exposes req.query through a getter. Keep all parsed values in a
  // dedicated request slot instead of mutating framework-owned request fields.
  req.validated = parsed;
  next();
};
