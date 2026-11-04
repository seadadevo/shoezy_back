import type { AuthProvider, Prisma, UserStatus } from "@prisma/client";

export const authUserSelect = {
  id: true,
  email: true,
  phone: true,
  passwordHash: true,
  firstName: true,
  lastName: true,
  status: true,
  provider: true,
  providerId: true,
  emailVerifiedAt: true,
  deletedAt: true,
} as const satisfies Prisma.UserSelect;

export type AuthUserRecord = Prisma.UserGetPayload<{ select: typeof authUserSelect }>;

export type SessionMetadata = {
  userAgent?: string;
  ipAddress?: string;
};

export type CreateEmailUserData = {
  id: string;
  email: string;
  phone?: string;
  passwordHash: string;
  firstName: string;
  lastName: string;
  emailVerifiedAt: Date | null;
  verification?: { tokenHash: string; expiresAt: Date };
};

export type CreateSocialUserData = {
  id: string;
  email: string;
  firstName: string;
  lastName: string;
  provider: Exclude<AuthProvider, "EMAIL">;
  providerId: string;
  session: CreateSessionData;
};

export type CreateSessionData = SessionMetadata & {
  id: string;
  refreshTokenHash: string;
  expiresAt: Date;
  rotationCounter: number;
};

export type RefreshSessionRecord = {
  id: string;
  userId: string;
  refreshTokenHash: string;
  previousRefreshTokenHash?: string | null;
  rotationCounter: number;
  expiresAt: Date;
  rotatedAt?: Date | null;
  revokedAt: Date | null;
  user: AuthUserRecord;
};

export type VerifiedSocialProfile = {
  provider: Exclude<AuthProvider, "EMAIL">;
  providerId: string;
  email: string;
  firstName: string;
  lastName: string;
};

export type ActiveUserState = {
  status: UserStatus;
  deletedAt: Date | null;
};
