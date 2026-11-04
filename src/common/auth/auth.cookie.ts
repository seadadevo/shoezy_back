import type { CookieOptions, Response } from "express";
import { env } from "../../config/env";
import { durationToSeconds } from "./auth.security";

export const refreshCookieOptions: CookieOptions = {
  httpOnly: true,
  secure: env.AUTH_COOKIE_SECURE,
  sameSite: env.AUTH_COOKIE_SAME_SITE,
  path: "/api/v1/auth",
  maxAge: durationToSeconds(env.JWT_REFRESH_EXPIRES_IN) * 1_000,
};

export function setRefreshCookie(response: Response, token: string): void {
  response.cookie(env.AUTH_REFRESH_COOKIE_NAME, token, refreshCookieOptions);
}

export function clearRefreshCookie(response: Response): void {
  const clearOptions = { ...refreshCookieOptions };
  delete clearOptions.maxAge;
  response.clearCookie(env.AUTH_REFRESH_COOKIE_NAME, clearOptions);
}
