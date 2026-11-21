import { randomUUID } from "node:crypto";
import { env } from "../../config/env";
import { AppError } from "../../common/errors/app-error";
import {
  createSessionTokenPair,
  durationToSeconds,
  generateOpaqueToken,
  hashPassword,
  hashToken,
  normalizeEmail,
  signAccessToken, tokenHashesEqual,
  verifyDummyPassword,
  verifyPassword,
  verifyRefreshToken,
} from "../../common/auth/auth.security";
import { toAuthUserDto } from "./auth.dto";
import { AuthRepositoryError } from "./auth.errors";
import { SmtpAuthMailService, type AuthMailService } from "./auth.mail";
import {
  FacebookIdentityVerifier,
  GoogleIdentityVerifier,
  type FacebookTokenVerifier,
  type GoogleTokenVerifier,
} from "./auth.oauth";
import { AuthRepository } from "./auth.repository";
import type { LoginInput, RegisterInput, ResetPasswordInput } from "./auth.validation";
import type { AuthUserRecord, SessionMetadata, VerifiedSocialProfile } from "./auth.types";

const GENERIC_ACCEPTED = { accepted: true } as const;

export interface AuthStore {
  createEmailUser: AuthRepository["createEmailUser"];
  findUserByEmail: AuthRepository["findUserByEmail"];
  findUserByProviderIdentity: AuthRepository["findUserByProviderIdentity"];
  createSocialUser: AuthRepository["createSocialUser"];
  linkSocialAccount: AuthRepository["linkSocialAccount"];
  createSession: AuthRepository["createSession"];
  findSessionForRefresh: AuthRepository["findSessionForRefresh"];
  rotateSessionAtomically: AuthRepository["rotateSessionAtomically"];
  revokeSession: AuthRepository["revokeSession"];
  revokeAllUserSessions: AuthRepository["revokeAllUserSessions"];
  replaceVerificationToken: AuthRepository["replaceVerificationToken"];
  consumeVerificationToken: AuthRepository["consumeVerificationToken"];
  replacePasswordResetToken: AuthRepository["replacePasswordResetToken"];
  consumePasswordResetToken: AuthRepository["consumePasswordResetToken"];
}

export class AuthService {
  constructor(
    private readonly repository: AuthStore = new AuthRepository(),
    private readonly mail: AuthMailService = new SmtpAuthMailService(),
    private readonly google: GoogleTokenVerifier = new GoogleIdentityVerifier(),
    private readonly facebook: FacebookTokenVerifier = new FacebookIdentityVerifier(),
  ) {}

  private expiresAt(duration: string): Date {
    return new Date(Date.now() + durationToSeconds(duration) * 1_000);
  }

  private mapRepositoryError(error: unknown): never {
    if (error instanceof AuthRepositoryError) {
      if (error.code === "DUPLICATE_EMAIL") {
        throw new AppError(409, "An account already uses this email", "AUTH_EMAIL_ALREADY_EXISTS");
      }
      if (error.code === "DUPLICATE_PHONE") {
        throw new AppError(409, "An account already uses this phone", "AUTH_PHONE_ALREADY_EXISTS");
      }
      if (error.code === "DUPLICATE_PROVIDER") {
        throw new AppError(409, "Social identity conflict", "AUTH_SOCIAL_ACCOUNT_CONFLICT");
      }
      if (error.code === "RBAC_ROLE_MISSING") {
        throw new AppError(503, "Required customer role is unavailable", "AUTH_RBAC_ROLE_MISSING");
      }
    }
    throw error;
  }

  private assertUsableUser(user: AuthUserRecord): void {
    if (user.status !== "ACTIVE" || user.deletedAt) {
      throw new AppError(403, "Account is inactive", "AUTH_ACCOUNT_INACTIVE");
    }
  }

  private async startSession(user: AuthUserRecord, metadata: SessionMetadata) {
    this.assertUsableUser(user);
    const pair = createSessionTokenPair(user.id);
    await this.repository.createSession(user.id, {
      id: pair.sessionId,
      refreshTokenHash: pair.refreshTokenHash,
      rotationCounter: pair.rotation,
      expiresAt: this.expiresAt(env.JWT_REFRESH_EXPIRES_IN),
      userAgent: metadata.userAgent?.slice(0, 1_000),
      ipAddress: metadata.ipAddress?.slice(0, 45),
    });
    return { user: toAuthUserDto(user), accessToken: pair.accessToken, refreshToken: pair.refreshToken };
  }

