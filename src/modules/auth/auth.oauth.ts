import { OAuth2Client } from "google-auth-library";
import { z } from "zod";
import { env } from "../../config/env";
import { AppError } from "../../common/errors/app-error";
import { normalizeEmail } from "../../common/auth/auth.security";
import type { VerifiedSocialProfile } from "./auth.types";

export interface GoogleTokenVerifier {
  verify(idToken: string): Promise<VerifiedSocialProfile>;
}

export interface FacebookTokenVerifier {
  verify(accessToken: string): Promise<VerifiedSocialProfile>;
}

export class GoogleIdentityVerifier implements GoogleTokenVerifier {
  async verify(idToken: string): Promise<VerifiedSocialProfile> {
    if (!env.GOOGLE_CLIENT_ID) {
      throw new AppError(503, "Google authentication is not configured", "AUTH_PROVIDER_NOT_CONFIGURED");
    }
    try {
      const ticket = await new OAuth2Client(env.GOOGLE_CLIENT_ID).verifyIdToken({
        idToken,
        audience: env.GOOGLE_CLIENT_ID,
      });
      const payload = ticket.getPayload();
      if (!payload?.sub || !payload.email || payload.email_verified !== true) {
        throw new Error("Incomplete Google identity");
      }
      return {
        provider: "GOOGLE",
        providerId: payload.sub,
        email: normalizeEmail(payload.email),
        firstName: payload.given_name?.trim() || "Google",
        lastName: payload.family_name?.trim() || "User",
      };
    } catch (error: unknown) {
      if (error instanceof AppError) throw error;
      throw new AppError(401, "Invalid Google identity token", "AUTH_INVALID_CREDENTIALS");
    }
  }
}

const facebookDebugSchema = z.object({
  data: z.object({
    app_id: z.string(),
    is_valid: z.literal(true),
    user_id: z.string().min(1),
    expires_at: z.number().optional(),
  }),
});
const facebookProfileSchema = z.object({
  id: z.string().min(1),
  email: z.string().email(),
  first_name: z.string().optional(),
  last_name: z.string().optional(),
});

export class FacebookIdentityVerifier implements FacebookTokenVerifier {
  async verify(accessToken: string): Promise<VerifiedSocialProfile> {
    if (!env.FACEBOOK_APP_ID || !env.FACEBOOK_APP_SECRET) {
      throw new AppError(503, "Facebook authentication is not configured", "AUTH_PROVIDER_NOT_CONFIGURED");
    }
    try {
      const debugUrl = new URL("https://graph.facebook.com/debug_token");
      debugUrl.searchParams.set("input_token", accessToken);
      debugUrl.searchParams.set("access_token", `${env.FACEBOOK_APP_ID}|${env.FACEBOOK_APP_SECRET}`);
      const debugResponse = await fetch(debugUrl);
      if (!debugResponse.ok) throw new Error("Facebook token verification failed");
      const debug = facebookDebugSchema.parse(await debugResponse.json());
      if (
        debug.data.app_id !== env.FACEBOOK_APP_ID ||
        (debug.data.expires_at !== undefined && debug.data.expires_at * 1_000 <= Date.now())
      ) {
        throw new Error("Facebook token is not valid for this application");
      }

      const profileUrl = new URL(`https://graph.facebook.com/${encodeURIComponent(debug.data.user_id)}`);
      profileUrl.searchParams.set("fields", "id,email,first_name,last_name");
      profileUrl.searchParams.set("access_token", accessToken);
      const profileResponse = await fetch(profileUrl);
      if (!profileResponse.ok) throw new Error("Facebook profile lookup failed");
      const profile = facebookProfileSchema.parse(await profileResponse.json());
      if (profile.id !== debug.data.user_id) throw new Error("Facebook identity mismatch");
      return {
        provider: "FACEBOOK",
        providerId: profile.id,
        email: normalizeEmail(profile.email),
        firstName: profile.first_name?.trim() || "Facebook",
        lastName: profile.last_name?.trim() || "User",
      };
    } catch (error: unknown) {
      if (error instanceof AppError) throw error;
      throw new AppError(401, "Invalid Facebook access token", "AUTH_INVALID_CREDENTIALS");
    }
  }
}
