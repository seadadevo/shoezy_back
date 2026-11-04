import type { PrismaClient } from "@prisma/client";
import { describe, expect, it, vi } from "vitest";
import { verifyPassword } from "../../src/common/auth/auth.security";
import { seedBootstrapAdmin, type BootstrapAdminEnvironment } from "../../prisma/seeds/admin-bootstrap.seed";

type UserRow = {
  id: string;
  email: string;
  passwordHash: string | null;
  firstName: string;
  lastName: string;
  status: "ACTIVE" | "INACTIVE";
  role: "ADMIN" | "CUSTOMER";
  provider: "EMAIL" | "GOOGLE" | "FACEBOOK";
  emailVerifiedAt: Date | null;
  deletedAt: Date | null;
};

const adminInput: BootstrapAdminEnvironment = {
  BOOTSTRAP_ADMIN_EMAIL: "  Admin@Example.COM ",
  BOOTSTRAP_ADMIN_PASSWORD: "a-bootstrap-password",
  BOOTSTRAP_ADMIN_FIRST_NAME: "Bootstrap",
  BOOTSTRAP_ADMIN_LAST_NAME: "Admin",
};

function makeClient(initialUser?: Partial<UserRow>, adminRoleActive = true) {
  const users = new Map<string, UserRow>();
  if (initialUser) {
    const user: UserRow = {
      id: "user-id",
      email: "admin@example.com",
      passwordHash: "existing-bcrypt-hash",
      firstName: "Existing",
      lastName: "User",
      status: "ACTIVE",
      role: "CUSTOMER",
      provider: "EMAIL",
      emailVerifiedAt: null,
      deletedAt: null,
      ...initialUser,
    };
    users.set(user.email, user);
  }
  const userRoleKeys = new Set<string>();
  const transactionCalls = vi.fn();

  const tx = {
    user: {
      findUnique: vi.fn(async ({ where }: { where: { email: string } }) => users.get(where.email) ?? null),
      upsert: vi.fn(async ({
        where,
        create,
        update,
      }: {
        where: { email: string };
        create: Record<string, unknown>;
        update: Record<string, unknown>;
      }) => {
        const current = users.get(where.email);
        if (current) {
          Object.assign(current, update);
          return current;
        }
        const created: UserRow = {
          id: "created-user-id",
          email: String(create.email),
          passwordHash: (create.passwordHash as string) ?? null,
          firstName: String(create.firstName),
          lastName: String(create.lastName),
          status: create.status as UserRow["status"],
          role: create.role as UserRow["role"],
          provider: create.provider as UserRow["provider"],
          emailVerifiedAt: (create.emailVerifiedAt as Date | null) ?? null,
          deletedAt: null,
        };
        users.set(created.email, created);
        return created;
      }),
    },
    role: {
      findUnique: vi.fn(async () => ({ id: "admin-role-id", isActive: adminRoleActive })),
    },
    userRole: {
      upsert: vi.fn(async ({ where }: { where: { userId_roleId: { userId: string; roleId: string } } }) => {
        const key = `${where.userId_roleId.userId}:${where.userId_roleId.roleId}`;
        userRoleKeys.add(key);
        return where.userId_roleId;
      }),
    },
  };
  const client = {
    $transaction: vi.fn(async (callback: (transaction: typeof tx) => Promise<boolean>) => {
      transactionCalls();
      return callback(tx);
    }),
  } as unknown as PrismaClient;

  return { client, tx, users, userRoleKeys, transactionCalls };
}