  async register(input: RegisterInput) {
    const email = normalizeEmail(input.email);
    const passwordHash = await hashPassword(input.password);
    const rawVerificationToken = env.AUTH_REQUIRE_EMAIL_VERIFICATION
      ? generateOpaqueToken()
      : undefined;
    try {
      const user = await this.repository.createEmailUser({
        id: randomUUID(),
        email,
        phone: input.phone,
        passwordHash,
        firstName: input.firstName.trim(),
        lastName: input.lastName.trim(),
        emailVerifiedAt: env.AUTH_REQUIRE_EMAIL_VERIFICATION ? null : new Date(),
        verification: rawVerificationToken
          ? {
              tokenHash: hashToken(rawVerificationToken),
              expiresAt: this.expiresAt(env.AUTH_VERIFICATION_TOKEN_EXPIRES_IN),
            }
          : undefined,
      });
      if (rawVerificationToken) {
        try {
          await this.mail.sendEmailVerification(user.email, rawVerificationToken);
        } catch (error: unknown) {
          if (error instanceof AppError) throw error;
          throw new AppError(503, "Email delivery failed", "AUTH_EMAIL_DELIVERY_FAILED");
        }
      }
      return { user: toAuthUserDto(user), verificationRequired: env.AUTH_REQUIRE_EMAIL_VERIFICATION };
    } catch (error: unknown) {
      this.mapRepositoryError(error);
    }
  }

  async verifyEmail(rawToken: string) {
    try {
      const user = await this.repository.consumeVerificationToken(hashToken(rawToken), new Date());
      return { user: toAuthUserDto(user), verified: true };
    } catch (error: unknown) {
      if (error instanceof AuthRepositoryError && error.code === "TOKEN_INVALID") {
        throw new AppError(400, "Verification token is invalid or expired", "AUTH_VERIFICATION_TOKEN_INVALID");
      }
      throw error;
    }
  }

  async resendVerification(emailInput: string) {
    const user = await this.repository.findUserByEmail(normalizeEmail(emailInput));
    if (user?.provider === "EMAIL" && !user.emailVerifiedAt && user.status === "ACTIVE" && !user.deletedAt) {
      const rawToken = generateOpaqueToken();
      await this.repository.replaceVerificationToken({
        userId: user.id,
        email: user.email,
        tokenHash: hashToken(rawToken),
        expiresAt: this.expiresAt(env.AUTH_VERIFICATION_TOKEN_EXPIRES_IN),
      });
      try {
        await this.mail.sendEmailVerification(user.email, rawToken);
      } catch {
        // Preserve account-enumeration resistance; a later resend can recover delivery.
      }
    }
    return GENERIC_ACCEPTED;
  }

  async login(input: LoginInput, metadata: SessionMetadata) {
    const user = await this.repository.findUserByEmail(normalizeEmail(input.email));
    if (!user || !user.passwordHash) {
      await verifyDummyPassword(input.password);
      throw new AppError(401, "Invalid email or password", "AUTH_INVALID_CREDENTIALS");
    }
    const validPassword = await verifyPassword(input.password, user.passwordHash);
    if (!validPassword) {
      throw new AppError(401, "Invalid email or password", "AUTH_INVALID_CREDENTIALS");
    }
    this.assertUsableUser(user);
    if (env.AUTH_REQUIRE_EMAIL_VERIFICATION && !user.emailVerifiedAt) {
      throw new AppError(403, "Email verification is required", "AUTH_EMAIL_NOT_VERIFIED");
    }
    return this.startSession(user, metadata);
  }

  async refresh(rawRefreshToken: string) {
    let payload;
    try {
      payload = verifyRefreshToken(rawRefreshToken);
    } catch {
      throw new AppError(401, "Refresh token is invalid", "AUTH_REFRESH_INVALID");
    }
    const session = await this.repository.findSessionForRefresh(payload.sid);
    const now = new Date();
    if (!session || session.userId !== payload.sub) {
      throw new AppError(401, "Refresh session is invalid", "AUTH_REFRESH_INVALID");
    }
    if (session.revokedAt || session.expiresAt <= now) {
      throw new AppError(401, "Refresh session is expired or revoked", "AUTH_SESSION_EXPIRED");
    }
    this.assertUsableUser(session.user);
    const presentedHash = hashToken(rawRefreshToken);
    const matchesCurrent =
      payload.rot === session.rotationCounter &&
      tokenHashesEqual(presentedHash, session.refreshTokenHash);

    if (matchesCurrent) {
      const nextPair = createSessionTokenPair(session.userId, session.id, session.rotationCounter + 1);
      const rotated = await this.repository.rotateSessionAtomically({
        sessionId: session.id,
        userId: session.userId,
        currentHash: presentedHash,
        currentRotation: session.rotationCounter,
        nextHash: nextPair.refreshTokenHash,
        now,
      });
      if (rotated) {
        return {
          user: toAuthUserDto(session.user),
          accessToken: nextPair.accessToken,
          refreshToken: nextPair.refreshToken,
        };
      }
    }

    // Check if token matches the previously rotated token within the grace period (default 10s)
    const GRACE_MS = Number(process.env.REFRESH_REUSE_GRACE_SECONDS ?? 10) * 1_000;
    const matchesPrevious =
      session.previousRefreshTokenHash &&
      tokenHashesEqual(presentedHash, session.previousRefreshTokenHash);

    const withinGrace =
      Boolean(matchesPrevious) &&
      Boolean(session.rotatedAt) &&
      now.getTime() - session.rotatedAt!.getTime() <= GRACE_MS;

    if (withinGrace) {
      // Legitimate concurrent refresh within grace window: issue new access token without rotating cookie
      return {
        user: toAuthUserDto(session.user),
        accessToken: signAccessToken({ sub: session.userId, sid: session.id, typ: "access" }),
        refreshToken: null,
      };
    }

    await this.repository.revokeSession(session.id, session.userId, "REFRESH_REUSE_DETECTED");
    throw new AppError(401, "Refresh token reuse detected", "AUTH_REFRESH_REUSED");
  }

