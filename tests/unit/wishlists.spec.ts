import { Prisma } from "@prisma/client";
import { describe, expect, it, vi } from "vitest";
import { WishlistsService, type WishlistsStore } from "../../src/modules/wishlists/wishlists.service";
import type { WishlistRecord } from "../../src/modules/wishlists/wishlists.types";
import { addWishlistItemSchema } from "../../src/modules/wishlists/wishlists.validation";

const userId = "11111111-1111-4111-8111-111111111111";
const productId = "22222222-2222-4222-8222-222222222222";
const variantId = "33333333-3333-4333-8333-333333333333";
const wishlistItemId = "44444444-4444-4444-8444-444444444444";
const now = new Date("2026-08-13T12:00:00.000Z");

function record(overrides: Partial<WishlistRecord> = {}): WishlistRecord {
  return {
    id: wishlistItemId,
    userId,
    productId,
    variantId,
    addedAt: now,
    product: {
      id: productId,
      name: "Safe shoe",
      slug: "safe-shoe",
      shortDescription: null,
      basePrice: new Prisma.Decimal("10.000"),
      compareAtPrice: null,
      status: "ACTIVE",
      deletedAt: null,
      publishedAt: new Date("2026-08-12T00:00:00.000Z"),
      brand: { id: "55555555-5555-4555-8555-555555555555", name: "Brand", slug: "brand", isActive: true },
      productCategories: [{ category: { id: "66666666-6666-4666-8666-666666666666", name: "Shoes", slug: "shoes", isActive: true } }],
      variants: [{ id: variantId }],
      media: [],
    },
    variant: { id: variantId, productId, title: "42 / Black", sku: "SAFE-42", priceMinor: 10_000n, compareAtPriceMinor: null, stockQuantity: 2, isActive: true, deletedAt: null },
    ...overrides,
  };
}

function store(item: WishlistRecord = record()): WishlistsStore {
  return {
    list: vi.fn(async () => ({ items: [item], total: 1 })),
    add: vi.fn(async () => item),
    delete: vi.fn(async (_ownerId, id) => id === wishlistItemId),
  };
}

describe("Task 17 Wishlist", () => {
  it("derives ownership from the service argument and returns string money without cost", async () => {
    const repository = store();
    const result = await new WishlistsService(repository).list(userId, { page: 1, limit: 20 }, now);
    expect(repository.list).toHaveBeenCalledWith(userId, { page: 1, limit: 20 });
    expect(result.items[0]?.variant?.priceMinor).toBe("10000");
    expect(JSON.stringify(result)).not.toContain("costMinor");
  });

  it("keeps unavailable rows visible but removes their public Product payload", async () => {
    const unavailable = record({ product: { ...record().product, status: "DRAFT" } });
    const result = await new WishlistsService(store(unavailable)).list(userId, { page: 1, limit: 20 }, now);
    expect(result.items[0]).toMatchObject({ available: false, product: null, variant: null });
  });

  it("uses a stable 404 for a foreign or missing item", async () => {
    await expect(new WishlistsService(store()).delete(userId, "77777777-7777-4777-8777-777777777777")).rejects.toMatchObject({ statusCode: 404, code: "WISHLIST_ITEM_NOT_FOUND" });
  });

  it("rejects mass assignment and invalid identifiers", () => {
    expect(addWishlistItemSchema.safeParse({ body: { productId, userId }, params: {}, query: {} }).success).toBe(false);
    expect(addWishlistItemSchema.safeParse({ body: { productId: "nope" }, params: {}, query: {} }).success).toBe(false);
  });
});
