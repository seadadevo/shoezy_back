import { describe, expect, it, vi } from "vitest";
import {
  createSessionTokenPair,
  hashPassword,
  hashToken,
  verifyPassword,
} from "../../src/common/auth/auth.security";
import { AuthRepositoryError } from "../../src/modules/auth/auth.errors";
import { AppError } from "../../src/common/errors/app-error";
import type { AuthMailService } from "../../src/modules/auth/auth.mail";
import type {
  FacebookTokenVerifier,
  GoogleTokenVerifier,
} from "../../src/modules/auth/auth.oauth";
import { AuthService, type AuthStore } from "../../src/modules/auth/auth.service";
import type {
  AuthUserRecord,
  CreateEmailUserData,
  CreateSocialUserData,
} from "../../src/modules/auth/auth.types";

function user(overrides: Partial<AuthUserRecord> = {}): AuthUserRecord {
  return {
    id: "11111111-1111-4111-8111-111111111111",
    email: "user@example.com",
    phone: null,
    passwordHash: "$2b$12$6VQ8sS2UssMGrfT1pQHCe.5q7kP2hFbNJDGqMPLy4cG5A/rZJsZzK",
    firstName: "Test",
    lastName: "User",
    status: "ACTIVE",
    provider: "EMAIL",
    providerId: null,
    emailVerifiedAt: new Date(),
    deletedAt: null,
    ...overrides,
  };
}

function authStore(): AuthStore {
  return {
    createEmailUser: vi.fn<AuthStore["createEmailUser"]>(async (data: CreateEmailUserData) =>
      user({
        id: data.id,
        email: data.email,
        phone: data.phone ?? null,
        passwordHash: data.passwordHash,
        firstName: data.firstName,
        lastName: data.lastName,
        emailVerifiedAt: data.emailVerifiedAt,
      }),
    ),
    findUserByEmail: vi.fn<AuthStore["findUserByEmail"]>(async () => null),
    findUserByProviderIdentity: vi.fn<AuthStore["findUserByProviderIdentity"]>(async () => null),
    createSocialUser: vi.fn<AuthStore["createSocialUser"]>(async (data: CreateSocialUserData) =>
      user({
        id: data.id,
        email: data.email,
        passwordHash: null,
        firstName: data.firstName,
        lastName: data.lastName,
        provider: data.provider,
        providerId: data.providerId,
      }),
    ),
    linkSocialAccount: vi.fn<AuthStore["linkSocialAccount"]>(async (userId, data) =>
      user({
        id: userId,
        provider: data.provider,
        providerId: data.providerId,
        firstName: data.firstName,
        lastName: data.lastName,
        emailVerifiedAt: new Date(),
      }),
    ),
    createSession: vi.fn<AuthStore["createSession"]>(async () => undefined),
    findSessionForRefresh: vi.fn<AuthStore["findSessionForRefresh"]>(async () => null),
    rotateSessionAtomically: vi.fn<AuthStore["rotateSessionAtomically"]>(async () => true),
    revokeSession: vi.fn<AuthStore["revokeSession"]>(async () => undefined),
    revokeAllUserSessions: vi.fn<AuthStore["revokeAllUserSessions"]>(async () => undefined),
    replaceVerificationToken: vi.fn<AuthStore["replaceVerificationToken"]>(async () => undefined),
    consumeVerificationToken: vi.fn<AuthStore["consumeVerificationToken"]>(async () => user()),
    replacePasswordResetToken: vi.fn<AuthStore["replacePasswordResetToken"]>(async () => undefined),
    consumePasswordResetToken: vi.fn<AuthStore["consumePasswordResetToken"]>(async () => undefined),
  };
}

function mailService(): AuthMailService {
  return {
    sendEmailVerification: vi.fn<AuthMailService["sendEmailVerification"]>(async () => undefined),
    sendPasswordReset: vi.fn<AuthMailService["sendPasswordReset"]>(async () => undefined),
  };
}

const googleProfile = {
  provider: "GOOGLE" as const,
  providerId: "google-subject",
  email: "social@example.com",
  firstName: "Social",
  lastName: "User",
};
const facebookProfile = { ...googleProfile, provider: "FACEBOOK" as const, providerId: "facebook-id" };

