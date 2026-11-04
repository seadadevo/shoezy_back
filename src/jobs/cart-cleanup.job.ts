import { prisma } from "../config/database";
import { expiredGuestCartWhere } from "../modules/carts/guest-cart-expiry";

export async function cartCleanupJob(now = new Date()) {
  return prisma.cart.deleteMany({ where: { userId: null, status: "ACTIVE", ...expiredGuestCartWhere(now), orders: { none: {} } } });
}
