import type { Prisma, PrismaClient } from "@prisma/client";
import { prisma } from "../../config/database";
import { SYSTEM_ROLES } from "../../common/auth/rbac.constants";
import { tunisianPhoneEquivalentValues } from "../../common/validation/tunisian-phone";
import {
  AuthRepositoryError,
  isUniqueConstraintError,
  uniqueConstraintFields,
} from "./auth.errors";
import {
  authUserSelect,
  type AuthUserRecord,
  type CreateEmailUserData,
  type CreateSessionData,
  type CreateSocialUserData,
  type RefreshSessionRecord,
} from "./auth.types";

type TransactionClient = Prisma.TransactionClient;

function throwMappedUniqueError(error: unknown): never {
  if (isUniqueConstraintError(error)) {
    const fields = uniqueConstraintFields(error);
    if (fields.some((field) => field === "phone" || field.endsWith("_phone_key"))) {
      throw new AuthRepositoryError("DUPLICATE_PHONE");
    }
    if (fields.some((field) => field === "email" || field.endsWith("_email_key"))) {
      throw new AuthRepositoryError("DUPLICATE_EMAIL");
    }
  }
  throw error;
}

async function requireCustomerRole(tx: TransactionClient) {
  const role = await tx.role.findFirst({
    where: { code: SYSTEM_ROLES.CUSTOMER, isActive: true },
    select: { id: true },
  });
  if (!role) throw new AuthRepositoryError("RBAC_ROLE_MISSING");
  return role;
}

export class AuthRepository {
  constructor(private readonly client: PrismaClient = prisma) {}

  findUserByEmail(email: string): Promise<AuthUserRecord | null> {
    return this.client.user.findUnique({ where: { email }, select: authUserSelect });
  }

  findUserByProviderIdentity(
    provider: "GOOGLE" | "FACEBOOK",
    providerId: string,
  ): Promise<AuthUserRecord | null> {
    return this.client.user.findUnique({
      where: { provider_providerId: { provider, providerId } },
      select: authUserSelect,
    });
  }

  async linkSocialAccount(
    userId: string,
    data: {
      provider: "GOOGLE" | "FACEBOOK";
      providerId: string;
      firstName?: string;
      lastName?: string;
    },
  ): Promise<AuthUserRecord> {
    const existing = await this.client.user.findUnique({
      where: { id: userId },
      select: authUserSelect,
    });
    if (!existing) {
      throw new AuthRepositoryError("TOKEN_INVALID");
    }

    const updated = await this.client.user.update({
      where: { id: userId },
      data: {
        provider: data.provider,
        providerId: data.providerId,
        emailVerifiedAt: existing.emailVerifiedAt ?? new Date(),
        firstName: existing.firstName && existing.firstName.trim().length > 0 ? existing.firstName : (data.firstName?.trim() || existing.firstName),
        lastName: existing.lastName && existing.lastName.trim().length > 0 ? existing.lastName : (data.lastName?.trim() || existing.lastName),
        lastLoginAt: new Date(),
      },
      select: authUserSelect,
    });

    return updated;
  }

  async createEmailUser(data: CreateEmailUserData): Promise<AuthUserRecord> {
    try {
      return await this.client.$transaction(async (tx) => {
        if (data.phone) {
          const duplicatePhone = await tx.user.findFirst({
            where: { phone: { in: tunisianPhoneEquivalentValues(data.phone) } },
            select: { id: true },
          });
          if (duplicatePhone) throw new AuthRepositoryError("DUPLICATE_PHONE");
        }
        const customerRole = await requireCustomerRole(tx);
        const user = await tx.user.create({
          data: {
            id: data.id,
            email: data.email,
            phone: data.phone,
            passwordHash: data.passwordHash,
            firstName: data.firstName,
            lastName: data.lastName,
            status: "ACTIVE",
            role: "CUSTOMER",
            provider: "EMAIL",
            emailVerifiedAt: data.emailVerifiedAt,
          },
          select: authUserSelect,
        });
        await tx.userRole.create({ data: { userId: user.id, roleId: customerRole.id } });
        if (data.verification) {
          await tx.emailVerificationToken.create({
            data: {
              userId: user.id,
              emailSnapshot: user.email,
              tokenHash: data.verification.tokenHash,
              expiresAt: data.verification.expiresAt,
            },
          });
        }
        return user;
      });
    } catch (error: unknown) {
      throwMappedUniqueError(error);
    }
  }

  async createSocialUser(data: CreateSocialUserData): Promise<AuthUserRecord> {
    try {
      return await this.client.$transaction(async (tx) => {
        const customerRole = await requireCustomerRole(tx);
        const user = await tx.user.create({
          data: {
            id: data.id,
            email: data.email,
            passwordHash: null,
            firstName: data.firstName,
            lastName: data.lastName,
            status: "ACTIVE",
            role: "CUSTOMER",
            provider: data.provider,
            providerId: data.providerId,
            emailVerifiedAt: new Date(),
          },
          select: authUserSelect,
        });
        await tx.userRole.create({ data: { userId: user.id, roleId: customerRole.id } });
        await tx.authSession.create({ data: { ...data.session, userId: user.id } });
        await tx.user.update({ where: { id: user.id }, data: { lastLoginAt: new Date() } });
        return user;
      });
    } catch (error: unknown) {
      if (isUniqueConstraintError(error)) throw new AuthRepositoryError("DUPLICATE_PROVIDER");
      throw error;
    }
  }

