import type { RequestHandler } from "express";
import { verifyAccessToken } from "../auth/auth.security";
import { AuthGuardRepository } from "../auth/auth-guard.repository";
import { RbacRepository } from "../auth/rbac.repository";
import { AppError } from "../errors/app-error";

const UUID_PATTERN = /^[0-9a-f]{8}-[0-9a-f]{4}-[1-5][0-9a-f]{3}-[89ab][0-9a-f]{3}-[0-9a-f]{12}$/i;

export interface AuthGuardStore {
  findSession(sessionId: string): ReturnType<AuthGuardRepository["findSession"]>;
}

export interface AuthorizationStore {
  getUserAuthorizationSnapshot(userId: string): ReturnType<RbacRepository["getUserAuthorizationSnapshot"]>;
}

export async function authenticateAccessToken(
  rawToken: string,
  sessions: AuthGuardStore = new AuthGuardRepository(),
  authorization: AuthorizationStore = new RbacRepository(),
) {
  const payload = verifyAccessToken(rawToken);
  if (!UUID_PATTERN.test(payload.sub) || !UUID_PATTERN.test(payload.sid)) {
    throw new AppError(401, "Invalid or expired access token", "AUTH_UNAUTHORIZED");
  }
  const session = await sessions.findSession(payload.sid);
  const now = new Date();
  if (
    !session ||
    session.userId !== payload.sub ||
    session.revokedAt ||
    session.expiresAt <= now ||
    session.user.status !== "ACTIVE" ||
    session.user.deletedAt
  ) {
    throw new AppError(401, "Authentication session is invalid", "AUTH_SESSION_INVALID");
  }
  const snapshot = await authorization.getUserAuthorizationSnapshot(payload.sub);
  return { userId: payload.sub, sessionId: payload.sid, ...snapshot };
}

export function createRequireAuth(
  sessions: AuthGuardStore = new AuthGuardRepository(),
  authorization: AuthorizationStore = new RbacRepository(),
): RequestHandler {
  return async (request, _response, next) => {
    const header = request.headers.authorization;
    if (!header || !/^Bearer [^\s]+$/.test(header)) {
      next(new AppError(401, "Authentication required", "AUTH_UNAUTHORIZED"));
      return;
    }

    try {
      request.auth = await authenticateAccessToken(header.slice(7), sessions, authorization);
      next();
    } catch (error: unknown) {
      if (error instanceof AppError) next(error);
      else next(new AppError(401, "Invalid or expired access token", "AUTH_UNAUTHORIZED"));
    }
  };
}

export const requireAuth = createRequireAuth();