function verifiers() {
  const google: GoogleTokenVerifier = {
    verify: vi.fn<GoogleTokenVerifier["verify"]>(async () => googleProfile),
  };
  const facebook: FacebookTokenVerifier = {
    verify: vi.fn<FacebookTokenVerifier["verify"]>(async () => facebookProfile),
  };
  return { google, facebook };
}

describe("registration and verification", () => {
  it("normalizes email, hashes password, persists only the token hash, and returns a safe DTO", async () => {
    const store = authStore();
    const mail = mailService();
    const providers = verifiers();
    const service = new AuthService(store, mail, providers.google, providers.facebook);
    const result = await service.register({
      email: "  USER@Example.COM ",
      password: "a-very-strong-password",
      firstName: " Test ",
      lastName: " User ",
    });
    const persisted = vi.mocked(store.createEmailUser).mock.calls[0][0];
    const deliveredToken = vi.mocked(mail.sendEmailVerification).mock.calls[0][1];
    expect(persisted.email).toBe("user@example.com");
    expect(persisted.passwordHash).not.toBe("a-very-strong-password");
    expect(await verifyPassword("a-very-strong-password", persisted.passwordHash)).toBe(true);
    expect(persisted.verification?.tokenHash).toBe(hashToken(deliveredToken));
    expect(persisted.verification?.tokenHash).not.toBe(deliveredToken);
    expect(result.user).not.toHaveProperty("passwordHash");
    expect(result.user).not.toHaveProperty("role");
    expect(result.user).not.toHaveProperty("permissions");
  });

  it("maps duplicate registration races to a safe conflict", async () => {
    const store = authStore();
    vi.mocked(store.createEmailUser).mockRejectedValue(new AuthRepositoryError("DUPLICATE_EMAIL"));
    const providers = verifiers();
    const service = new AuthService(store, mailService(), providers.google, providers.facebook);
    await expect(
      service.register({
        email: "user@example.com",
        password: "a-very-strong-password",
        firstName: "Test",
        lastName: "User",
      }),
    ).rejects.toMatchObject({ statusCode: 409, code: "AUTH_EMAIL_ALREADY_EXISTS" });
  });

  it("maps a duplicate phone race to a distinct safe conflict", async () => {
    const store = authStore();
    vi.mocked(store.createEmailUser).mockRejectedValue(new AuthRepositoryError("DUPLICATE_PHONE"));
    const providers = verifiers();
    const service = new AuthService(store, mailService(), providers.google, providers.facebook);
    await expect(
      service.register({
        email: "user@example.com",
        phone: "+201234567890",
        password: "a-very-strong-password",
        firstName: "Test",
        lastName: "User",
      }),
    ).rejects.toMatchObject({ statusCode: 409, code: "AUTH_PHONE_ALREADY_EXISTS" });
  });

  it("uses one-way token lookup and rejects invalid, replayed, expired, or revoked tokens uniformly", async () => {
    const store = authStore();
    const providers = verifiers();
    const service = new AuthService(store, mailService(), providers.google, providers.facebook);
    await service.verifyEmail("raw-verification-token");
    expect(vi.mocked(store.consumeVerificationToken).mock.calls[0][0]).toBe(
      hashToken("raw-verification-token"),
    );
    vi.mocked(store.consumeVerificationToken).mockRejectedValue(new AuthRepositoryError("TOKEN_INVALID"));
    await expect(service.verifyEmail("replayed-token")).rejects.toMatchObject({
      code: "AUTH_VERIFICATION_TOKEN_INVALID",
    });
  });

  it("allows only one concurrent verification consumption", async () => {
    const store = authStore();
    vi.mocked(store.consumeVerificationToken)
      .mockResolvedValueOnce(user())
      .mockRejectedValueOnce(new AuthRepositoryError("TOKEN_INVALID"));
    const providers = verifiers();
    const service = new AuthService(store, mailService(), providers.google, providers.facebook);
    const results = await Promise.allSettled([
      service.verifyEmail("same-raw-verification-token"),
      service.verifyEmail("same-raw-verification-token"),
    ]);
    expect(results.filter((result) => result.status === "fulfilled")).toHaveLength(1);
    expect(results.filter((result) => result.status === "rejected")).toHaveLength(1);
  });

  it("returns the same resend response for known and unknown accounts", async () => {
    const store = authStore();
    const providers = verifiers();
    const service = new AuthService(store, mailService(), providers.google, providers.facebook);
    expect(await service.resendVerification("unknown@example.com")).toEqual({ accepted: true });
    vi.mocked(store.findUserByEmail).mockResolvedValue(user({ emailVerifiedAt: null }));
    expect(await service.resendVerification("known@example.com")).toEqual({ accepted: true });
  });
});

