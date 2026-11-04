import { rateLimit } from "express-rate-limit";

export function authRateLimit(max: number) {
  return rateLimit({
    windowMs: 15 * 60 * 1_000,
    limit: max,
    standardHeaders: "draft-8",
    legacyHeaders: false,
    handler: (_request, response) => {
      response.status(429).json({
        success: false,
        error: { code: "AUTH_RATE_LIMITED", message: "Too many authentication attempts" },
      });
    },
  });
}
