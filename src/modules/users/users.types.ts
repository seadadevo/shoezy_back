import type { AuthProvider, Prisma, UserStatus } from "@prisma/client";

export const profileSelect = {
  id: true,
  email: true,
  phone: true,
  firstName: true,
  lastName: true,
  status: true,
  provider: true,
  emailVerifiedAt: true,
  phoneVerifiedAt: true,
  lastLoginAt: true,
  createdAt: true,
  updatedAt: true,
} as const satisfies Prisma.UserSelect;

export type ProfileRecord = Prisma.UserGetPayload<{ select: typeof profileSelect }>;

export type PasswordAccountRecord = {
  id: string;
  provider: AuthProvider;
  passwordHash: string | null;
  status: UserStatus;
  deletedAt: Date | null;
};
