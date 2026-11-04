import jwt from "jsonwebtoken";
import { describe, expect, it } from "vitest";
import {
  createSessionTokenPair,
  durationToSeconds,
  generateOpaqueToken,
  getDummyPasswordWorkFactor,
  hashPassword,
  hashToken,
  normalizeEmail,
  verifyAccessToken,
  verifyPassword,
  verifyRefreshToken,
} from "../../src/common/auth/auth.security";
import { registerSchema } from "../../src/modules/auth/auth.validation";
import { resetPasswordSchema } from "../../src/modules/auth/auth.validation";
import { env } from "../../src/config/env";
import request from "supertest";
import { createApp } from "../../src/app";

describe("auth security utilities", () => {
  it("normalizes email without provider-specific rewriting", () => {
    expect(normalizeEmail("  User.Name+tag@GMAIL.com ")).toBe("user.name+tag@gmail.com");
  });

  it("hashes passwords and never returns plaintext", async () => {
    const hash = await hashPassword("a-very-strong-password");
    expect(hash).not.toContain("a-very-strong-password");
    expect(await verifyPassword("a-very-strong-password", hash)).toBe(true);
    expect(await verifyPassword("wrong-password", hash)).toBe(false);
  });

  it("creates the process-wide dummy hash with the configured bcrypt work factor", async () => {
    expect(await getDummyPasswordWorkFactor()).toBe(env.BCRYPT_ROUNDS);
  });

  it("creates high-entropy raw tokens but only deterministic SHA-256 lookup hashes", () => {
    const token = generateOpaqueToken();
    expect(token).toHaveLength(43);
    expect(hashToken(token)).toMatch(/^[a-f0-9]{64}$/);
    expect(hashToken(token)).not.toBe(token);
  });

  it("uses supported duration units and rejects malformed durations", () => {
    expect(durationToSeconds("15m")).toBe(900);
    expect(durationToSeconds("2h")).toBe(7_200);
    expect(() => durationToSeconds("15 minutes")).toThrow();
  });

  it("keeps access JWT claims minimal and separates token types", () => {
    const pair = createSessionTokenPair(
      "11111111-1111-4111-8111-111111111111",
      "22222222-2222-4222-8222-222222222222",
    );
    const decoded = jwt.decode(pair.accessToken) as jwt.JwtPayload;
    expect(decoded).toMatchObject({
      sub: "11111111-1111-4111-8111-111111111111",
      sid: "22222222-2222-4222-8222-222222222222",
      typ: "access",
    });
    expect(decoded).not.toHaveProperty("role");
    expect(decoded).not.toHaveProperty("roles");
    expect(decoded).not.toHaveProperty("permissions");
    expect(verifyAccessToken(pair.accessToken).typ).toBe("access");
    expect(verifyRefreshToken(pair.refreshToken).typ).toBe("refresh");
    expect(() => verifyRefreshToken(pair.accessToken)).toThrow();
    expect(() => verifyAccessToken(pair.refreshToken)).toThrow();
  });
});

describe("registration mass-assignment defense", () => {
  it("accepts Unicode passwords up to 72 UTF-8 bytes and rejects larger input", () => {
    const exactly72Bytes = "ع".repeat(36);
    const over72Bytes = "ع".repeat(37);
    const baseRequest = {
      email: "unicode@example.com",
      firstName: "Unicode",
      lastName: "Password",
    };
    expect(
      registerSchema.safeParse({
        body: { ...baseRequest, password: exactly72Bytes },
        params: {},
        query: {},
      }).success,
    ).toBe(true);
    expect(
      registerSchema.safeParse({
        body: { ...baseRequest, password: over72Bytes },
        params: {},
        query: {},
      }).success,
    ).toBe(false);
    expect(
      resetPasswordSchema.safeParse({
        body: { token: "a-valid-reset-token", newPassword: over72Bytes },
        params: {},
        query: {},
      }).success,
    ).toBe(false);
  });

  it("rejects every privilege and provider injection field", () => {
    const attack = {
      body: {
        email: "attacker@example.com",
        password: "a-very-strong-password",
        firstName: "Attack",
        lastName: "Attempt",
        role: "ADMIN",
        roles: ["ADMIN"],
        permissions: ["rbac.manage.any"],
        isAdmin: true,
        status: "ACTIVE",
        provider: "GOOGLE",
        providerId: "attacker",
        emailVerifiedAt: new Date().toISOString(),
      },
      params: {},
      query: {},
    };
    expect(registerSchema.safeParse(attack).success).toBe(false);
  });

  it("rejects privilege injection at the mounted HTTP endpoint before persistence", async () => {
    const response = await request(createApp()).post("/api/v1/auth/register").send({
      email: "attacker@example.com",
      password: "a-very-strong-password",
      firstName: "Attack",
      lastName: "Attempt",
      role: "ADMIN",
      permissions: ["rbac.manage.any"],
      providerId: "attacker",
    });
    expect(response.status).toBe(422);
    expect(JSON.stringify(response.body)).not.toContain("a-very-strong-password");
  });
});
