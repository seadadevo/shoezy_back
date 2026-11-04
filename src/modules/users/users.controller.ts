import type { NextFunction, Request, Response } from "express";
import { AppError } from "../../common/errors/app-error";
import { ok } from "../../common/utils/api-response";
import { UsersService } from "./users.service";
import type { ChangePasswordInput, UpdateProfileInput } from "./users.validation";

function authenticated(request: Request) {
  if (!request.auth) throw new AppError(401, "Authentication required", "AUTH_UNAUTHORIZED");
  return request.auth;
}

function validatedBody<T>(request: Request): T {
  if (!request.validated) {
    throw new AppError(500, "Validated request data is unavailable", "VALIDATION_CONTEXT_MISSING");
  }
  return request.validated.body as T;
}

export class UsersController {
  constructor(private readonly service = new UsersService()) {}

  me = async (request: Request, response: Response, next: NextFunction) => {
    try {
      response.json(ok(await this.service.getProfile(authenticated(request).userId)));
    } catch (error: unknown) {
      next(error);
    }
  };

  updateMe = async (request: Request, response: Response, next: NextFunction) => {
    try {
      response.json(
        ok(
          await this.service.updateProfile(
            authenticated(request).userId,
            validatedBody<UpdateProfileInput>(request),
          ),
        ),
      );
    } catch (error: unknown) {
      next(error);
    }
  };

  changePassword = async (request: Request, response: Response, next: NextFunction) => {
    try {
      const auth = authenticated(request);
      await this.service.changePassword(
        auth.userId,
        auth.sessionId,
        validatedBody<ChangePasswordInput>(request),
      );
      response.json(ok({ passwordChanged: true }));
    } catch (error: unknown) {
      next(error);
    }
  };
}
