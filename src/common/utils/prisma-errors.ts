function record(value: unknown): Record<string, unknown> | null {
  return typeof value === "object" && value !== null ? value as Record<string, unknown> : null;
}

function containsPostgresCode(value: unknown, code: string, depth = 0): boolean {
  if (depth > 6) return false;
  const current = record(value);
  if (!current) return false;
  if (current.originalCode === code || current.sqlState === code) return true;
  return Object.values(current).some((entry) => containsPostgresCode(entry, code, depth + 1));
}

export function isCheckConstraintError(error: unknown): boolean {
  const value = record(error);
  return value?.code === "P2004" || containsPostgresCode(error, "23514");
}