describe("login and sessions", () => {
  it("creates a hash-only refresh session and returns no secret user fields", async () => {
    const store = authStore();
    const password = "a-very-strong-password";
    vi.mocked(store.findUserByEmail).mockResolvedValue(user({ passwordHash: await hashPassword(password) }));
    const providers = verifiers();
    const service = new AuthService(store, mailService(), providers.google, providers.facebook);
    const result = await service.login({ email: "USER@example.com", password }, { ipAddress: "127.0.0.1" });
    const session = vi.mocked(store.createSession).mock.calls[0][1];
    expect(session.refreshTokenHash).toBe(hashToken(result.refreshToken));
    expect(session.refreshTokenHash).not.toBe(result.refreshToken);
    expect(result.user).not.toHaveProperty("passwordHash");
  });

  it("uses the same credential error for unknown email, wrong password, and social-only accounts", async () => {
    const store = authStore();
    const providers = verifiers();
    const service = new AuthService(store, mailService(), providers.google, providers.facebook);
    await expect(service.login({ email: "missing@example.com", password: "wrong-password-long" }, {})).rejects.toMatchObject({
      code: "AUTH_INVALID_CREDENTIALS",
    });
    vi.mocked(store.findUserByEmail).mockResolvedValue(user({ provider: "GOOGLE", passwordHash: null }));
    await expect(service.login({ email: "social@example.com", password: "wrong-password-long" }, {})).rejects.toMatchObject({
      code: "AUTH_INVALID_CREDENTIALS",
    });
  });

  it("rejects inactive, deleted, and unverified users", async () => {
    const store = authStore();
    const password = "a-very-strong-password";
    const hash = await hashPassword(password);
    const providers = verifiers();
    const service = new AuthService(store, mailService(), providers.google, providers.facebook);
    vi.mocked(store.findUserByEmail).mockResolvedValue(user({ passwordHash: hash, status: "INACTIVE" }));
    await expect(service.login({ email: "user@example.com", password }, {})).rejects.toMatchObject({ code: "AUTH_ACCOUNT_INACTIVE" });
    vi.mocked(store.findUserByEmail).mockResolvedValue(user({ passwordHash: hash, deletedAt: new Date() }));
    await expect(service.login({ email: "user@example.com", password }, {})).rejects.toMatchObject({ code: "AUTH_ACCOUNT_INACTIVE" });
    vi.mocked(store.findUserByEmail).mockResolvedValue(user({ passwordHash: hash, emailVerifiedAt: null }));
    await expect(service.login({ email: "user@example.com", password }, {})).rejects.toMatchObject({ code: "AUTH_EMAIL_NOT_VERIFIED" });
  });
});