  async logout(userId: string, sessionId: string): Promise<void> {
    await this.repository.revokeSession(sessionId, userId, "USER_LOGOUT");
  }

  async logoutAll(userId: string): Promise<void> {
    await this.repository.revokeAllUserSessions(userId, "USER_LOGOUT_ALL");
  }

  async forgotPassword(emailInput: string) {
    const user = await this.repository.findUserByEmail(normalizeEmail(emailInput));
    if (user && user.status === "ACTIVE" && !user.deletedAt) {
      const rawToken = generateOpaqueToken();
      await this.repository.replacePasswordResetToken({
        userId: user.id,
        tokenHash: hashToken(rawToken),
        expiresAt: this.expiresAt(env.AUTH_RESET_TOKEN_EXPIRES_IN),
      });
      try {
        await this.mail.sendPasswordReset(user.email, rawToken);
      } catch (err) {
        console.error("[ForgotPassword] Failed to deliver password reset email to:", user.email, err);
      }
    }
    return GENERIC_ACCEPTED;
  }

  async resetPassword(input: ResetPasswordInput): Promise<void> {
    const passwordHash = await hashPassword(input.newPassword);
    try {
      await this.repository.consumePasswordResetToken({
        tokenHash: hashToken(input.token),
        passwordHash,
        now: new Date(),
      });
    } catch (error: unknown) {
      if (error instanceof AuthRepositoryError && error.code === "TOKEN_INVALID") {
        throw new AppError(400, "Reset token is invalid or expired", "AUTH_RESET_TOKEN_INVALID");
      }
      throw error;
    }
  }

  private async socialLogin(profile: VerifiedSocialProfile, metadata: SessionMetadata) {
    const existingIdentity = await this.repository.findUserByProviderIdentity(
      profile.provider,
      profile.providerId,
    );
    if (existingIdentity) return this.startSession(existingIdentity, metadata);
    const email = normalizeEmail(profile.email);
    const existingUser = await this.repository.findUserByEmail(email);
    if (existingUser) {
      const linkedUser = await this.repository.linkSocialAccount(existingUser.id, {
        provider: profile.provider,
        providerId: profile.providerId,
        firstName: profile.firstName,
        lastName: profile.lastName,
      });
      return this.startSession(linkedUser, metadata);
    }
    const userId = randomUUID();
    const pair = createSessionTokenPair(userId);
    try {
      const user = await this.repository.createSocialUser({
        id: userId,
        email,
        firstName: profile.firstName,
        lastName: profile.lastName,
        provider: profile.provider,
        providerId: profile.providerId,
        session: {
          id: pair.sessionId,
          refreshTokenHash: pair.refreshTokenHash,
          rotationCounter: pair.rotation,
          expiresAt: this.expiresAt(env.JWT_REFRESH_EXPIRES_IN),
          userAgent: metadata.userAgent?.slice(0, 1_000),
          ipAddress: metadata.ipAddress?.slice(0, 45),
        },
      });
      return { user: toAuthUserDto(user), accessToken: pair.accessToken, refreshToken: pair.refreshToken };
    } catch (error: unknown) {
      this.mapRepositoryError(error);
    }
  }

  async googleLogin(idToken: string, metadata: SessionMetadata) {
    return this.socialLogin(await this.google.verify(idToken), metadata);
  }

  async facebookLogin(accessToken: string, metadata: SessionMetadata) {
    return this.socialLogin(await this.facebook.verify(accessToken), metadata);
  }
}
