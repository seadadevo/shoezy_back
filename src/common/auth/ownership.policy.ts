import type { AuthContext } from "./auth.types";
import type { PermissionCode } from "./rbac.constants";
import { AppError } from "../errors/app-error";

export function assertOwner(auth: AuthContext, ownerUserId: string): void {
  if (auth.userId !== ownerUserId) {
    throw new AppError(403, "Resource ownership required", "AUTH_FORBIDDEN");
  }
}

export function assertOwnerOrPermission(input: {
  auth: AuthContext;
  ownerUserId: string;
  overridePermission: PermissionCode;
}): void {
  if (
    input.auth.userId !== input.ownerUserId &&
    !input.auth.permissions.includes(input.overridePermission)
  ) {
    throw new AppError(403, "Resource ownership or override permission required", "AUTH_FORBIDDEN");
  }
}
