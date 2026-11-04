import type { ProfileRecord } from "./users.types";

export type ProfileDto = ProfileRecord;

export function toProfileDto(user: ProfileRecord): ProfileDto {
  return {
    id: user.id,
    email: user.email,
    phone: user.phone,
    firstName: user.firstName,
    lastName: user.lastName,
    status: user.status,
    provider: user.provider,
    emailVerifiedAt: user.emailVerifiedAt,
    phoneVerifiedAt: user.phoneVerifiedAt,
    lastLoginAt: user.lastLoginAt,
    createdAt: user.createdAt,
    updatedAt: user.updatedAt,
  };
}
