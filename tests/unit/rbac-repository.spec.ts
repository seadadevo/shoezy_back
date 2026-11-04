import type { PrismaClient } from "@prisma/client";
import { describe, expect, it, vi } from "vitest";
import { RbacRepository } from "../../src/common/auth/rbac.repository";
import { ALL_PERMISSION_CODES, PERMISSIONS } from "../../src/common/auth/rbac.constants";
import { seedRbac } from "../../prisma/seeds/rbac.seed";

describe("RBAC repository", () => {
  it("loads multiple active roles and active permissions without consulting users.role", async () => {
    const findMany = vi.fn(async (_input: unknown) => [
      {
        role: {
          code: "CUSTOMER",
          permissions: [{ permission: { code: PERMISSIONS.ORDERS_READ_OWN } }],
        },
      },
      {
        role: {
          code: "ADMIN",
          permissions: [
            { permission: { code: PERMISSIONS.ORDERS_READ_OWN } },
            { permission: { code: PERMISSIONS.ORDERS_READ_ANY } },
            { permission: { code: "unknown.dynamic.permission" } },
          ],
        },
      },
    ]);
    const client = { userRole: { findMany } } as unknown as PrismaClient;
    const snapshot = await new RbacRepository(client).getUserAuthorizationSnapshot("user-id");
    expect(snapshot.roleCodes).toEqual(["CUSTOMER", "ADMIN"]);
    expect(snapshot.permissions).toEqual([
      PERMISSIONS.ORDERS_READ_OWN,
      PERMISSIONS.ORDERS_READ_ANY,
    ]);
    expect(findMany).toHaveBeenCalledWith(
      expect.objectContaining({
        where: { userId: "user-id", role: { isActive: true } },
      }),
    );
    const query = findMany.mock.calls[0][0] as {
      select: { role: { select: { permissions: { where: unknown } } } };
    };
    expect(query.select.role.select.permissions.where).toEqual({ permission: { isActive: true } });
    expect(JSON.stringify(query)).not.toContain('"users"');
    expect(JSON.stringify(query)).not.toContain('"role":"ADMIN"');
  });

  it("grants nothing when inactive roles or permissions are filtered by persistence", async () => {
    const client = {
      userRole: { findMany: vi.fn(async () => []) },
    } as unknown as PrismaClient;
    expect(await new RbacRepository(client).getUserAuthorizationSnapshot("user-id")).toEqual({
      roleCodes: [],
      permissions: [],
    });
  });
});

describe("RBAC seed", () => {
  it("preserves existing inactive system roles and permissions", async () => {
    const roles = new Map([
      ["CUSTOMER", { id: "customer-role", code: "CUSTOMER", isActive: true }],
      ["ADMIN", { id: "admin-role", code: "ADMIN", isActive: false }],
    ]);
    const inactivePermissionCode = PERMISSIONS.RBAC_MANAGE_ANY;
    const permissions = new Map<string, { id: string; code: string; isActive: boolean }>([
      [
        inactivePermissionCode,
        { id: `permission:${inactivePermissionCode}`, code: inactivePermissionCode, isActive: false },
      ],
    ]);
    const tx = {
      role: {
        upsert: vi.fn(async ({
          where,
          create,
          update,
        }: {
          where: { code: string };
          create: Record<string, unknown>;
          update: Record<string, unknown>;
        }) => {
          const current = roles.get(where.code);
          if (current) {
            Object.assign(current, update);
            return current;
          }
          const created = {
            id: `${where.code.toLowerCase()}-role`,
            code: where.code,
            isActive: Boolean(create.isActive),
          };
          roles.set(where.code, created);
          return created;
        }),
      },
      permission: {
        upsert: vi.fn(async ({
          where,
          create,
          update,
        }: {
          where: { code: string };
          create: Record<string, unknown>;
          update: Record<string, unknown>;
        }) => {
          const current = permissions.get(where.code);
          if (current) {
            Object.assign(current, update);
            return current;
          }
          const created = {
            id: `permission:${where.code}`,
            code: where.code,
            isActive: create.isActive === undefined ? true : Boolean(create.isActive),
          };
          permissions.set(where.code, created);
          return created;
        }),
      },
      rolePermission: {
        deleteMany: vi.fn(async () => ({ count: 0 })),
        createMany: vi.fn(async () => ({ count: 0 })),
      },
      user: { findMany: vi.fn(async () => []) },
      userRole: { createMany: vi.fn(async () => ({ count: 0 })) },
    };
    const client = {
      $transaction: async (callback: (transaction: typeof tx) => Promise<void>) => callback(tx),
    } as unknown as PrismaClient;

    await seedRbac(client);

    expect(roles.get("ADMIN")?.isActive).toBe(false);
    expect(permissions.get(inactivePermissionCode)?.isActive).toBe(false);
    for (const call of tx.role.upsert.mock.calls) {
      expect(call[0].update).not.toHaveProperty("isActive");
    }
    for (const call of tx.permission.upsert.mock.calls) {
      expect(call[0].update).toEqual({});
    }
  });

  it("is repeatable, explicitly maps both system roles, and backfills legacy users", async () => {
    const roleUpsert = vi.fn(async ({ where }: { where: { code: string } }) => ({
      id: where.code === "ADMIN" ? "admin-role" : "customer-role",
      code: where.code,
    }));
    const permissionUpsert = vi.fn(async ({ where }: { where: { code: string } }) => ({
      id: `permission:${where.code}`,
      code: where.code,
    }));
    const rolePermissionCreateMany = vi.fn(async (_input: unknown) => ({ count: 0 }));
    const userRoleCreateMany = vi.fn(async (_input: unknown) => ({ count: 0 }));
    const tx = {
      role: { upsert: roleUpsert },
      permission: { upsert: permissionUpsert },
      rolePermission: {
        deleteMany: vi.fn(async () => ({ count: 0 })),
        createMany: rolePermissionCreateMany,
      },
      user: {
        findMany: vi.fn(async () => [
          { id: "customer-user", role: "CUSTOMER" },
          { id: "admin-user", role: "ADMIN" },
        ]),
      },
      userRole: { createMany: userRoleCreateMany },
    };
    const client = {
      $transaction: async (callback: (transaction: typeof tx) => Promise<void>) => callback(tx),
    } as unknown as PrismaClient;

    await seedRbac(client);
    await seedRbac(client);

    expect(roleUpsert).toHaveBeenCalledTimes(4);
    expect(permissionUpsert).toHaveBeenCalledTimes(ALL_PERMISSION_CODES.length * 2);
    expect(rolePermissionCreateMany).toHaveBeenCalledTimes(4);
    for (const call of rolePermissionCreateMany.mock.calls) {
      expect(call[0]).toMatchObject({ skipDuplicates: true });
    }
    expect(userRoleCreateMany).toHaveBeenCalledTimes(2);
    expect(userRoleCreateMany.mock.calls[0][0]).toMatchObject({
      data: [
        { userId: "customer-user", roleId: "customer-role" },
        { userId: "admin-user", roleId: "admin-role" },
      ],
      skipDuplicates: true,
    });
  });
});
