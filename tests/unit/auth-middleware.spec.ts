import express from "express";
import request from "supertest";
import { describe, expect, it } from "vitest";
import { createSessionTokenPair } from "../../src/common/auth/auth.security";
import { createRequireAuth } from "../../src/common/middlewares/auth.middleware";
import { requirePermission } from "../../src/common/middlewares/permission.middleware";
import { errorHandler } from "../../src/common/middlewares/error-handler.middleware";
import { PERMISSIONS } from "../../src/common/auth/rbac.constants";
import type { PermissionCode } from "../../src/common/auth/rbac.constants";

const userId = "11111111-1111-4111-8111-111111111111";
const sessionId = "22222222-2222-4222-8222-222222222222";

function protectedApp(input?: {
  revoked?: boolean;
  expired?: boolean;
  inactive?: boolean;
  sessionUserId?: string;
  permissions?: PermissionCode[];
  legacyRole?: "ADMIN" | "CUSTOMER";
}) {
  const session = {
    id: sessionId,
    userId: input?.sessionUserId ?? userId,
    expiresAt: input?.expired ? new Date(Date.now() - 1_000) : new Date(Date.now() + 60_000),
    revokedAt: input?.revoked ? new Date() : null,
    user: {
      status: input?.inactive ? ("INACTIVE" as const) : ("ACTIVE" as const),
      deletedAt: null,
      role: input?.legacyRole ?? "CUSTOMER",
    },
  };
  let permissions = input?.permissions ?? [PERMISSIONS.ORDERS_READ_ANY];
  const app = express();
  app.get(
    "/protected",
    createRequireAuth(
      { findSession: async () => session },
      {
        getUserAuthorizationSnapshot: async () => ({
          roleCodes: permissions.length ? ["ADMIN"] : ["CUSTOMER"],
          permissions,
        }),
      },
    ),
    requirePermission(PERMISSIONS.ORDERS_READ_ANY),
    (req, res) => res.json({ auth: req.auth }),
  );
  app.use(errorHandler);
  return {
    app,
    removeAdmin: () => {
      permissions = [];
    },
  };
}

describe("requireAuth and current RBAC authorization", () => {
  it("rejects missing, malformed, invalid, and wrong-type bearer credentials", async () => {
    const { app } = protectedApp();
    expect((await request(app).get("/protected")).status).toBe(401);
    expect((await request(app).get("/protected").set("Authorization", "Basic abc")).status).toBe(401);
    expect((await request(app).get("/protected").set("Authorization", "Bearer invalid")).status).toBe(401);
    const pair = createSessionTokenPair(userId, sessionId);
    expect(
      (await request(app).get("/protected").set("Authorization", `Bearer ${pair.refreshToken}`)).status,
    ).toBe(401);
  });

  it("validates the DB session and current user state", async () => {
    const pair = createSessionTokenPair(userId, sessionId);
    expect(
      (await request(protectedApp({ revoked: true }).app).get("/protected").set("Authorization", `Bearer ${pair.accessToken}`)).status,
    ).toBe(401);
    expect(
      (await request(protectedApp({ expired: true }).app).get("/protected").set("Authorization", `Bearer ${pair.accessToken}`)).status,
    ).toBe(401);
    expect(
      (await request(protectedApp({ inactive: true }).app).get("/protected").set("Authorization", `Bearer ${pair.accessToken}`)).status,
    ).toBe(401);
    expect(
      (
        await request(protectedApp({ sessionUserId: "33333333-3333-4333-8333-333333333333" }).app)
          .get("/protected")
          .set("Authorization", `Bearer ${pair.accessToken}`)
      ).status,
    ).toBe(401);
  });

  it("loads roles and permissions from current DB state", async () => {
    const pair = createSessionTokenPair(userId, sessionId);
    const result = await request(protectedApp().app)
      .get("/protected")
      .set("Authorization", `Bearer ${pair.accessToken}`);
    expect(result.status).toBe(200);
    expect(result.body.auth).toMatchObject({
      userId,
      sessionId,
      roleCodes: ["ADMIN"],
      permissions: [PERMISSIONS.ORDERS_READ_ANY],
    });
  });

  it("denies a stale JWT immediately after ADMIN assignment removal", async () => {
    const pair = createSessionTokenPair(userId, sessionId);
    const test = protectedApp();
    expect(
      (await request(test.app).get("/protected").set("Authorization", `Bearer ${pair.accessToken}`)).status,
    ).toBe(200);
    test.removeAdmin();
    expect(
      (await request(test.app).get("/protected").set("Authorization", `Bearer ${pair.accessToken}`)).status,
    ).toBe(403);
  });

  it("ignores legacy users.role in both directions", async () => {
    const pair = createSessionTokenPair(userId, sessionId);
    const legacyAdminWithCustomerRbac = protectedApp({
      legacyRole: "ADMIN",
      permissions: [],
    });
    expect(
      (
        await request(legacyAdminWithCustomerRbac.app)
          .get("/protected")
          .set("Authorization", `Bearer ${pair.accessToken}`)
      ).status,
    ).toBe(403);

    const legacyCustomerWithAdminRbac = protectedApp({
      legacyRole: "CUSTOMER",
      permissions: [PERMISSIONS.ORDERS_READ_ANY],
    });
    expect(
      (
        await request(legacyCustomerWithAdminRbac.app)
          .get("/protected")
          .set("Authorization", `Bearer ${pair.accessToken}`)
      ).status,
    ).toBe(200);
  });
});