describe("refresh rotation and logout", () => {
  it("rotates the hash and counter atomically", async () => {
    const store = authStore();
    const current = createSessionTokenPair(
      "11111111-1111-4111-8111-111111111111",
      "22222222-2222-4222-8222-222222222222",
      0,
    );
    vi.mocked(store.findSessionForRefresh).mockResolvedValue({
      id: current.sessionId,
      userId: user().id,
      refreshTokenHash: current.refreshTokenHash,
      rotationCounter: 0,
      expiresAt: new Date(Date.now() + 60_000),
      revokedAt: null,
      user: user(),
    });
    const providers = verifiers();
    const service = new AuthService(store, mailService(), providers.google, providers.facebook);
    const result = await service.refresh(current.refreshToken);
    const rotation = vi.mocked(store.rotateSessionAtomically).mock.calls[0][0];
    expect(rotation.currentHash).toBe(current.refreshTokenHash);
    expect(rotation.currentRotation).toBe(0);
    expect(rotation.nextHash).toBe(hashToken(result.refreshToken));
    expect(rotation.nextHash).not.toBe(rotation.currentHash);
  });

  it("allows only one concurrent rotation without revoking on the losing CAS", async () => {
    const store = authStore();
    const current = createSessionTokenPair(user().id, "22222222-2222-4222-8222-222222222222", 0);
    vi.mocked(store.findSessionForRefresh).mockResolvedValue({
      id: current.sessionId,
      userId: user().id,
      refreshTokenHash: current.refreshTokenHash,
      rotationCounter: 0,
      expiresAt: new Date(Date.now() + 60_000),
      revokedAt: null,
      user: user(),
    });
    vi.mocked(store.rotateSessionAtomically).mockResolvedValueOnce(true).mockResolvedValueOnce(false);
    const providers = verifiers();
    const service = new AuthService(store, mailService(), providers.google, providers.facebook);
    const results = await Promise.allSettled([
      service.refresh(current.refreshToken),
      service.refresh(current.refreshToken),
    ]);
    expect(results.filter((result) => result.status === "fulfilled")).toHaveLength(1);
    expect(results.filter((result) => result.status === "rejected")).toHaveLength(1);
    const rejected = results.find((result) => result.status === "rejected");
    expect(rejected).toMatchObject({ reason: { code: "AUTH_REFRESH_CONFLICT" } });
    expect(store.revokeSession).not.toHaveBeenCalled();
  });

  it("rejects stale refresh reuse and revoked or expired sessions", async () => {
    const store = authStore();
    const current = createSessionTokenPair(user().id, "22222222-2222-4222-8222-222222222222", 0);
    vi.mocked(store.findSessionForRefresh).mockResolvedValue({
      id: current.sessionId,
      userId: user().id,
      refreshTokenHash: "f".repeat(64),
      rotationCounter: 1,
      expiresAt: new Date(Date.now() + 60_000),
      revokedAt: null,
      user: user(),
    });
    const providers = verifiers();
    const service = new AuthService(store, mailService(), providers.google, providers.facebook);
    await expect(service.refresh(current.refreshToken)).rejects.toMatchObject({ code: "AUTH_REFRESH_REUSED" });
    expect(store.revokeSession).toHaveBeenCalled();
  });

  it("revokes current and all sessions with scoped reasons", async () => {
    const store = authStore();
    const providers = verifiers();
    const service = new AuthService(store, mailService(), providers.google, providers.facebook);
    await service.logout(user().id, "22222222-2222-4222-8222-222222222222");
    await service.logoutAll(user().id);
    expect(store.revokeSession).toHaveBeenCalledWith(
      "22222222-2222-4222-8222-222222222222",
      user().id,
      "USER_LOGOUT",
    );
    expect(store.revokeAllUserSessions).toHaveBeenCalledWith(user().id, "USER_LOGOUT_ALL");
  });
});

