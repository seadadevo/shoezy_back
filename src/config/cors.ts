import type { CorsOptions } from "cors";
import { env } from "./env";

export function corsOriginFor(allowedOrigins: readonly string[]): CorsOptions["origin"] {
  const allowed = new Set(allowedOrigins);
  return (origin, callback) => {
    if (!origin || allowed.has(origin)) {
      callback(null, true);
      return;
    }
    callback(new Error("Origin not allowed"));
  };
}

export const corsOptions: CorsOptions = {
  origin: corsOriginFor(env.CORS_ORIGINS),
  credentials: true,
};
