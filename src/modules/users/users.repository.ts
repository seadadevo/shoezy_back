import type { PrismaClient } from "@prisma/client";
import { prisma } from "../../config/database";
import { isUniqueConstraintError } from "../auth/auth.errors";
import { tunisianPhoneEquivalentValues } from "../../common/validation/tunisian-phone";
import { profileSelect, type PasswordAccountRecord, type ProfileRecord } from "./users.types";
import type { UpdateProfileInput } from "./users.validation";

export class UsersRepositoryError extends Error {
  constructor(public readonly code: "DUPLICATE_PHONE") {
    super(code);
  }
}

export class UsersRepository {
  constructor(private readonly client: PrismaClient = prisma) {}

  findProfile(userId: string): Promise<ProfileRecord | null> {
    return this.client.user.findFirst({
      where: { id: userId, deletedAt: null },
      select: profileSelect,
    });
  }

  async updateProfile(userId: string, input: UpdateProfileInput): Promise<ProfileRecord | null> {
    try {
      if (typeof input.phone === "string") {
        const duplicatePhone = await this.client.user.findFirst({
          where: {
            id: { not: userId },
            phone: { in: tunisianPhoneEquivalentValues(input.phone) },
          },
          select: { id: true },
        });
        if (duplicatePhone) throw new UsersRepositoryError("DUPLICATE_PHONE");
      }
      const result = await this.client.user.updateMany({
        where: { id: userId, deletedAt: null },
        data: {
          firstName: input.firstName,
          lastName: input.lastName,
          phone: input.phone,
          ...(input.phone !== undefined ? { phoneVerifiedAt: null } : {}),
        },
      });
      return result.count === 1 ? this.findProfile(userId) : null;
    } catch (error: unknown) {
      if (isUniqueConstraintError(error)) throw new UsersRepositoryError("DUPLICATE_PHONE");
      throw error;
    }
  }

  findPasswordAccount(userId: string): Promise<PasswordAccountRecord | null> {
    return this.client.user.findUnique({
      where: { id: userId },
      select: { id: true, provider: true, passwordHash: true, status: true, deletedAt: true },
    });
  }

  async changePasswordAndRevokeOtherSessions(input: {
    userId: string;
    currentSessionId: string;
    passwordHash: string;
  }): Promise<boolean> {
    return this.client.$transaction(async (transaction) => {
      const updated = await transaction.user.updateMany({
        where: { id: input.userId, status: "ACTIVE", deletedAt: null },
        data: { passwordHash: input.passwordHash },
      });
      if (updated.count !== 1) return false;
      await transaction.authSession.updateMany({
        where: {
          userId: input.userId,
          id: { not: input.currentSessionId },
          revokedAt: null,
        },
        data: { revokedAt: new Date(), revokeReason: "PASSWORD_CHANGED" },
      });
      return true;
    });
  }
}
