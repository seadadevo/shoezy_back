import type { PrismaClient } from "@prisma/client";
import { describe, expect, it, vi } from "vitest";
import { AuthRepository } from "../../src/modules/auth/auth.repository";
import { AuthRepositoryError } from "../../src/modules/auth/auth.errors";
import type { AuthUserRecord } from "../../src/modules/auth/auth.types";

function authUser(overrides: Partial<AuthUserRecord> = {}): AuthUserRecord {
  return {
    id: "11111111-1111-4111-8111-111111111111",
    email: "user@example.com",
    phone: null,
    passwordHash: "bcrypt-hash",
    firstName: "Test",
    lastName: "User",
    status: "ACTIVE",
    provider: "EMAIL",
    providerId: null,
    emailVerifiedAt: null,
    deletedAt: null,
    ...overrides,
  };
}

function callbackClient<T>(tx: T): PrismaClient {
  return {
    $transaction: async (callback: (transaction: T) => Promise<unknown>) => callback(tx),
  } as unknown as PrismaClient;
}

describe("AuthRepository transaction contracts", () => {
  it.each([
    ["email", "DUPLICATE_EMAIL"],
    ["phone", "DUPLICATE_PHONE"],
  ] as const)("maps a Prisma P2002 %s target without exposing the constraint", async (field, code) => {
    const client = {
      $transaction: async () => {
        throw { code: "P2002", meta: { target: [field] } };
      },
    } as unknown as PrismaClient;
    await expect(
      new AuthRepository(client).createEmailUser({
        id: authUser().id,
        email: authUser().email,
        passwordHash: "bcrypt-hash",
        firstName: "Test",
        lastName: "User",
        emailVerifiedAt: null,
      }),
    ).rejects.toMatchObject({ code });
  });

  it.each([
    ["email", "DUPLICATE_EMAIL"],
    ["phone", "DUPLICATE_PHONE"],
  ] as const)("maps Prisma 7 driver-adapter %s metadata", async (field, code) => {
    const client = {
      $transaction: async () => {
        throw {
          code: "P2002",
          meta: {
            modelName: "User",
            driverAdapterError: {
              cause: {
                kind: "UniqueConstraintViolation",
                constraint: { fields: [field] },
              },
            },
          },
        };
      },
    } as unknown as PrismaClient;
    await expect(
      new AuthRepository(client).createEmailUser({
        id: authUser().id,
        email: authUser().email,
        passwordHash: "bcrypt-hash",
        firstName: "Test",
        lastName: "User",
        emailVerifiedAt: null,
      }),
    ).rejects.toMatchObject({ code });
  });

  it("forces legacy CUSTOMER and assigns RBAC CUSTOMER during email registration", async () => {
    const createdUser = authUser();
    const userCreate = vi.fn(async (_input: unknown) => createdUser);
    const userRoleCreate = vi.fn(async (_input: unknown) => ({ userId: createdUser.id, roleId: "customer-role" }));
    const verificationCreate = vi.fn(async (_input: unknown) => ({ id: "verification-id" }));
    const tx = {
      role: { findFirst: vi.fn(async () => ({ id: "customer-role" })) },
      user: { findFirst: vi.fn(async () => null), create: userCreate },
      userRole: { create: userRoleCreate },
      emailVerificationToken: { create: verificationCreate },
    };
    const repository = new AuthRepository(callbackClient(tx));
    await repository.createEmailUser({
      id: createdUser.id,
      email: createdUser.email,
      passwordHash: "bcrypt-hash",
      firstName: "Test",
      lastName: "User",
      emailVerifiedAt: null,
      verification: { tokenHash: "a".repeat(64), expiresAt: new Date(Date.now() + 60_000) },
    });
    const userWrite = userCreate.mock.calls[0][0] as { data: Record<string, unknown> };
    expect(userWrite.data).toMatchObject({ role: "CUSTOMER", provider: "EMAIL" });
    expect(userWrite.data).not.toHaveProperty("roles");
    expect(userRoleCreate.mock.calls[0][0]).toMatchObject({
      data: { userId: createdUser.id, roleId: "customer-role" },
    });
    expect(verificationCreate.mock.calls[0][0]).toMatchObject({
      data: { tokenHash: "a".repeat(64), emailSnapshot: createdUser.email },
    });
  });

  it.each(["20123456", "21620123456", "0021620123456", "+21620123456"])(
    "rejects registration when legacy stored phone %s matches the incoming canonical phone",
    async (storedPhone) => {
      const userCreate = vi.fn();
      const findFirst = vi.fn(async (input: { where: { phone: { in: string[] } } }) =>
        input.where.phone.in.includes(storedPhone) ? { id: authUser().id } : null,
      );
      const tx = {
        user: { findFirst, create: userCreate },
        role: { findFirst: vi.fn() },
      };

      await expect(new AuthRepository(callbackClient(tx)).createEmailUser({
        id: authUser().id,
        email: authUser().email,
        phone: "+21620123456",
        passwordHash: "bcrypt-hash",
        firstName: "Test",
        lastName: "User",
        emailVerifiedAt: null,
      })).rejects.toMatchObject({ code: "DUPLICATE_PHONE" });

      expect(findFirst).toHaveBeenCalledWith({
        where: { phone: { in: ["+21620123456", "20123456", "21620123456", "0021620123456"] } },
        select: { id: true },
      });
      expect(userCreate).not.toHaveBeenCalled();
    },
  );

  it("atomically verifies one valid email-bound token", async () => {
    const now = new Date();
    const user = authUser();
    const tokenUpdate = vi.fn(async () => ({ count: 1 }));
    const userUpdate = vi.fn(async () => ({ count: 1 }));
    const tx = {
      emailVerificationToken: {
        findUnique: vi.fn(async () => ({
          id: "token-id",
          userId: user.id,
          emailSnapshot: user.email,
          tokenHash: "a".repeat(64),
          expiresAt: new Date(now.getTime() + 60_000),
          usedAt: null,
          revokedAt: null,
          createdAt: now,
          user,
        })),
        updateMany: tokenUpdate,
      },
      user: { updateMany: userUpdate },
    };
    const result = await new AuthRepository(callbackClient(tx)).consumeVerificationToken(
      "a".repeat(64),
      now,
    );
    expect(result.emailVerifiedAt).toEqual(now);
    expect(tokenUpdate).toHaveBeenCalledWith(
      expect.objectContaining({ where: expect.objectContaining({ usedAt: null, revokedAt: null }) }),
    );
    expect(userUpdate).toHaveBeenCalledWith(
      expect.objectContaining({ where: { id: user.id, email: user.email } }),
    );
  });

  it.each([
    ["expired", { expiresAt: new Date(0) }],
    ["revoked", { revokedAt: new Date() }],
    ["used", { usedAt: new Date() }],
    ["email snapshot mismatch", { emailSnapshot: "old@example.com" }],
  ])("rejects a %s verification token before mutation", async (_case, overrides) => {
    const now = new Date();
    const user = authUser();
    const updateMany = vi.fn(async () => ({ count: 1 }));
    const tx = {
      emailVerificationToken: {
        findUnique: vi.fn(async () => ({
          id: "token-id",
          userId: user.id,
          emailSnapshot: user.email,
          expiresAt: new Date(now.getTime() + 60_000),
          usedAt: null,
          revokedAt: null,
          user,
          ...overrides,
        })),
        updateMany,
      },
      user: { updateMany: vi.fn(async () => ({ count: 1 })) },
    };
    await expect(
      new AuthRepository(callbackClient(tx)).consumeVerificationToken("a".repeat(64), now),
    ).rejects.toBeInstanceOf(AuthRepositoryError);
    expect(updateMany).not.toHaveBeenCalled();
  });

  it("allows only one atomic verification-token update winner", async () => {
    const now = new Date();
    const user = authUser();
    let won = false;
    const tx = {
      emailVerificationToken: {
        findUnique: vi.fn(async () => ({
          id: "token-id",
          userId: user.id,
          emailSnapshot: user.email,
          expiresAt: new Date(now.getTime() + 60_000),
          usedAt: null,
          revokedAt: null,
          user,
        })),
        updateMany: vi.fn(async () => {
          if (won) return { count: 0 };
          won = true;
          return { count: 1 };
        }),
      },
      user: { updateMany: vi.fn(async () => ({ count: 1 })) },
    };
    const repository = new AuthRepository(callbackClient(tx));
    const results = await Promise.allSettled([
      repository.consumeVerificationToken("a".repeat(64), now),
      repository.consumeVerificationToken("a".repeat(64), now),
    ]);
    expect(results.filter((result) => result.status === "fulfilled")).toHaveLength(1);
    expect(results.filter((result) => result.status === "rejected")).toHaveLength(1);
  });

  it("uses every required predicate for atomic refresh rotation", async () => {
    const updateMany = vi.fn(async (_input: unknown) => ({ count: 1 }));
    const client = { authSession: { updateMany } } as unknown as PrismaClient;
    const now = new Date();
    expect(
      await new AuthRepository(client).rotateSessionAtomically({
        sessionId: "session-id",
        userId: "user-id",
        currentHash: "a".repeat(64),
        currentRotation: 2,
        nextHash: "b".repeat(64),
        now,
      }),
    ).toBe(true);
    expect(updateMany.mock.calls[0][0]).toMatchObject({
      where: {
        id: "session-id",
        userId: "user-id",
        refreshTokenHash: "a".repeat(64),
        rotationCounter: 2,
        revokedAt: null,
        expiresAt: { gt: now },
      },
      data: {
        refreshTokenHash: "b".repeat(64),
        rotationCounter: { increment: 1 },
        lastUsedAt: now,
      },
    });
  });

  it("consumes reset, updates the password, revokes other tokens, and revokes all user sessions", async () => {
    const now = new Date();
    const passwordUpdate = vi.fn(async () => authUser());
    const resetUpdate = vi.fn(async (_input: unknown) => ({ count: 1 }));
    const sessionUpdate = vi.fn(async (_input: unknown) => ({ count: 2 }));
    const tx = {
      passwordResetToken: {
        findUnique: vi.fn(async () => ({
          id: "reset-id",
          userId: authUser().id,
          expiresAt: new Date(now.getTime() + 60_000),
          usedAt: null,
          revokedAt: null,
        })),
        updateMany: resetUpdate,
      },
      user: { update: passwordUpdate },
      authSession: { updateMany: sessionUpdate },
    };
    await new AuthRepository(callbackClient(tx)).consumePasswordResetToken({
      tokenHash: "a".repeat(64),
      passwordHash: "new-bcrypt-hash",
      now,
    });
    expect(passwordUpdate).toHaveBeenCalledWith({
      where: { id: authUser().id },
      data: { passwordHash: "new-bcrypt-hash" },
    });
    expect(sessionUpdate).toHaveBeenCalledWith({
      where: { userId: authUser().id, revokedAt: null },
      data: { revokedAt: now, revokeReason: "PASSWORD_RESET" },
    });
  });
});
