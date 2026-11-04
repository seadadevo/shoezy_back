export type AuthRepositoryErrorCode =
  | "DUPLICATE_EMAIL"
  | "DUPLICATE_PHONE"
  | "DUPLICATE_PROVIDER"
  | "RBAC_ROLE_MISSING"
  | "TOKEN_INVALID";

export class AuthRepositoryError extends Error {
  constructor(public readonly code: AuthRepositoryErrorCode) {
    super(code);
  }
}

export function isUniqueConstraintError(error: unknown): boolean {
  return (
    typeof error === "object" &&
    error !== null &&
    "code" in error &&
    (error as { code?: unknown }).code === "P2002"
  );
}

export function uniqueConstraintFields(error: unknown): string[] {
  if (
    !isUniqueConstraintError(error) ||
    typeof error !== "object" ||
    error === null ||
    !("meta" in error)
  ) {
    return [];
  }
  const meta = (error as { meta?: unknown }).meta;
  if (typeof meta !== "object" || meta === null) return [];

  if ("target" in meta) {
    const target = (meta as { target?: unknown }).target;
    if (Array.isArray(target)) {
      return target.filter((field): field is string => typeof field === "string");
    }
    if (typeof target === "string") return [target];
  }

  if (!("driverAdapterError" in meta)) return [];
  const adapterError = (meta as { driverAdapterError?: unknown }).driverAdapterError;
  if (typeof adapterError !== "object" || adapterError === null || !("cause" in adapterError)) {
    return [];
  }
  const cause = (adapterError as { cause?: unknown }).cause;
  if (typeof cause !== "object" || cause === null || !("constraint" in cause)) return [];
  const constraint = (cause as { constraint?: unknown }).constraint;
  if (typeof constraint !== "object" || constraint === null || !("fields" in constraint)) return [];
  const fields = (constraint as { fields?: unknown }).fields;
  return Array.isArray(fields)
    ? fields.filter((field): field is string => typeof field === "string")
    : [];
}
