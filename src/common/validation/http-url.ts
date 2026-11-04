import { z } from "zod";

export const MAX_HTTP_URL_LENGTH = 500;

export function isHttpUrl(value: string): boolean {
  if (value.length === 0 || value.length > MAX_HTTP_URL_LENGTH) return false;

  try {
    const url = new URL(value);
    return url.protocol === "http:" || url.protocol === "https:";
  } catch {
    return false;
  }
}

export const httpUrlSchema = z
  .string()
  .trim()
  .min(1)
  .max(MAX_HTTP_URL_LENGTH)
  .refine(isHttpUrl, "URL must use HTTP or HTTPS");

