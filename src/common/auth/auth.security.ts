import { createHash, randomBytes, randomUUID, timingSafeEqual } from "node:crypto";
import bcrypt from "bcryptjs";
import jwt, { type JwtPayload, type SignOptions } from "jsonwebtoken";
import { env } from "../../config/env";
import type { AccessTokenPayload, RefreshTokenPayload } from "./auth.types";

const DURATION_FACTORS = { s: 1, m: 60, h: 3_600, d: 86_400 } as const;

export function durationToSeconds(duration: string): number {
  const match = /^(\d+)([smhd])$/.exec(duration);
  if (!match) throw new Error("Invalid duration");
  const value = Number(match[1]);
  const unit = match[2] as keyof typeof DURATION_FACTORS;
  if (!Number.isSafeInteger(value) || value <= 0) throw new Error("Invalid duration");
  return value * DURATION_FACTORS[unit];
}

export function normalizeEmail(email: string): string {
  return email.trim().toLowerCase();
}

export function hashPassword(password: string): Promise<string> {
  return bcrypt.hash(password, env.BCRYPT_ROUNDS);
}

export function verifyPassword(password: string, hash: string): Promise<boolean> {
  return bcrypt.compare(password, hash);
}

const dummyPasswordHash = hashPassword(generateOpaqueToken());

export async function verifyDummyPassword(password: string): Promise<boolean> {
  return verifyPassword(password, await dummyPasswordHash);
}

export async function getDummyPasswordWorkFactor(): Promise<number> {
  return bcrypt.getRounds(await dummyPasswordHash);
}

export function generateOpaqueToken(bytes = 32): string {
  return randomBytes(bytes).toString("base64url");
}

export function hashToken(rawToken: string): string {
  return createHash("sha256").update(rawToken, "utf8").digest("hex");
}

export function tokenHashesEqual(left: string, right: string): boolean {
  const leftBuffer = Buffer.from(left, "utf8");
  const rightBuffer = Buffer.from(right, "utf8");
  return leftBuffer.length === rightBuffer.length && timingSafeEqual(leftBuffer, rightBuffer);
}

function jwtOptions(expiresIn: string): SignOptions {
  return {
    expiresIn: durationToSeconds(expiresIn),
    issuer: env.JWT_ISSUER,
    audience: env.JWT_AUDIENCE,
  };
}

export function signAccessToken(payload: AccessTokenPayload): string {
  return jwt.sign(payload, env.JWT_ACCESS_SECRET, jwtOptions(env.JWT_ACCESS_EXPIRES_IN));
}

export function signRefreshToken(payload: RefreshTokenPayload): string {
  return jwt.sign(payload, env.JWT_REFRESH_SECRET, jwtOptions(env.JWT_REFRESH_EXPIRES_IN));
}

function verifyJwt(rawToken: string, secret: string): JwtPayload {
  const payload = jwt.verify(rawToken, secret, {
    issuer: env.JWT_ISSUER,
    audience: env.JWT_AUDIENCE,
  });
  if (typeof payload === "string") throw new Error("Invalid JWT payload");
  return payload;
}

function requiredString(payload: JwtPayload, key: string): string {
  const value = payload[key];
  if (typeof value !== "string" || value.length === 0) throw new Error(`Invalid ${key}`);
  return value;
}

export function verifyAccessToken(rawToken: string): AccessTokenPayload {
  const payload = verifyJwt(rawToken, env.JWT_ACCESS_SECRET);
  if (payload.typ !== "access") throw new Error("Wrong token type");
  return {
    sub: requiredString(payload, "sub"),
    sid: requiredString(payload, "sid"),
    typ: "access",
  };
}

export function verifyRefreshToken(rawToken: string): RefreshTokenPayload {
  const payload = verifyJwt(rawToken, env.JWT_REFRESH_SECRET);
  if (payload.typ !== "refresh" || !Number.isSafeInteger(payload.rot) || payload.rot < 0) {
    throw new Error("Invalid refresh token payload");
  }
  return {
    sub: requiredString(payload, "sub"),
    sid: requiredString(payload, "sid"),
    rot: payload.rot,
    jti: requiredString(payload, "jti"),
    typ: "refresh",
  };
}

export function createSessionTokenPair(
  userId: string,
  sessionId: string = randomUUID(),
  rotation = 0,
) {
  const refreshToken = signRefreshToken({
    sub: userId,
    sid: sessionId,
    rot: rotation,
    jti: randomUUID(),
    typ: "refresh",
  });
  return {
    sessionId,
    accessToken: signAccessToken({ sub: userId, sid: sessionId, typ: "access" }),
    refreshToken,
    refreshTokenHash: hashToken(refreshToken),
    rotation,
  };
}
