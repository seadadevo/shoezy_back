import type { AuthProvider } from "@prisma/client";

export type AuthUserDto = {
  id: string;
  email: string;
  firstName: string;
  lastName: string;
  provider: AuthProvider;
  emailVerifiedAt: Date | null;
};

export function toAuthUserDto(user: AuthUserDto): AuthUserDto {
  return {
    id: user.id,
    email: user.email,
    firstName: user.firstName,
    lastName: user.lastName,
    provider: user.provider,
    emailVerifiedAt: user.emailVerifiedAt,
  };
}
