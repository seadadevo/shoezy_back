import type { RequestHandler } from "express";
import { ALL_PERMISSION_CODES, type PermissionCode } from "../auth/rbac.constants";
import { AppError } from "../errors/app-error";

const permissionCatalog = new Set<string>(ALL_PERMISSION_CODES);

function assertKnownPermission(permission: PermissionCode): void {
  if (!permissionCatalog.has(permission)) {
    throw new Error(`Unknown RBAC permission requirement: ${permission}`);
  }
}

export function requirePermission(permission: PermissionCode): RequestHandler {
  assertKnownPermission(permission);
  return (request, _response, next) => {
    if (!request.auth) {
      next(new AppError(401, "Authentication required", "AUTH_UNAUTHORIZED"));
      return;
    }
    if (!request.auth.permissions.includes(permission)) {
      next(new AppError(403, "Permission denied", "AUTH_PERMISSION_DENIED"));
      return;
    }
    next();
  };
}

export function requireAnyPermission(...permissions: PermissionCode[]): RequestHandler {
  if (permissions.length === 0) {
    throw new Error("requireAnyPermission requires at least one permission");
  }
  permissions.forEach(assertKnownPermission);
  return (request, _response, next) => {
    if (!request.auth) {
      next(new AppError(401, "Authentication required", "AUTH_UNAUTHORIZED"));
      return;
    }
    if (!permissions.some((permission) => request.auth?.permissions.includes(permission))) {
      next(new AppError(403, "Permission denied", "AUTH_PERMISSION_DENIED"));
      return;
    }
    next();
  };
}
