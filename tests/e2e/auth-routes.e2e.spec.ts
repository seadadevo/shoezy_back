import request from "supertest";
import { afterEach, beforeEach, describe, expect, it, vi } from "vitest";
import { createApp } from "../../src/app";
import { createSessionTokenPair } from "../../src/common/auth/auth.security";
import { AuthGuardRepository } from "../../src/common/auth/auth-guard.repository";
import { RbacRepository } from "../../src/common/auth/rbac.repository";
import { AuthService } from "../../src/modules/auth/auth.service";

const userId = "11111111-1111-4111-8111-111111111111";
const sessionId = "22222222-2222-4222-8222-222222222222";

function safeUser() {
  return {
    id: userId,
    email: "user@example.com",
    firstName: "Route",
    lastName: "Test",
    provider: "EMAIL" as const,
    emailVerifiedAt: new Date(),
  };
}

describe("mounted authentication routes on Express 5", () => {
  beforeEach(() => {
    vi.spyOn(AuthGuardRepository.prototype, "findSession").mockResolvedValue({
      id: sessionId,
      userId,
      expiresAt: new Date(Date.now() + 60_000),
      revokedAt: null,
      user: { status: "ACTIVE", deletedAt: null },
    });
    vi.spyOn(RbacRepository.prototype, "getUserAuthorizationSnapshot").mockResolvedValue({
      roleCodes: ["CUSTOMER"],
      permissions: [],
    });
  });

  afterEach(() => {
    vi.restoreAllMocks();
  });

  it("POST /register passes strict validation without mutating req.query", async () => {
    const register = vi.spyOn(AuthService.prototype, "register").mockResolvedValue({
      user: safeUser(),
      verificationRequired: true,
    });
    const response = await request(createApp()).post("/api/v1/auth/register").send({
      email: "  user@example.com  ",
      password: "a-very-strong-password",
      firstName: "Route",
      lastName: "Test",
    });
    expect(response.status).toBe(201);
    expect(register).toHaveBeenCalledWith(
      expect.objectContaining({ email: "user@example.com", firstName: "Route" }),
    );
  });

  it("POST /refresh accepts no request body", async () => {
    const refresh = vi.spyOn(AuthService.prototype, "refresh").mockResolvedValue({
      user: safeUser(),
      accessToken: "next-access-token",
      refreshToken: "next-refresh-token",
    });
    const response = await request(createApp())
      .post("/api/v1/auth/refresh")
      .set("Cookie", "shoe_refresh=presented-refresh-token");
    expect(response.status).toBe(200);
    expect(response.body.data.accessToken).toBe("next-access-token");
    expect(refresh).toHaveBeenCalledWith("presented-refresh-token");
  });

  it.each([
    ["/api/v1/auth/logout", "logout"],
    ["/api/v1/auth/logout-all", "logoutAll"],
  ] as const)("POST %s accepts no request body when authenticated", async (path, method) => {
    const operation = vi.spyOn(AuthService.prototype, method).mockResolvedValue(undefined);
    const pair = createSessionTokenPair(userId, sessionId);
    const response = await request(createApp())
      .post(path)
      .set("Authorization", `Bearer ${pair.accessToken}`);
    expect(response.status).toBe(200);
    if (method === "logout") {
      expect(operation).toHaveBeenCalledWith(userId, sessionId);
    } else {
      expect(operation).toHaveBeenCalledWith(userId);
    }
  });

  it("still requires bodies for input-bearing endpoints", async () => {
    const response = await request(createApp()).post("/api/v1/auth/register");
    expect(response.status).toBe(422);
  });
});
