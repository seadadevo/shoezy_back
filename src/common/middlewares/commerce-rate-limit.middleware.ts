import { rateLimit } from "express-rate-limit";

export function commerceMutationRateLimit(limit: number, code: string) {
  return rateLimit({
    windowMs: 15 * 60 * 1_000,
    limit,
    standardHeaders: "draft-8",
    legacyHeaders: false,
    handler: (_request, response) => {
      response.status(429).json({
        success: false,
        error: { code, message: "Too many commerce mutation attempts" },
      });
    },
  });
}
