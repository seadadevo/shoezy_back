import { hashPassword, verifyPassword } from "../../common/auth/auth.security";
import { AppError } from "../../common/errors/app-error";
import { toProfileDto } from "./users.dto";
import { UsersRepository, UsersRepositoryError } from "./users.repository";
import type { ChangePasswordInput, UpdateProfileInput } from "./users.validation";

export interface UsersStore {
  findProfile: UsersRepository["findProfile"];
  updateProfile: UsersRepository["updateProfile"];
  findPasswordAccount: UsersRepository["findPasswordAccount"];
  changePasswordAndRevokeOtherSessions: UsersRepository["changePasswordAndRevokeOtherSessions"];
}

export class UsersService {
  constructor(private readonly repository: UsersStore = new UsersRepository()) {}

  async getProfile(userId: string) {
    const user = await this.repository.findProfile(userId);
    if (!user) throw new AppError(404, "User not found", "USER_NOT_FOUND");
    return toProfileDto(user);
  }

  async updateProfile(userId: string, input: UpdateProfileInput) {
    try {
      const current = await this.repository.findProfile(userId);
      if (!current) throw new AppError(404, "User not found", "USER_NOT_FOUND");
      const normalizedInput = {
        ...input,
        phone: input.phone === current.phone ? undefined : input.phone,
      };
      const user = await this.repository.updateProfile(userId, normalizedInput);
      if (!user) throw new AppError(404, "User not found", "USER_NOT_FOUND");
      return toProfileDto(user);
    } catch (error: unknown) {
      if (error instanceof UsersRepositoryError && error.code === "DUPLICATE_PHONE") {
        throw new AppError(409, "An account already uses this phone", "PROFILE_PHONE_ALREADY_EXISTS");
      }
      throw error;
    }
  }

  async changePassword(
    userId: string,
    currentSessionId: string,
    input: ChangePasswordInput,
  ): Promise<void> {
    const account = await this.repository.findPasswordAccount(userId);
    if (!account || account.status !== "ACTIVE" || account.deletedAt) {
      throw new AppError(404, "User not found", "USER_NOT_FOUND");
    }
    if (account.provider !== "EMAIL" || !account.passwordHash) {
      throw new AppError(
        400,
        "Password changes are unavailable for this account",
        "AUTH_PASSWORD_UNAVAILABLE",
      );
    }
    if (!(await verifyPassword(input.currentPassword, account.passwordHash))) {
      throw new AppError(400, "Current password is incorrect", "AUTH_CURRENT_PASSWORD_INVALID");
    }
    if (await verifyPassword(input.newPassword, account.passwordHash)) {
      throw new AppError(400, "New password must differ from current password", "AUTH_PASSWORD_UNCHANGED");
    }
    const changed = await this.repository.changePasswordAndRevokeOtherSessions({
      userId,
      currentSessionId,
      passwordHash: await hashPassword(input.newPassword),
    });
    if (!changed) throw new AppError(404, "User not found", "USER_NOT_FOUND");
  }
}
