import { randomUUID } from "node:crypto";
import { PrismaPg } from "@prisma/adapter-pg";
import { PrismaClient } from "@prisma/client";
import { afterAll, beforeAll, describe, expect, it } from "vitest";
import { hashToken, verifyPassword } from "../../src/common/auth/auth.security";
import { RbacRepository } from "../../src/common/auth/rbac.repository";
import type { AuthMailService } from "../../src/modules/auth/auth.mail";
import type {
  FacebookTokenVerifier,
  GoogleTokenVerifier,
} from "../../src/modules/auth/auth.oauth";
import { AuthRepository } from "../../src/modules/auth/auth.repository";
import { AuthService } from "../../src/modules/auth/auth.service";

const testDatabaseUrl = process.env.TEST_DATABASE_URL;
const describeDatabase = testDatabaseUrl ? describe : describe.skip;

describeDatabase("authentication against disposable PostgreSQL", () => {
  if (!testDatabaseUrl) return;

  const parsedUrl = new URL(testDatabaseUrl);
  const databaseName = parsedUrl.pathname.slice(1);
  if (!new Set(["shoe_store_task04_validation", "shoe_store_tasks05_12_validation", "shoe_store_tasks13_26_validation"]).has(databaseName) || databaseName.includes("shineup")) {
    throw new Error(`Unsafe TEST_DATABASE_URL database: ${databaseName}`);
  }

  const prisma = new PrismaClient({
    adapter: new PrismaPg({ connectionString: testDatabaseUrl }),
  });
  const repository = new AuthRepository(prisma);
  const authorization = new RbacRepository(prisma);
  const createdUserIds: string[] = [];

  beforeAll(async () => {
    const identity = await prisma.$queryRaw<Array<{ database: string }>>`SELECT current_database() AS database`;
    expect(identity[0]?.database).toBe(databaseName);
  });

  afterAll(async () => {
    if (createdUserIds.length > 0) {
      await prisma.user.deleteMany({ where: { id: { in: createdUserIds } } });
    }
    await prisma.$disconnect();
  });

  function testService() {
    const delivered = { verification: [] as string[], reset: [] as string[] };
    const mail: AuthMailService = {
      sendEmailVerification: async (_email, token) => {
        delivered.verification.push(token);
      },
      sendPasswordReset: async (_email, token) => {
        delivered.reset.push(token);
      },
    };
    const google: GoogleTokenVerifier = {
      verify: async () => {
        throw new Error("Google is not called by database E2E tests");
      },
    };
    const facebook: FacebookTokenVerifier = {
      verify: async () => {
        throw new Error("Facebook is not called by database E2E tests");
      },
    };
    return {
      service: new AuthService(repository, mail, google, facebook),
      delivered,
    };
  }

  async function createVerifiedUser() {
    const harness = testService();
    const email = `task04-${randomUUID()}@example.com`;
    const password = "task04-strong-password";
    const registration = await harness.service.register({
      email,
      password,
      firstName: "Task",
      lastName: "Validation",
    });
    createdUserIds.push(registration.user.id);
    const verificationToken = harness.delivered.verification[0];
    expect(verificationToken).toBeDefined();
    await harness.service.verifyEmail(verificationToken);
    return { ...harness, email, password, userId: registration.user.id };
  }

  it("persists registration, CUSTOMER assignment, verification hash, and RBAC snapshot", async () => {
    const harness = testService();
    const email = `task04-${randomUUID()}@example.com`;
    const registration = await harness.service.register({
      email,
      password: "task04-strong-password",
      firstName: "Task",
      lastName: "Registration",
    });
    createdUserIds.push(registration.user.id);

    const persisted = await prisma.user.findUniqueOrThrow({
      where: { id: registration.user.id },
      include: {
        roles: { include: { role: true } },
        emailVerificationTokens: true,
      },
    });
    const rawVerificationToken = harness.delivered.verification[0];
    expect(persisted.role).toBe("CUSTOMER");
    expect(persisted.roles.map(({ role }) => role.code)).toEqual(["CUSTOMER"]);
    expect(persisted.emailVerificationTokens).toHaveLength(1);
    expect(persisted.emailVerificationTokens[0].tokenHash).toBe(hashToken(rawVerificationToken));
    expect(persisted.emailVerificationTokens[0].tokenHash).not.toBe(rawVerificationToken);

    await harness.service.verifyEmail(rawVerificationToken);
    const verification = await prisma.emailVerificationToken.findFirstOrThrow({
      where: { userId: registration.user.id },
    });
    expect(verification.usedAt).not.toBeNull();

    const snapshot = await authorization.getUserAuthorizationSnapshot(registration.user.id);
    expect(snapshot.roleCodes).toEqual(["CUSTOMER"]);
    expect(snapshot.permissions).toHaveLength(18);
    expect(snapshot.permissions.every((permission) => permission.endsWith(".own"))).toBe(true);
  });

  it("maps real PostgreSQL email and phone unique violations distinctly", async () => {
    const harness = testService();
    const email = `task04-${randomUUID()}@example.com`;
    const registration = await harness.service.register({
      email,
      phone: "+201234567890",
      password: "task04-strong-password",
      firstName: "Unique",
      lastName: "Mapping",
    });
    createdUserIds.push(registration.user.id);

    await expect(
      harness.service.register({
        email,
        phone: "+201234567891",
        password: "task04-strong-password",
        firstName: "Duplicate",
        lastName: "Email",
      }),
    ).rejects.toMatchObject({ code: "AUTH_EMAIL_ALREADY_EXISTS" });
    await expect(
      harness.service.register({
        email: `task04-${randomUUID()}@example.com`,
        phone: "+201234567890",
        password: "task04-strong-password",
        firstName: "Duplicate",
        lastName: "Phone",
      }),
    ).rejects.toMatchObject({ code: "AUTH_PHONE_ALREADY_EXISTS" });
  });

  it("persists login sessions, rotates atomically, and revokes on true stale-token replay", async () => {
    const account = await createVerifiedUser();
    const login = await account.service.login(
      { email: account.email, password: account.password },
      { ipAddress: "127.0.0.1", userAgent: "task04-e2e" },
    );
    const originalSession = await prisma.authSession.findFirstOrThrow({
      where: { userId: account.userId },
      orderBy: { createdAt: "desc" },
    });
    expect(originalSession.refreshTokenHash).toBe(hashToken(login.refreshToken));
    expect(originalSession.refreshTokenHash).not.toBe(login.refreshToken);

    const rotated = await account.service.refresh(login.refreshToken);
    const rotatedSession = await prisma.authSession.findUniqueOrThrow({
      where: { id: originalSession.id },
    });
    expect(rotatedSession.rotationCounter).toBe(1);
    expect(rotatedSession.refreshTokenHash).toBe(hashToken(rotated.refreshToken));
    await expect(account.service.refresh(login.refreshToken)).rejects.toMatchObject({
      code: "AUTH_REFRESH_REUSED",
    });
    const staleReplaySession = await prisma.authSession.findUniqueOrThrow({
      where: { id: originalSession.id },
    });
    expect(staleReplaySession.revokedAt).not.toBeNull();
    expect(staleReplaySession.revokeReason).toBe("REFRESH_REUSE_DETECTED");
  });

  it("keeps the winning session active after a real concurrent refresh race", async () => {
    const account = await createVerifiedUser();
    const concurrentLogin = await account.service.login(
      { email: account.email, password: account.password },
      { userAgent: "task04-concurrent-e2e" },
    );
    const concurrentSession = await prisma.authSession.findFirstOrThrow({
      where: { userId: account.userId, userAgent: "task04-concurrent-e2e" },
    });
    const outcomes = await Promise.allSettled([
      account.service.refresh(concurrentLogin.refreshToken),
      account.service.refresh(concurrentLogin.refreshToken),
    ]);
    const winners = outcomes.filter((outcome) => outcome.status === "fulfilled");
    const losers = outcomes.filter((outcome) => outcome.status === "rejected");
    expect(winners).toHaveLength(1);
    expect(losers).toHaveLength(1);
    expect(losers[0]).toMatchObject({ reason: { code: "AUTH_REFRESH_CONFLICT" } });

    const afterRace = await prisma.authSession.findUniqueOrThrow({
      where: { id: concurrentSession.id },
    });
    expect(afterRace.revokedAt).toBeNull();
    expect(afterRace.rotationCounter).toBe(1);

    const winningRefresh = winners[0];
    if (winningRefresh.status !== "fulfilled") throw new Error("Concurrent refresh winner missing");
    await account.service.refresh(winningRefresh.value.refreshToken);
    const afterNextRotation = await prisma.authSession.findUniqueOrThrow({
      where: { id: concurrentSession.id },
    });
    expect(afterNextRotation.revokedAt).toBeNull();
    expect(afterNextRotation.rotationCounter).toBe(2);
  });

  it("atomically consumes a password reset and revokes every session", async () => {
    const account = await createVerifiedUser();
    await account.service.login(
      { email: account.email, password: account.password },
      { userAgent: "task04-reset-e2e" },
    );
    await account.service.forgotPassword(account.email);
    const rawResetToken = account.delivered.reset[0];
    const persistedReset = await prisma.passwordResetToken.findFirstOrThrow({
      where: { userId: account.userId },
      orderBy: { createdAt: "desc" },
    });
    expect(persistedReset.tokenHash).toBe(hashToken(rawResetToken));
    expect(persistedReset.tokenHash).not.toBe(rawResetToken);

    await account.service.resetPassword({
      token: rawResetToken,
      newPassword: "task04-new-strong-password",
    });
    const [user, reset, activeSessions] = await Promise.all([
      prisma.user.findUniqueOrThrow({ where: { id: account.userId } }),
      prisma.passwordResetToken.findUniqueOrThrow({ where: { id: persistedReset.id } }),
      prisma.authSession.count({ where: { userId: account.userId, revokedAt: null } }),
    ]);
    expect(reset.usedAt).not.toBeNull();
    expect(activeSessions).toBe(0);
    expect(user.passwordHash).not.toBeNull();
    expect(await verifyPassword("task04-new-strong-password", user.passwordHash!)).toBe(true);
    await expect(
      account.service.resetPassword({
        token: rawResetToken,
        newPassword: "another-strong-password",
      }),
    ).rejects.toMatchObject({ code: "AUTH_RESET_TOKEN_INVALID" });
  });
});
