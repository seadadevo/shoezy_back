import type { PrismaClient } from "@prisma/client";
import { describe, expect, it, vi } from "vitest";
import { CartsRepository } from "../../src/modules/carts/carts.repository";
import { guestCartExpiry } from "../../src/modules/carts/guest-cart-expiry";
import { cartCleanupJob } from "../../src/jobs/cart-cleanup.job";
import { prisma } from "../../src/config/database";

const variantId = "11111111-1111-4111-8111-111111111111";
const now = new Date("2026-09-22T00:00:00Z");
describe("lazy guest sessions and expiration", () => {
  it("creates the opaque session and first item in one transaction with a 30 day expiry", async () => {
    const tx = {
      productVariant: { findFirst: vi.fn(async () => ({ id: variantId, stockQuantity: 3, priceMinor: 1000n })) },
      cart: { create: vi.fn(async () => ({ id: "cart-id" })) },
      cartItem: { create: vi.fn(async () => ({})) },
    };
    const client = { $transaction: vi.fn(async (work: (transaction: unknown) => Promise<unknown>) => work(tx)) };
    const result = await new CartsRepository(client as unknown as PrismaClient).addFirstGuestItem(variantId, 2, now);
    expect(result.kind).toBe("CREATED");
    if (result.kind === "CREATED") expect(result.sessionToken).toMatch(/^[A-Za-z0-9_-]{43}$/);
    expect(tx.cart.create).toHaveBeenCalledWith({ data: { sessionToken: expect.any(String), status: "ACTIVE", currency: "TND", expiresAt: guestCartExpiry(now) }, select: { id: true } });
    expect(tx.cartItem.create).toHaveBeenCalledWith({ data: expect.objectContaining({ cartId: "cart-id", variantId, quantity: 2 }) });
  });
  it("does not create a session when the variant is unavailable", async () => {
    const tx = { productVariant: { findFirst: vi.fn(async () => null) }, cart: { create: vi.fn() }, cartItem: { create: vi.fn() } };
    const client = { $transaction: vi.fn(async (work: (transaction: unknown) => Promise<unknown>) => work(tx)) };
    expect(await new CartsRepository(client as unknown as PrismaClient).addFirstGuestItem(variantId, 1, now)).toEqual({ kind: "VARIANT_UNAVAILABLE" });
    expect(tx.cart.create).not.toHaveBeenCalled();
  });
  it("requires a nonexpired guest cart and limits cleanup to unreferenced guest carts", async () => {
    const findFirst = vi.fn(async () => null);
    const repo = new CartsRepository({ cart: { findFirst } } as unknown as PrismaClient);
    expect(await repo.validGuestSession("x".repeat(43), now)).toBe(false);
    expect(findFirst).toHaveBeenCalledWith({ where: { sessionToken: "x".repeat(43), userId: null, status: "ACTIVE", OR: [{ expiresAt: { gt: now } }, { expiresAt: null, createdAt: { gt: new Date("2026-08-23T00:00:00Z") } }] }, select: { id: true } });
    const deleteMany = vi.spyOn(prisma.cart, "deleteMany").mockResolvedValue({ count: 2 });
    expect(await cartCleanupJob(now)).toEqual({ count: 2 });
    expect(deleteMany).toHaveBeenCalledWith({ where: { userId: null, status: "ACTIVE", OR: [{ expiresAt: { lte: now } }, { expiresAt: null, createdAt: { lte: new Date("2026-08-23T00:00:00Z") } }], orders: { none: {} } } });
    deleteMany.mockRestore();
  });
});
