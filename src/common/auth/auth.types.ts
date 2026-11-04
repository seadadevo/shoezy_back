import type { PermissionCode } from "./rbac.constants";

export type AuthContext = {
  userId: string;
  sessionId: string;
  roleCodes: string[];
  permissions: PermissionCode[];
};

export type AccessTokenPayload = {
  sub: string;
  sid: string;
  typ: "access";
};

export type RefreshTokenPayload = {
  sub: string;
  sid: string;
  rot: number;
  jti: string;
  typ: "refresh";
};
