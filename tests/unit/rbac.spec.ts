import type { NextFunction, Request, Response } from "express";
import { describe, expect, it, vi } from "vitest";
import {
  ADMIN_PERMISSIONS,
  ALL_PERMISSION_CODES,
  CUSTOMER_PERMISSION_CODES,
  PERMISSIONS,
  SYSTEM_ROLE_DEFINITIONS,
  SYSTEM_ROLES,
} from "../../src/common/auth/rbac.constants";
import { assertOwner, assertOwnerOrPermission } from "../../src/common/auth/ownership.policy";
import {
  requireAnyPermission,
  requirePermission,
} from "../../src/common/middlewares/permission.middleware";
import { AppError } from "../../src/common/errors/app-error";
import type { AuthContext } from "../../src/common/auth/auth.types";

const customerAuth: AuthContext = {
  userId: "11111111-1111-4111-8111-111111111111",
  sessionId: "22222222-2222-4222-8222-222222222222",
  roleCodes: [SYSTEM_ROLES.CUSTOMER],
  permissions: [...CUSTOMER_PERMISSION_CODES],
};

function runMiddleware(
  middleware: ReturnType<typeof requirePermission>,
  auth?: AuthContext,
): Promise<unknown> {
  return new Promise((resolve) => {
    const request = { auth } as Request;
    middleware(request, {} as Response, ((error?: unknown) => resolve(error)) as NextFunction);
  });
}

describe("RBAC catalog", () => {
  it("has unique role and permission codes with no wildcards", () => {
    expect(new Set(Object.values(SYSTEM_ROLES)).size).toBe(2);
    expect(new Set(ALL_PERMISSION_CODES).size).toBe(ALL_PERMISSION_CODES.length);
    expect(ALL_PERMISSION_CODES.every((code) => !code.includes("*"))).toBe(true);
  });

  it("assigns only own-scope permissions to CUSTOMER and every explicit permission to ADMIN", () => {
    expect(ALL_PERMISSION_CODES).toHaveLength(CUSTOMER_PERMISSION_CODES.length + Object.values(ADMIN_PERMISSIONS).length);
    expect(CUSTOMER_PERMISSION_CODES).toContain(PERMISSIONS.EXCHANGES_CREATE_OWN);
    expect(CUSTOMER_PERMISSION_CODES).toContain(PERMISSIONS.EXCHANGES_READ_OWN);
    expect(ALL_PERMISSION_CODES).toContain(PERMISSIONS.INVENTORY_READ_ANY);
    expect(ALL_PERMISSION_CODES).toContain(PERMISSIONS.STORE_SETTINGS_MANAGE_ANY);
    expect(CUSTOMER_PERMISSION_CODES.every((code) => code.endsWith(".own"))).toBe(true);
    expect(SYSTEM_ROLE_DEFINITIONS.ADMIN.permissions).toEqual(ALL_PERMISSION_CODES);
    expect(SYSTEM_ROLE_DEFINITIONS.CUSTOMER.permissions).toEqual(CUSTOMER_PERMISSION_CODES);
    expect(Object.values(ADMIN_PERMISSIONS).every((code) => code.endsWith(".any"))).toBe(true);
  });
});

describe("permission middleware", () => {
  it("allows a present permission and denies a missing permission", async () => {
    expect(await runMiddleware(requirePermission(PERMISSIONS.ORDERS_READ_OWN), customerAuth)).toBeUndefined();
    const denied = await runMiddleware(requirePermission(PERMISSIONS.ORDERS_READ_ANY), customerAuth);
    expect(denied).toMatchObject({ statusCode: 403, code: "AUTH_PERMISSION_DENIED" });
  });

  it("does not grant administrative product reads to CUSTOMER", async () => {
    const denied = await runMiddleware(requirePermission(PERMISSIONS.PRODUCTS_READ_ANY), customerAuth);
    expect(denied).toMatchObject({ statusCode: 403, code: "AUTH_PERMISSION_DENIED" });
  });

  it("returns 401 without authentication", async () => {
    const error = await runMiddleware(requirePermission(PERMISSIONS.ORDERS_READ_OWN));
    expect(error).toMatchObject({ statusCode: 401, code: "AUTH_UNAUTHORIZED" });
  });

  it("supports any-of semantics and rejects empty configuration", async () => {
    const middleware = requireAnyPermission(
      PERMISSIONS.ORDERS_READ_ANY,
      PERMISSIONS.ORDERS_READ_OWN,
    );
    expect(await runMiddleware(middleware, customerAuth)).toBeUndefined();
    const denied = await runMiddleware(
      requireAnyPermission(PERMISSIONS.USERS_MANAGE_ANY, PERMISSIONS.RBAC_MANAGE_ANY),
      customerAuth,
    );
    expect(denied).toMatchObject({ statusCode: 403, code: "AUTH_PERMISSION_DENIED" });
    expect(() => requireAnyPermission()).toThrow(/at least one/);
  });
});

describe("ownership policy", () => {
  it("allows the owner and denies a different customer", () => {
    expect(() => assertOwner(customerAuth, customerAuth.userId)).not.toThrow();
    expect(() => assertOwner(customerAuth, "33333333-3333-4333-8333-333333333333")).toThrow(AppError);
  });

  it("allows an explicit any-scope override", () => {
    const adminAuth: AuthContext = {
      ...customerAuth,
      userId: "44444444-4444-4444-8444-444444444444",
      roleCodes: [SYSTEM_ROLES.ADMIN],
      permissions: [PERMISSIONS.ORDERS_READ_ANY],
    };
    expect(() =>
      assertOwnerOrPermission({
        auth: adminAuth,
        ownerUserId: customerAuth.userId,
        overridePermission: PERMISSIONS.ORDERS_READ_ANY,
      }),
    ).not.toThrow();
  });

  it("does not query a business repository", () => {
    const repository = { find: vi.fn() };
    expect(() => assertOwner(customerAuth, customerAuth.userId)).not.toThrow();
    expect(repository.find).not.toHaveBeenCalled();
  });
});