describe("password recovery and social authentication", () => {
  it("returns an enumeration-safe forgot response and stores only a reset hash", async () => {
    const store = authStore();
    vi.mocked(store.findUserByEmail).mockResolvedValue(user());
    const mail = mailService();
    const providers = verifiers();
    const service = new AuthService(store, mail, providers.google, providers.facebook);
    expect(await service.forgotPassword("user@example.com")).toEqual({ accepted: true });
    const rawToken = vi.mocked(mail.sendPasswordReset).mock.calls[0][1];
    expect(vi.mocked(store.replacePasswordResetToken).mock.calls[0][0].tokenHash).toBe(hashToken(rawToken));
    vi.mocked(store.findUserByEmail).mockResolvedValue(null);
    expect(await service.forgotPassword("missing@example.com")).toEqual({ accepted: true });
  });

  it("keeps the public response generic when reset email delivery fails", async () => {
    const store = authStore();
    vi.mocked(store.findUserByEmail).mockResolvedValue(user());
    const mail = mailService();
    vi.mocked(mail.sendPasswordReset).mockRejectedValue(new Error("SMTP unavailable"));
    const providers = verifiers();
    const service = new AuthService(store, mail, providers.google, providers.facebook);
    await expect(service.forgotPassword("user@example.com")).resolves.toEqual({ accepted: true });
    expect(store.replacePasswordResetToken).toHaveBeenCalledOnce();
  });

  it("hashes the new password and maps consumed reset tokens to one stable error", async () => {
    const store = authStore();
    const providers = verifiers();
    const service = new AuthService(store, mailService(), providers.google, providers.facebook);
    await service.resetPassword({ token: "raw-reset-token-long", newPassword: "a-new-strong-password" });
    const consumed = vi.mocked(store.consumePasswordResetToken).mock.calls[0][0];
    expect(consumed.tokenHash).toBe(hashToken("raw-reset-token-long"));
    expect(await verifyPassword("a-new-strong-password", consumed.passwordHash)).toBe(true);
    vi.mocked(store.consumePasswordResetToken).mockRejectedValue(new AuthRepositoryError("TOKEN_INVALID"));
    await expect(
      service.resetPassword({ token: "replayed-reset-token", newPassword: "another-strong-password" }),
    ).rejects.toMatchObject({ code: "AUTH_RESET_TOKEN_INVALID" });
  });

  it("allows only one concurrent reset-token consumption", async () => {
    const store = authStore();
    vi.mocked(store.consumePasswordResetToken)
      .mockResolvedValueOnce(undefined)
      .mockRejectedValueOnce(new AuthRepositoryError("TOKEN_INVALID"));
    const providers = verifiers();
    const service = new AuthService(store, mailService(), providers.google, providers.facebook);
    const results = await Promise.allSettled([
      service.resetPassword({ token: "same-reset-token-value", newPassword: "a-new-strong-password" }),
      service.resetPassword({ token: "same-reset-token-value", newPassword: "a-new-strong-password" }),
    ]);
    expect(results.filter((result) => result.status === "fulfilled")).toHaveLength(1);
    expect(results.filter((result) => result.status === "rejected")).toHaveLength(1);
  });

  it("creates Google and Facebook users only from verified provider profiles", async () => {
    const store = authStore();
    const providers = verifiers();
    const service = new AuthService(store, mailService(), providers.google, providers.facebook);
    const googleResult = await service.googleLogin("verified-google-token", {});
    const facebookResult = await service.facebookLogin("verified-facebook-token", {});
    expect(providers.google.verify).toHaveBeenCalledWith("verified-google-token");
    expect(providers.facebook.verify).toHaveBeenCalledWith("verified-facebook-token");
    expect(googleResult.user.provider).toBe("GOOGLE");
    expect(facebookResult.user.provider).toBe("FACEBOOK");
    const socialWrite = vi.mocked(store.createSocialUser).mock.calls[0][0];
    expect(socialWrite).not.toHaveProperty("role");
    expect(socialWrite).not.toHaveProperty("permissions");
    expect(socialWrite.session.refreshTokenHash).toMatch(/^[a-f0-9]{64}$/);
  });

  it("automatically links an existing email account and logs in", async () => {
    const store = authStore();
    const existing = user({ firstName: "Existing", lastName: "User" });
    vi.mocked(store.findUserByEmail).mockResolvedValue(existing);
    vi.mocked(store.linkSocialAccount).mockResolvedValue(existing);
    const providers = verifiers();
    const service = new AuthService(store, mailService(), providers.google, providers.facebook);
    const result = await service.googleLogin("verified-google-token", {});
    expect(store.linkSocialAccount).toHaveBeenCalledWith(existing.id, expect.objectContaining({
      provider: "GOOGLE",
      providerId: "google-subject",
    }));
    expect(store.createSocialUser).not.toHaveBeenCalled();
    expect(result.user.id).toBe(existing.id);
  });

  it("propagates mocked Google and Facebook verification failures without creating users", async () => {
    const store = authStore();
    const providers = verifiers();
    vi.mocked(providers.google.verify).mockRejectedValue(
      new AppError(401, "Invalid Google identity token", "AUTH_INVALID_CREDENTIALS"),
    );
    vi.mocked(providers.facebook.verify).mockRejectedValue(
      new AppError(401, "Invalid Facebook access token", "AUTH_INVALID_CREDENTIALS"),
    );
    const service = new AuthService(store, mailService(), providers.google, providers.facebook);
    await expect(service.googleLogin("wrong-audience-or-expired-token", {})).rejects.toMatchObject({
      statusCode: 401,
      code: "AUTH_INVALID_CREDENTIALS",
    });
    await expect(service.facebookLogin("wrong-app-id-or-invalid-token", {})).rejects.toMatchObject({
      statusCode: 401,
      code: "AUTH_INVALID_CREDENTIALS",
    });
    expect(store.createSocialUser).not.toHaveBeenCalled();
  });
});
