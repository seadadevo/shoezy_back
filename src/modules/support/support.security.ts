import { createHash, randomBytes, timingSafeEqual } from "node:crypto";

export const supportToken = () => randomBytes(32).toString("base64url");
export const supportTokenHash = (value: string) => createHash("sha256").update(value).digest("hex");

export function validSupportToken(raw: string | undefined, hash: string | null): boolean {
  if (!raw || !hash || !/^[A-Za-z0-9_-]{43}$/.test(raw)) return false;
  return timingSafeEqual(Buffer.from(supportTokenHash(raw), "hex"), Buffer.from(hash, "hex"));
}

export const normalizedSupportPhone = (value: string) => value.replace(/\D/g, "");
