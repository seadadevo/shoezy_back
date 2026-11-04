import type { Prisma } from "@prisma/client";

const lifetimeMs = 30 * 24 * 60 * 60 * 1000;
export const guestCartExpiry = (now: Date) => new Date(now.getTime() + lifetimeMs);
const legacyCutoff = (now: Date) => new Date(now.getTime() - lifetimeMs);
export const validGuestCartWhere = (now: Date): Prisma.CartWhereInput => ({ OR: [
  { expiresAt: { gt: now } },
  { expiresAt: null, createdAt: { gt: legacyCutoff(now) } },
] });
export const expiredGuestCartWhere = (now: Date): Prisma.CartWhereInput => ({ OR: [
  { expiresAt: { lte: now } },
  { expiresAt: null, createdAt: { lte: legacyCutoff(now) } },
] });
