import { createHash } from "node:crypto";
import type { PrismaClient } from "@prisma/client";
import { describe, expect, it, vi } from "vitest";
import { CartsRepository } from "../../src/modules/carts/carts.repository";
import { CheckoutRepository } from "../../src/modules/checkout/checkout.repository";
import { guestCheckoutAddress, guestCheckoutPreviewSchema } from "../../src/modules/checkout/guest-checkout.validation";
import { OrdersRepository } from "../../src/modules/orders/orders.repository";
import { OrdersService } from "../../src/modules/orders/orders.service";
import { CommercePricingService } from "../../src/services/commerce-pricing.service";
import { DiscountsRepository } from "../../src/modules/discounts/discounts.repository";

const tokenA = "A".repeat(43);
const tokenB = "B".repeat(43);
const variantId = "22222222-2222-4222-8222-222222222222";
const shippingMethodId = "33333333-3333-4333-8333-333333333333";
const input = { firstName: "Amira", lastName: "Ben Ali", phone: "+21620123456", addressLine1: "Rue 1", city: "Tunis", state: "Tunis", countryCode: "TN" as const, shippingMethodId };

describe("guest cart and checkout repository", () => {
  it("keeps session ownership separate and does not attach a User", async () => {
    const cart = { id: "cart-id", userId: null, items: [], currency: "TND", discountCode: null };
    const tx = {
      $queryRaw: vi.fn(async () => []),
      cart: { findFirst: vi.fn(async ({ where }: { where: { sessionToken?: string; userId?: string | null } }) => where.sessionToken === tokenA && where.userId === null ? cart : null), findUniqueOrThrow: vi.fn(async () => cart), update: vi.fn(async () => cart) },
      productVariant: { findFirst: vi.fn(async () => ({ id: variantId, stockQuantity: 5, priceMinor: 1000n })) },
      cartItem: { create: vi.fn(async () => ({})) },
    };
    const client = { $transaction: vi.fn(async (operation: (value: typeof tx) => Promise<unknown>) => operation(tx)) };
    const repository = new CartsRepository(client as unknown as PrismaClient);
    expect(await repository.addItem({ sessionToken: tokenB }, variantId, 1, new Date())).toBe("CART_SESSION_INVALID");
    expect(tx.cartItem.create).not.toHaveBeenCalled();
    expect(await repository.addItem({ sessionToken: tokenA }, variantId, 1, new Date())).toBe(cart);
    expect(tx.cart.findFirst).toHaveBeenCalledWith({ where: { sessionToken: tokenA, userId: null, status: "ACTIVE", OR: expect.any(Array) }, select: expect.any(Object) });
    expect(tx.cartItem.create).toHaveBeenCalledWith({ data: expect.objectContaining({ cartId: "cart-id", variantId, quantity: 1 }) });
  });

  function checkoutClient(zoneExists: boolean, areaMatches: boolean) {
    const cart = { id: "cart-id", currency: "TND", discountCode: null, items: [{ variantId, quantity: 2, variant: { productId: "product-id", priceMinor: 10_000n, stockQuantity: 5, isActive: true, deletedAt: null, product: { status: "ACTIVE", deletedAt: null, publishedAt: new Date("2026-01-01"), brand: { isActive: true }, productCategories: [{ category: { id: "category-id", isActive: true } }] } } }] };
    const tx = {
      shippingMethod: { findFirst: vi.fn(async () => ({ id: shippingMethodId, code: "HOME", name: "Home", currency: "TND", basePriceMinor: 999n, estimatedMinDays: null, estimatedMaxDays: null })) },
      cart: { findFirst: vi.fn(async () => cart) },
      shippingZone: { count: vi.fn(async () => zoneExists ? 1 : 0) },
      shippingZoneArea: { findMany: vi.fn(async () => areaMatches ? [{ cityKey: "", areaKey: "", zone: { code: "TUNIS", name: "Tunis", rates: [{ priceMinor: 2_500n, currency: "TND", estimatedMinDays: 1, estimatedMaxDays: 2 }] } }] : []) },
    };
    const client = { $transaction: vi.fn(async (operation: (value: typeof tx) => Promise<unknown>) => operation(tx)) };
    const pricing = { calculate: vi.fn(async () => ({ eligibleCoupon: null, discounts: [] })) };
    return { repository: new CheckoutRepository(client as unknown as PrismaClient, pricing as unknown as CommercePricingService), tx, pricing };
  }

  it("prices persisted variants with the matching Shipping Zone rate", async () => {
    const { repository, tx, pricing } = checkoutClient(true, true);
    const result = await repository.previewGuest(tokenA, input, new Date("2026-09-22"));
    expect(result.kind).toBe("READY");
    if (result.kind === "READY") expect(result.shipping).toMatchObject({ priceMinor: 2_500n, zone: { code: "TUNIS" } });
    expect(pricing.calculate).toHaveBeenCalledWith(expect.anything(), expect.objectContaining({ userId: null, shippingMinor: 2_500n, lines: [expect.objectContaining({ unitPriceMinor: 10_000n, quantity: 2 })] }));
    expect(tx.cart.findFirst).toHaveBeenCalledWith({ where: { sessionToken: tokenA, userId: null, status: "ACTIVE", OR: expect.any(Array) }, select: expect.any(Object) });
  });

  it("fails when zones exist but no shipping rate matches", async () => {
    const { repository, pricing } = checkoutClient(true, false);
    expect((await repository.previewGuest(tokenA, input, new Date("2026-09-22"))).kind).toBe("SHIPPING_RATE_NOT_AVAILABLE");
    expect(pricing.calculate).not.toHaveBeenCalled();
  });

  it("requires validated Tunisian contact and rejects client totals", () => {
    expect(guestCheckoutPreviewSchema.parse({ body: { ...input, phone: "20123456" }, params: {}, query: {} }).body.phone).toBe("+21620123456");
    for (const phone of ["30123456", "60123456", "70123456", "80123456", "123"]) {
      expect(guestCheckoutPreviewSchema.safeParse({ body: { ...input, phone }, params: {}, query: {} }).success).toBe(false);
    }
    for (const phone of ["+21620123456", "21620123456", "0021620123456"]) {
      expect(guestCheckoutPreviewSchema.parse({ body: { ...input, phone }, params: {}, query: {} }).body.phone).toBe("+21620123456");
    }
    expect(guestCheckoutPreviewSchema.safeParse({ body: { ...input, countryCode: "US" }, params: {}, query: {} }).success).toBe(false);
    expect(guestCheckoutPreviewSchema.safeParse({ body: { ...input, shippingMinor: "0" }, params: {}, query: {} }).success).toBe(false);
  });

  it("accepts optional coordinates and preserves no-coordinate compatibility", () => {
    const coordinates = guestCheckoutPreviewSchema.parse({ body: { ...input, latitude: "36.8065", longitude: "10.1815" }, params: {}, query: {} }).body;
    expect(coordinates).toMatchObject({ latitude: "36.8065", longitude: "10.1815" });
    expect(guestCheckoutAddress(coordinates)).toMatchObject({ latitude: "36.8065", longitude: "10.1815" });
    const legacy = guestCheckoutPreviewSchema.parse({ body: input, params: {}, query: {} }).body;
    expect(legacy).not.toHaveProperty("latitude");
    expect(guestCheckoutAddress(legacy)).toMatchObject({ latitude: null, longitude: null });
    expect(guestCheckoutPreviewSchema.safeParse({ body: { ...input, latitude: "90.0000001" }, params: {}, query: {} }).success).toBe(false);
    expect(guestCheckoutPreviewSchema.safeParse({ body: { ...input, longitude: "180.0000001" }, params: {}, query: {} }).success).toBe(false);
  });
});

