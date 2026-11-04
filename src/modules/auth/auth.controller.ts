import type { NextFunction, Request, Response } from "express";
import { env } from "../../config/env";
import { clearRefreshCookie, setRefreshCookie } from "../../common/auth/auth.cookie";
import { AppError } from "../../common/errors/app-error";
import { ok } from "../../common/utils/api-response";
import { AuthService } from "./auth.service";
import type { LoginInput, RegisterInput, ResetPasswordInput } from "./auth.validation";

type BodyRequest<T> = Request<Record<string, never>, unknown, T>;

function validatedBody<T>(request: Request): T {
  if (!request.validated) {
    throw new AppError(500, "Validated request data is unavailable", "VALIDATION_CONTEXT_MISSING");
  }
  return request.validated.body as T;
}

function sessionMetadata(request: Request) {
  return { userAgent: request.get("user-agent"), ipAddress: request.ip };
}

function refreshCookie(request: Request): string {
  const cookies: unknown = request.cookies;
  if (typeof cookies !== "object" || cookies === null) {
    throw new AppError(401, "Refresh token is required", "AUTH_REFRESH_INVALID");
  }
  const value = (cookies as Record<string, unknown>)[env.AUTH_REFRESH_COOKIE_NAME];
  if (typeof value !== "string" || value.length === 0) {
    throw new AppError(401, "Refresh token is required", "AUTH_REFRESH_INVALID");
  }
  return value;
}

function authenticated(request: Request) {
  if (!request.auth) throw new AppError(401, "Authentication required", "AUTH_UNAUTHORIZED");
  return request.auth;
}

export class AuthController {
  constructor(private readonly service = new AuthService()) {}

  register = async (request: BodyRequest<RegisterInput>, response: Response, next: NextFunction) => {
    try {
      response.status(201).json(ok(await this.service.register(validatedBody<RegisterInput>(request))));
    } catch (error: unknown) {
      next(error);
    }
  };

  verifyEmail = async (
    request: BodyRequest<{ token: string }>,
    response: Response,
    next: NextFunction,
  ) => {
    try {
      response.json(ok(await this.service.verifyEmail(validatedBody<{ token: string }>(request).token)));
    } catch (error: unknown) {
      next(error);
    }
  };

  resendVerification = async (
    request: BodyRequest<{ email: string }>,
    response: Response,
    next: NextFunction,
  ) => {
    try {
      response
        .status(202)
        .json(ok(await this.service.resendVerification(validatedBody<{ email: string }>(request).email)));
    } catch (error: unknown) {
      next(error);
    }
  };

  login = async (request: BodyRequest<LoginInput>, response: Response, next: NextFunction) => {
    try {
      const result = await this.service.login(validatedBody<LoginInput>(request), sessionMetadata(request));
      setRefreshCookie(response, result.refreshToken);
      response.json(ok({ user: result.user, accessToken: result.accessToken }));
    } catch (error: unknown) {
      next(error);
    }
  };

  refresh = async (request: Request, response: Response, next: NextFunction) => {
    try {
      const result = await this.service.refresh(refreshCookie(request));
      if (result.refreshToken) {
        setRefreshCookie(response, result.refreshToken);
      }
      response.json(ok({ user: result.user, accessToken: result.accessToken }));
    } catch (error: unknown) {
      next(error);
    }
  };

  logout = async (request: Request, response: Response, next: NextFunction) => {
    try {
      const auth = authenticated(request);
      await this.service.logout(auth.userId, auth.sessionId);
      clearRefreshCookie(response);
      response.json(ok({ loggedOut: true }));
    } catch (error: unknown) {
      next(error);
    }
  };

  logoutAll = async (request: Request, response: Response, next: NextFunction) => {
    try {
      const auth = authenticated(request);
      await this.service.logoutAll(auth.userId);
      clearRefreshCookie(response);
      response.json(ok({ loggedOut: true }));
    } catch (error: unknown) {
      next(error);
    }
  };

  forgotPassword = async (
    request: BodyRequest<{ email: string }>,
    response: Response,
    next: NextFunction,
  ) => {
    try {
      response
        .status(202)
        .json(ok(await this.service.forgotPassword(validatedBody<{ email: string }>(request).email)));
    } catch (error: unknown) {
      next(error);
    }
  };

  resetPassword = async (
    request: BodyRequest<ResetPasswordInput>,
    response: Response,
    next: NextFunction,
  ) => {
    try {
      await this.service.resetPassword(validatedBody<ResetPasswordInput>(request));
      response.json(ok({ passwordReset: true }));
    } catch (error: unknown) {
      next(error);
    }
  };

  google = async (
    request: BodyRequest<{ idToken: string }>,
    response: Response,
    next: NextFunction,
  ) => {
    try {
      const result = await this.service.googleLogin(
        validatedBody<{ idToken: string }>(request).idToken,
        sessionMetadata(request),
      );
      setRefreshCookie(response, result.refreshToken);
      response.json(ok({ user: result.user, accessToken: result.accessToken }));
    } catch (error: unknown) {
      next(error);
    }
  };

  facebook = async (
    request: BodyRequest<{ accessToken: string }>,
    response: Response,
    next: NextFunction,
  ) => {
    try {
      const result = await this.service.facebookLogin(
        validatedBody<{ accessToken: string }>(request).accessToken,
        sessionMetadata(request),
      );
      setRefreshCookie(response, result.refreshToken);
      response.json(ok({ user: result.user, accessToken: result.accessToken }));
    } catch (error: unknown) {
      next(error);
    }
  };
}