describe("Admin bootstrap seed", () => {
  it("skips safely when the required email or password is missing", async () => {
    const { client, transactionCalls } = makeClient();

    await expect(
      seedBootstrapAdmin(client, {
        BOOTSTRAP_ADMIN_FIRST_NAME: "Bootstrap",
        BOOTSTRAP_ADMIN_LAST_NAME: "Admin",
      }),
    ).resolves.toEqual({ skipped: true, created: false });
    expect(transactionCalls).not.toHaveBeenCalled();
  });

  it("creates a normalized, verified Admin with a hashed password on the first seed", async () => {
    const { client, users, userRoleKeys } = makeClient();

    await expect(seedBootstrapAdmin(client, adminInput)).resolves.toEqual({
      skipped: false,
      created: true,
    });
    const admin = users.get("admin@example.com");
    expect(admin).toMatchObject({
      email: "admin@example.com",
      status: "ACTIVE",
      role: "ADMIN",
      provider: "EMAIL",
    });
    expect(admin?.emailVerifiedAt).toBeInstanceOf(Date);
    expect(admin?.passwordHash).not.toBe(adminInput.BOOTSTRAP_ADMIN_PASSWORD);
    expect(await verifyPassword(adminInput.BOOTSTRAP_ADMIN_PASSWORD!, admin!.passwordHash!)).toBe(true);
    expect(userRoleKeys).toEqual(new Set(["created-user-id:admin-role-id"]));
  });

  it("is idempotent across repeated seeds without duplicate users or mappings", async () => {
    const { client, users, userRoleKeys } = makeClient();

    await seedBootstrapAdmin(client, adminInput);
    const passwordHash = users.get("admin@example.com")?.passwordHash;
    await expect(seedBootstrapAdmin(client, adminInput)).resolves.toEqual({
      skipped: false,
      created: false,
    });

    expect(users.size).toBe(1);
    expect(users.get("admin@example.com")?.passwordHash).toBe(passwordHash);
    expect(userRoleKeys.size).toBe(1);
  });

  it("fails closed for an existing INACTIVE user without changing it", async () => {
    const existingHash = "existing-bcrypt-hash";
    const { client, users, userRoleKeys } = makeClient({
      passwordHash: existingHash,
      status: "INACTIVE",
      role: "CUSTOMER",
    });

    await expect(seedBootstrapAdmin(client, adminInput)).rejects.toThrow(
      "inactive user; activate it explicitly before bootstrapping",
    );
    expect(users.get("admin@example.com")).toMatchObject({
      passwordHash: existingHash,
      status: "INACTIVE",
      role: "CUSTOMER",
    });
    expect(userRoleKeys.size).toBe(0);
  });

  it("attaches ADMIN safely to an existing ACTIVE user without replacing its password", async () => {
    const existingHash = "existing-bcrypt-hash";
    const { client, users, userRoleKeys } = makeClient({
      passwordHash: existingHash,
      status: "ACTIVE",
      role: "CUSTOMER",
    });

    await expect(seedBootstrapAdmin(client, adminInput)).resolves.toEqual({
      skipped: false,
      created: false,
    });
    expect(users.get("admin@example.com")).toMatchObject({
      passwordHash: existingHash,
      status: "ACTIVE",
      role: "ADMIN",
    });
    expect(userRoleKeys).toEqual(new Set(["user-id:admin-role-id"]));
  });

  it("refuses to attach Admin when the system ADMIN role is inactive", async () => {
    const { client, userRoleKeys } = makeClient(
      { passwordHash: "existing-bcrypt-hash", status: "ACTIVE" },
      false,
    );

    await expect(seedBootstrapAdmin(client, adminInput)).rejects.toThrow(
      "System ADMIN role is unavailable; seed RBAC before bootstrapping Admin",
    );
    expect(userRoleKeys.size).toBe(0);
  });

  it("rejects an existing deleted user", async () => {
    const { client, userRoleKeys } = makeClient({ deletedAt: new Date() });

    await expect(seedBootstrapAdmin(client, adminInput)).rejects.toThrow(
      "deleted user; restore it explicitly before bootstrapping",
    );
    expect(userRoleKeys.size).toBe(0);
  });

  it.each([
    ["OAuth", { provider: "GOOGLE" as const, passwordHash: null }],
    ["passwordless email", { provider: "EMAIL" as const, passwordHash: null }],
  ])("rejects an existing %s user", async (_kind, existingUser) => {
    const { client, userRoleKeys } = makeClient(existingUser);

    await expect(seedBootstrapAdmin(client, adminInput)).rejects.toThrow(
      "without an email password login",
    );
    expect(userRoleKeys.size).toBe(0);
  });

  it("leaves an existing verified Admin unchanged on subsequent runs", async () => {
    const verifiedAt = new Date("2025-01-01T00:00:00.000Z");
    const { client, users, userRoleKeys } = makeClient({
      passwordHash: "existing-bcrypt-hash",
      status: "ACTIVE",
      role: "ADMIN",
      emailVerifiedAt: verifiedAt,
    });

    await seedBootstrapAdmin(client, adminInput);
    await seedBootstrapAdmin(client, { ...adminInput, BOOTSTRAP_ADMIN_PASSWORD: "another-password" });

    expect(users.size).toBe(1);
    expect(users.get("admin@example.com")).toMatchObject({
      passwordHash: "existing-bcrypt-hash",
      status: "ACTIVE",
      role: "ADMIN",
      emailVerifiedAt: verifiedAt,
    });
    expect(userRoleKeys.size).toBe(1);
  });
});