describe("guest order access", () => {
  it("places and replays one guest COD order without a User or duplicate inventory movement", async () => {
    const item = {
      variantId, quantity: 2,
      variant: { id: variantId, productId: "product-id", title: "Size 40", sku: "SHOE-40", priceMinor: 11_000n, costMinor: 7_000n, stockQuantity: 5, isActive: true, deletedAt: null, optionValues: [], product: { id: "product-id", name: "Shoe", status: "ACTIVE", deletedAt: null, publishedAt: new Date("2026-01-01"), brand: { id: "brand-id", name: "Brand", isActive: true }, productCategories: [{ category: { id: "category-id", isActive: true } }] } },
    };
    const cart = { id: "cart-id", status: "ACTIVE", currency: "TND", discountCode: null, items: [item] };
    let createdOrder: { id: string; userId: null; guestSessionTokenHash: string; orderNumber: string } | null = null;
    const tx = {
      $queryRaw: vi.fn(async () => []),
      order: {
        findUnique: vi.fn(async () => createdOrder),
        create: vi.fn(async ({ data }: { data: Record<string, unknown> }) => { createdOrder = { id: "order-id", userId: null, guestSessionTokenHash: data.guestSessionTokenHash as string, orderNumber: data.orderNumber as string }; return { id: "order-id" }; }),
        findUniqueOrThrow: vi.fn(async () => createdOrder),
      },
      user: { findFirst: vi.fn(async () => null) },
      shippingMethod: { findFirst: vi.fn(async () => ({ id: shippingMethodId, code: "HOME", name: "Home", basePriceMinor: 2_500n, currency: "TND", estimatedMinDays: null, estimatedMaxDays: null })) },
      shippingZone: { count: vi.fn(async () => 0) },
      cart: { findFirst: vi.fn(async () => ({ id: "cart-id" })), findUnique: vi.fn(async () => cart), update: vi.fn(async () => ({})) },
      storeSettings: { findUnique: vi.fn(async () => ({ storeName: "Shoozy", whatsappNumber: null, whatsappConfirmationEnabled: false })) },
      productMedia: { findMany: vi.fn(async () => []) },
      productVariant: { updateMany: vi.fn(async () => ({ count: 1 })), findUniqueOrThrow: vi.fn(async () => ({ stockQuantity: 3 })) },
      inventoryMovement: { create: vi.fn(async () => ({ id: "movement-id" })) },
      notificationOutbox: { upsert: vi.fn(async () => ({})) },
    };
    const client = { $transaction: vi.fn(async (operation: (value: typeof tx) => Promise<unknown>) => operation(tx)) };
    const pricing = { calculate: vi.fn(async () => ({ grossMerchandiseSubtotalMinor: 22_000n, totalDiscountMinor: 0n, grossShippingMinor: 2_500n, grandTotalMinor: 24_500n, eligibleCoupon: null, discounts: [], lines: [{ discountMinor: 0n, finalMinor: 22_000n }] })) };
    const discounts = { lockAndValidateUsage: vi.fn(async () => "OK"), createRedemptions: vi.fn(async () => ({ count: 0 })) };
    const repository = new OrdersRepository(client as unknown as PrismaClient, pricing as unknown as CommercePricingService, discounts as unknown as DiscountsRepository);
    const first = await repository.placeGuest(tokenA, "guest-order-123456", { ...input, email: null, postalCode: "1000", latitude: "36.8065", longitude: "10.1815" }, new Date("2026-09-22"));
    const replay = await repository.placeGuest(tokenA, "guest-order-123456", { ...input, email: null, postalCode: "1000", latitude: "36.8065", longitude: "10.1815" }, new Date("2026-09-22"));
    expect(first.kind).toBe("CREATED");
    expect(replay.kind).toBe("REPLAYED");
    expect(tx.user.findFirst).not.toHaveBeenCalled();
    expect(tx.order.create).toHaveBeenCalledTimes(1);
    expect(tx.productVariant.updateMany).toHaveBeenCalledTimes(1);
    expect(tx.inventoryMovement.create).toHaveBeenCalledTimes(1);
    expect(tx.cart.update).toHaveBeenCalledWith({ where: { id: "cart-id" }, data: { status: "ORDERED" } });
    expect(tx.order.create).toHaveBeenCalledWith({ data: expect.objectContaining({ userId: null, customerEmail: null, customerPhone: "+21620123456", customerFirstName: "Amira", customerLastName: "Ben Ali", paymentMethod: "COD", paymentStatus: "PENDING", address: { create: expect.objectContaining({ postalCode: "1000", line1: "Rue 1", latitude: "36.8065", longitude: "10.1815" }) } }), select: { id: true } });
  });

  it("looks up by order number and the SHA-256 hash of the opaque token", async () => {
    const raw = "C".repeat(43);
    const expectedHash = createHash("sha256").update(raw).digest("hex");
    const client = { order: { findFirst: vi.fn(async ({ where }: { where: { guestAccessTokenHash: string } }) => where.guestAccessTokenHash === expectedHash ? ({ id: "order-id" }) : null) } };
    const repository = new OrdersRepository(client as unknown as PrismaClient);
    expect(await repository.findGuest("SHZ-AAAAAAAAAAAAAAAAAAAAAAAA", raw)).toMatchObject({ id: "order-id" });
    expect(client.order.findFirst).toHaveBeenCalledWith({ where: { orderNumber: "SHZ-AAAAAAAAAAAAAAAAAAAAAAAA", userId: null, guestAccessTokenHash: expectedHash }, select: expect.any(Object) });
    const service = new OrdersService(repository);
    await expect(service.getGuest("SHZ-AAAAAAAAAAAAAAAAAAAAAAAA", "D".repeat(43))).rejects.toMatchObject({ code: "ORDER_NOT_FOUND" });
  });
});
