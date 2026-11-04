import type { AuthContext } from "../auth/auth.types";

declare global {
  namespace Express {
    interface Request {
      guestSessionToken?: string;
      auth?: AuthContext;
      validated?: {
        body: unknown;
        params: unknown;
        query: unknown;
      };
      idempotencyKey?: string;
    }
  }
}

export {};
