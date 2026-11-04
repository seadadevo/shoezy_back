import { describe, expect, it, vi } from "vitest";
import { hashPassword, verifyPassword } from "../../src/common/auth/auth.security";
import { AppError } from "../../src/common/errors/app-error";
import { UsersRepositoryError } from "../../src/modules/users/users.repository";
import { UsersService, type UsersStore } from "../../src/modules/users/users.service";
import type { ProfileRecord } from "../../src/modules/users/users.types";

const userId = "11111111-1111-4111-8111-111111111111";
const sessionId = "22222222-2222-4222-8222-222222222222";

function profile(overrides: Partial<ProfileRecord> = {}): ProfileRecord {
  return {
    id: userId,
    email: "user@example.com",
    phone: "+21620000000",
    firstName: "Test",
    lastName: "User",
    status: "ACTIVE",
    provider: "EMAIL",
    emailVerifiedAt: new Date(),
    phoneVerifiedAt: new Date(),
    lastLoginAt: new Date(),
    createdAt: new Date(),
    updatedAt: new Date(),
    ...overrides,
  };
}

function store(): UsersStore {
  return {
    findProfile: vi.fn(async () => profile()),
    updateProfile: vi.fn(async (_id, input) => profile({ ...input, phoneVerifiedAt: null })),
    findPasswordAccount: vi.fn(async () => ({
      id: userId,
      provider: "EMAIL" as const,
      passwordHash: await hashPassword("current-password-123"),
      status: "ACTIVE" as const,
      deletedAt: null,
    })),
    changePasswordAndRevokeOtherSessions: vi.fn(async () => true),
  };
}

describe("customer profile service", () => {
  it("returns only the explicit safe profile DTO", async () => {
    const result = await new UsersService(store()).getProfile(userId);
    expect(result.id).toBe(userId);
    expect(result).not.toHaveProperty("passwordHash");
    expect(result).not.toHaveProperty("role");
    expect(result).not.toHaveProperty("deletedAt");
  });

  it("updates only the authenticated user's allowed input", async () => {
    const repository = store();
    await new UsersService(repository).updateProfile(userId, {
      firstName: "Updated",
      phone: "+21621111111",
    });
    expect(repository.updateProfile).toHaveBeenCalledWith(userId, {
      firstName: "Updated",
      phone: "+21621111111",
    });
  });

  it("maps a concurrent duplicate phone to a safe conflict", async () => {
    const repository = store();
    vi.mocked(repository.updateProfile).mockRejectedValue(new UsersRepositoryError("DUPLICATE_PHONE"));
    await expect(
      new UsersService(repository).updateProfile(userId, { phone: "+21621111111" }),
    ).rejects.toMatchObject({ statusCode: 409, code: "PROFILE_PHONE_ALREADY_EXISTS" });
  });
});

describe("change password service", () => {
  it("hashes the new password and preserves the current session", async () => {
    const repository = store();
    await new UsersService(repository).changePassword(userId, sessionId, {
      currentPassword: "current-password-123",
      newPassword: "different-password-456",
    });
    const call = vi.mocked(repository.changePasswordAndRevokeOtherSessions).mock.calls[0]?.[0];
    expect(call?.userId).toBe(userId);
    expect(call?.currentSessionId).toBe(sessionId);
    expect(await verifyPassword("different-password-456", call?.passwordHash ?? "")).toBe(true);
    expect(await verifyPassword("current-password-123", call?.passwordHash ?? "")).toBe(false);
  });

  it("rejects a wrong current password", async () => {
    await expect(
      new UsersService(store()).changePassword(userId, sessionId, {
        currentPassword: "incorrect-password-123",
        newPassword: "different-password-456",
      }),
    ).rejects.toMatchObject({ statusCode: 400, code: "AUTH_CURRENT_PASSWORD_INVALID" });
  });

  it("rejects social-only accounts", async () => {
    const repository = store();
    vi.mocked(repository.findPasswordAccount).mockResolvedValue({
      id: userId,
      provider: "GOOGLE",
      passwordHash: null,
      status: "ACTIVE",
      deletedAt: null,
    });
    await expect(
      new UsersService(repository).changePassword(userId, sessionId, {
        currentPassword: "current-password-123",
        newPassword: "different-password-456",
      }),
    ).rejects.toMatchObject({ statusCode: 400, code: "AUTH_PASSWORD_UNAVAILABLE" });
  });

  it("rejects reuse of the current password", async () => {
    const promise = new UsersService(store()).changePassword(userId, sessionId, {
      currentPassword: "current-password-123",
      newPassword: "current-password-123",
    });
    await expect(promise).rejects.toBeInstanceOf(AppError);
    await expect(promise).rejects.toMatchObject({ code: "AUTH_PASSWORD_UNCHANGED" });
  });
});