  async createSession(userId: string, data: CreateSessionData): Promise<void> {
    await this.client.$transaction([
      this.client.authSession.create({ data: { ...data, userId } }),
      this.client.user.update({ where: { id: userId }, data: { lastLoginAt: new Date() } }),
    ]);
  }

  findSessionForRefresh(sessionId: string): Promise<RefreshSessionRecord | null> {
    return this.client.authSession.findUnique({
      where: { id: sessionId },
      select: {
        id: true,
        userId: true,
        refreshTokenHash: true,
        previousRefreshTokenHash: true,
        rotationCounter: true,
        expiresAt: true,
        rotatedAt: true,
        revokedAt: true,
        user: { select: authUserSelect },
      },
    });
  }

  async rotateSessionAtomically(input: {
    sessionId: string;
    userId: string;
    currentHash: string;
    currentRotation: number;
    nextHash: string;
    now: Date;
  }): Promise<boolean> {
    const result = await this.client.authSession.updateMany({
      where: {
        id: input.sessionId,
        userId: input.userId,
        refreshTokenHash: input.currentHash,
        rotationCounter: input.currentRotation,
        revokedAt: null,
        expiresAt: { gt: input.now },
      },
      data: {
        refreshTokenHash: input.nextHash,
        previousRefreshTokenHash: input.currentHash,
        rotationCounter: { increment: 1 },
        rotatedAt: input.now,
        lastUsedAt: input.now,
      },
    });
    return result.count === 1;
  }

  async revokeSession(sessionId: string, userId: string, reason: string): Promise<void> {
    await this.client.authSession.updateMany({
      where: { id: sessionId, userId, revokedAt: null },
      data: { revokedAt: new Date(), revokeReason: reason },
    });
  }

  async revokeAllUserSessions(userId: string, reason: string): Promise<void> {
    await this.client.authSession.updateMany({
      where: { userId, revokedAt: null },
      data: { revokedAt: new Date(), revokeReason: reason },
    });
  }

  async replaceVerificationToken(input: {
    userId: string;
    email: string;
    tokenHash: string;
    expiresAt: Date;
  }): Promise<void> {
    await this.client.$transaction(async (tx) => {
      await tx.emailVerificationToken.updateMany({
        where: { userId: input.userId, usedAt: null, revokedAt: null },
        data: { revokedAt: new Date() },
      });
      await tx.emailVerificationToken.create({
        data: {
          userId: input.userId,
          emailSnapshot: input.email,
          tokenHash: input.tokenHash,
          expiresAt: input.expiresAt,
        },
      });
    });
  }

  async consumeVerificationToken(tokenHash: string, now: Date): Promise<AuthUserRecord> {
    return this.client.$transaction(async (tx) => {
      const token = await tx.emailVerificationToken.findUnique({
        where: { tokenHash },
        include: { user: { select: authUserSelect } },
      });
      if (
        !token ||
        token.usedAt ||
        token.revokedAt ||
        token.expiresAt <= now ||
        token.emailSnapshot !== token.user.email
      ) {
        throw new AuthRepositoryError("TOKEN_INVALID");
      }
      const consumed = await tx.emailVerificationToken.updateMany({
        where: { id: token.id, usedAt: null, revokedAt: null, expiresAt: { gt: now } },
        data: { usedAt: now },
      });
      if (consumed.count !== 1) throw new AuthRepositoryError("TOKEN_INVALID");
      const verified = await tx.user.updateMany({
        where: { id: token.userId, email: token.emailSnapshot },
        data: { emailVerifiedAt: now },
      });
      if (verified.count !== 1) throw new AuthRepositoryError("TOKEN_INVALID");
      return { ...token.user, emailVerifiedAt: now };
    });
  }

  async replacePasswordResetToken(input: {
    userId: string;
    tokenHash: string;
    expiresAt: Date;
  }): Promise<void> {
    await this.client.$transaction(async (tx) => {
      await tx.passwordResetToken.updateMany({
        where: { userId: input.userId, usedAt: null, revokedAt: null },
        data: { revokedAt: new Date() },
      });
      await tx.passwordResetToken.create({ data: input });
    });
  }

  async consumePasswordResetToken(input: {
    tokenHash: string;
    passwordHash: string;
    now: Date;
  }): Promise<void> {
    await this.client.$transaction(async (tx) => {
      const token = await tx.passwordResetToken.findUnique({ where: { tokenHash: input.tokenHash } });
      if (!token || token.usedAt || token.revokedAt || token.expiresAt <= input.now) {
        throw new AuthRepositoryError("TOKEN_INVALID");
      }
      const consumed = await tx.passwordResetToken.updateMany({
        where: { id: token.id, usedAt: null, revokedAt: null, expiresAt: { gt: input.now } },
        data: { usedAt: input.now },
      });
      if (consumed.count !== 1) throw new AuthRepositoryError("TOKEN_INVALID");
      await tx.user.update({ where: { id: token.userId }, data: { passwordHash: input.passwordHash } });
      await tx.passwordResetToken.updateMany({
        where: { userId: token.userId, id: { not: token.id }, usedAt: null, revokedAt: null },
        data: { revokedAt: input.now },
      });
      await tx.authSession.updateMany({
        where: { userId: token.userId, revokedAt: null },
        data: { revokedAt: input.now, revokeReason: "PASSWORD_RESET" },
      });
    });
  }
}
