function record(value: unknown): Record<string, unknown> | null {
  return typeof value === "object" && value !== null ? value as Record<string, unknown> : null;
}

export function isSerializableTransactionConflict(error: unknown): boolean {
  const top = record(error);
  if (!top) return false;
  if (top.code === "P2034") return true;
  const cause = record(top.cause);
  if (cause?.kind === "TransactionWriteConflict") return true;
  const meta = record(top.meta);
  const adapter = record(meta?.driverAdapterError);
  return record(adapter?.cause)?.kind === "TransactionWriteConflict";
}
