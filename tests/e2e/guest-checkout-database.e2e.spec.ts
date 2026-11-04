import { randomUUID } from "node:crypto";
import { PrismaPg } from "@prisma/adapter-pg";
import { PrismaClient } from "@prisma/client";
import { afterAll, beforeAll, describe, expect, it } from "vitest";
import { CartsRepository } from "../../src/modules/carts/carts.repository";
import { CartsService } from "../../src/modules/carts/carts.service";
import { CheckoutRepository } from "../../src/modules/checkout/checkout.repository";
import { CheckoutService } from "../../src/modules/checkout/checkout.service";
import { OrdersRepository } from "../../src/modules/orders/orders.repository";
import { OrdersService } from "../../src/modules/orders/orders.service";
import { locationKey } from "../../src/modules/shipping/shipping-zone-pricing";

const testDatabaseUrl = process.env.TEST_DATABASE_URL;
const describeDatabase = testDatabaseUrl ? describe : describe.skip;

describeDatabase("guest checkout against disposable PostgreSQL", () => {
  if (!testDatabaseUrl) return;
  const databaseName = new URL(testDatabaseUrl).pathname.slice(1);
  if (databaseName !== "shoe_store_tasks13_26_validation" || databaseName.includes("shineup")) throw new Error(`Unsafe TEST_DATABASE_URL database: ${databaseName}`);
  const prisma = new PrismaClient({ adapter: new PrismaPg({ connectionString: testDatabaseUrl }) });
  const carts = new CartsService(new CartsRepository(prisma));
  const checkout = new CheckoutService(new CheckoutRepository(prisma));
  const orders = new OrdersService(new OrdersRepository(prisma));
  const brandId = randomUUID(), categoryId = randomUUID(), productId = randomUUID();
  const state = `Guest ${randomUUID()}`;
  let variantId = "", shippingMethodId = "", zoneId = "";
  const cartIds: string[] = [];
  const orderIds: string[] = [];

  beforeAll(async () => {
    const identity = await prisma.$queryRaw<Array<{ database: string }>>`SELECT current_database() AS database`;
    expect(identity[0]?.database).toBe(databaseName);
    await prisma.brand.create({ data: { id: brandId, name: "Guest test", slug: `guest-${brandId}` } });
    await prisma.category.create({ data: { id: categoryId, name: "Guest test", slug: `guest-${categoryId}` } });
    const product = await prisma.product.create({ data: { id: productId, brandId, name: "Guest shoe", slug: `guest-${productId}`, status: "ACTIVE", publishedAt: new Date("2026-01-01"), productCategories: { create: { categoryId, isPrimary: true } }, variants: { create: { sku: `GUEST-${randomUUID()}`, title: "Size 40", priceMinor: 10_000n, stockQuantity: 5, isActive: true } } }, include: { variants: true } });
    variantId = product.variants[0]!.id;
    const method = await prisma.shippingMethod.create({ data: { code: `GUEST-${randomUUID()}`, name: "Guest delivery", basePriceMinor: 999n, currency: "TND", isActive: true } });
    shippingMethodId = method.id;
    const zone = await prisma.shippingZone.create({ data: { code: `GUEST-${randomUUID()}`, name: "Guest zone", areas: { create: { countryCode: "TN", state, stateKey: locationKey(state), cityKey: "", areaKey: "" } }, rates: { create: { shippingMethodId, priceMinor: 2_500n, currency: "TND", isActive: true } } } });
    zoneId = zone.id;
  });

  afterAll(async () => {
    if (orderIds.length) {
      await prisma.discountRedemption.deleteMany({ where: { orderId: { in: orderIds } } });
      await prisma.orderStatusHistory.deleteMany({ where: { orderId: { in: orderIds } } });
      await prisma.orderAddress.deleteMany({ where: { orderId: { in: orderIds } } });
      await prisma.orderItem.deleteMany({ where: { orderId: { in: orderIds } } });
      await prisma.inventoryMovement.deleteMany({ where: { referenceType: "ORDER", referenceId: { in: orderIds } } });
      await prisma.order.deleteMany({ where: { id: { in: orderIds } } });
    }
    if (cartIds.length) { await prisma.cartItem.deleteMany({ where: { cartId: { in: cartIds } } }); await prisma.cart.deleteMany({ where: { id: { in: cartIds } } }); }
    if (zoneId) await prisma.shippingZone.delete({ where: { id: zoneId } });
    if (shippingMethodId) await prisma.shippingMethod.delete({ where: { id: shippingMethodId } });
    if (productId) await prisma.product.delete({ where: { id: productId } });
    if (categoryId) await prisma.category.delete({ where: { id: categoryId } });
    if (brandId) await prisma.brand.delete({ where: { id: brandId } });
    await prisma.$disconnect();
  });

  it("uses server prices, zone shipping, COD snapshots, one stock movement, and secure idempotent lookup", async () => {
    const sessionToken = await carts.createGuestSession();
    const cart = await prisma.cart.findUniqueOrThrow({ where: { sessionToken } });
    cartIds.push(cart.id);
    await carts.addItem({ sessionToken }, { variantId, quantity: 2 });
    await prisma.productVariant.update({ where: { id: variantId }, data: { priceMinor: 11_000n } });
    const address = { firstName: "Amira", lastName: "Ben Ali", phone: "+21620123456", email: null, addressLine1: "1 Rue Test", addressLine2: "Apt 2", city: "Tunis", state, postalCode: "1000", countryCode: "TN" as const, shippingMethodId };
    const preview = await checkout.previewGuest(sessionToken, address);
    expect(preview.totals.itemsSubtotalMinor).toBe("22000");
    expect(preview.totals.shippingMinor).toBe("2500");
    expect(preview.shippingZone).toMatchObject({ code: expect.stringContaining("GUEST-") });
    const key = `guest-${randomUUID()}`;
    const first = await orders.placeGuest(sessionToken, key, address);
    orderIds.push(first.order.id);
    const retry = await orders.placeGuest(sessionToken, key, address);
    expect(retry.order.id).toBe(first.order.id);
    expect(retry.idempotentReplay).toBe(true);
    expect(retry.guestAccessToken).toBe(first.guestAccessToken);
    expect(first.order).toMatchObject({ paymentMethod: "COD", paymentStatus: "PENDING", customerFirstName: "Amira", customerLastName: "Ben Ali", customerEmail: null, address: { line1: "1 Rue Test", postalCode: "1000" } });
    expect((await prisma.order.findUniqueOrThrow({ where: { id: first.order.id } })).userId).toBeNull();
    expect(first.order.totals).toMatchObject({ subtotalMinor: "22000", shippingMinor: "2500" });
    expect(first.whatsappConfirmation).toHaveProperty("enabled", expect.any(Boolean));
    expect(first.whatsappConfirmation).toHaveProperty("url");
    expect(await prisma.order.count({ where: { idempotencyKey: key, userId: null } })).toBe(1);
    expect((await prisma.productVariant.findUniqueOrThrow({ where: { id: variantId } })).stockQuantity).toBe(3);
    expect(await prisma.inventoryMovement.count({ where: { referenceType: "ORDER", referenceId: first.order.id, type: "ORDER_PLACED" } })).toBe(1);
    expect((await prisma.cart.findUniqueOrThrow({ where: { id: cart.id } })).status).toBe("ORDERED");
    await expect(orders.getGuest(first.order.orderNumber, "D".repeat(43))).rejects.toMatchObject({ code: "ORDER_NOT_FOUND" });
    expect((await orders.getGuest(first.order.orderNumber, first.guestAccessToken!)).orderNumber).toBe(first.order.orderNumber);
  });

  it("keeps a guest cart and stock intact after an unavailable shipping rate", async () => {
    const sessionToken = await carts.createGuestSession();
    const cart = await prisma.cart.findUniqueOrThrow({ where: { sessionToken } });
    cartIds.push(cart.id);
    await carts.addItem({ sessionToken }, { variantId, quantity: 1 });
    const before = (await prisma.productVariant.findUniqueOrThrow({ where: { id: variantId } })).stockQuantity;
    await expect(orders.placeGuest(sessionToken, `guest-${randomUUID()}`, { firstName: "Amira", lastName: "Ben Ali", phone: "+21620123456", addressLine1: "Rue Test", city: "Tunis", state: `Unknown ${randomUUID()}`, countryCode: "TN", shippingMethodId })).rejects.toMatchObject({ code: "SHIPPING_RATE_NOT_AVAILABLE" });
    expect((await prisma.cart.findUniqueOrThrow({ where: { id: cart.id } })).status).toBe("ACTIVE");
    expect((await prisma.productVariant.findUniqueOrThrow({ where: { id: variantId } })).stockQuantity).toBe(before);
  });
});
