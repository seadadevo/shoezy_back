import { randomUUID } from "node:crypto";
import { PrismaPg } from "@prisma/adapter-pg";
import { PrismaClient } from "@prisma/client";
import { afterAll, beforeAll, describe, expect, it } from "vitest";
import { OrdersRepository } from "../../src/modules/orders/orders.repository";
import { OrdersService } from "../../src/modules/orders/orders.service";
import { ShippingRepository } from "../../src/modules/shipping/shipping.repository";
import { ShippingService } from "../../src/modules/shipping/shipping.service";

const testDatabaseUrl = process.env.TEST_DATABASE_URL;
const describeDatabase = testDatabaseUrl ? describe : describe.skip;

describeDatabase("Task 22 Shipping against disposable PostgreSQL", () => {
  if (!testDatabaseUrl) return;
  const databaseName = new URL(testDatabaseUrl).pathname.slice(1);
  if (databaseName !== "shoe_store_tasks13_26_validation" || databaseName.includes("shineup")) throw new Error(`Unsafe TEST_DATABASE_URL database: ${databaseName}`);
  const prisma = new PrismaClient({ adapter: new PrismaPg({ connectionString: testDatabaseUrl }) });
  const shipping = new ShippingService(new ShippingRepository(prisma));
  const orders = new OrdersService(new OrdersRepository(prisma));
  const userIds: string[] = []; const productIds: string[] = []; const brandIds: string[] = []; const categoryIds: string[] = []; const orderIds: string[] = []; const methodIds: string[] = [];

  beforeAll(async () => { const identity = await prisma.$queryRaw<Array<{ database: string }>>`SELECT current_database() AS database`; expect(identity[0]?.database).toBe("shoe_store_tasks13_26_validation"); });
  afterAll(async () => {
    if (orderIds.length) await prisma.orderStatusHistory.deleteMany({ where: { orderId: { in: orderIds } } });
    if (orderIds.length) await prisma.orderItem.deleteMany({ where: { orderId: { in: orderIds } } });
    if (orderIds.length) await prisma.order.deleteMany({ where: { id: { in: orderIds } } });
    if (userIds.length) await prisma.user.deleteMany({ where: { id: { in: userIds } } });
    if (methodIds.length) await prisma.shippingMethod.deleteMany({ where: { id: { in: methodIds } } });
    if (productIds.length) await prisma.product.deleteMany({ where: { id: { in: productIds } } });
    if (categoryIds.length) await prisma.category.deleteMany({ where: { id: { in: categoryIds } } });
    if (brandIds.length) await prisma.brand.deleteMany({ where: { id: { in: brandIds } } });
    await prisma.$disconnect();
  });

  async function user() { const id = randomUUID(); userIds.push(id); await prisma.user.create({ data: { id, email: `shipping-${id}@example.com`, firstName: "Ship", lastName: "Actor" } }); return id; }
  async function confirmedOrder(ownerId: string) {
    const brandId = randomUUID(); const categoryId = randomUUID(); const productId = randomUUID(); brandIds.push(brandId); categoryIds.push(categoryId); productIds.push(productId);
    await prisma.brand.create({ data: { id: brandId, name: `Shipping ${brandId}`, slug: `shipping-${brandId}` } });
    await prisma.category.create({ data: { id: categoryId, name: `Shipping ${categoryId}`, slug: `shipping-${categoryId}` } });
    const product = await prisma.product.create({ data: { id: productId, brandId, name: `Shipping ${productId}`, slug: `shipping-${productId}`, productCategories: { create: { categoryId, isPrimary: true } }, variants: { create: { sku: `SHIPPING-${randomUUID()}`, title: "Default", priceMinor: 1_000n, stockQuantity: 1 } } }, include: { variants: true } });
    const variant = product.variants[0]!;
    const order = await prisma.order.create({ data: { orderNumber: `SHIP-${randomUUID().replaceAll("-", "").slice(0, 30)}`, userId: ownerId, status: "CONFIRMED", paymentMethod: "COD", paymentStatus: "PENDING", currency: "TND", customerEmail: `shipping-${ownerId}@example.com`, customerPhone: "+21620000000", subtotalMinor: 1_000n, shippingMinor: 100n, totalMinor: 1_100n, placedAt: new Date(), confirmedAt: new Date(), items: { create: { productId, variantId: variant.id, productName: product.name, variantName: variant.title, sku: variant.sku, quantity: 1, unitPriceMinor: 1_000n, lineTotalMinor: 1_000n, snapshotJson: {} } }, statusHistory: { create: { fromStatus: "PENDING", toStatus: "CONFIRMED", changedByUserId: ownerId } } } });
    orderIds.push(order.id); return order;
  }

  it("manages ShippingMethods with exact money and stable validation", async () => {
    const code = `METHOD-${randomUUID()}`.toUpperCase();
    const created = await shipping.createMethod({ code, name: "Courier", basePriceMinor: "1250", currency: "TND", estimatedMinDays: 1, estimatedMaxDays: 3, isActive: true }); methodIds.push(created.id);
    expect(created.basePriceMinor).toBe("1250");
    await expect(shipping.createMethod({ code, name: "Duplicate", basePriceMinor: "1" })).rejects.toMatchObject({ code: "SHIPPING_METHOD_CODE_CONFLICT" });
    await expect(shipping.updateMethod(created.id, { estimatedMinDays: 5 })).rejects.toMatchObject({ code: "SHIPPING_ESTIMATE_RANGE_INVALID" });
    const updated = await shipping.updateMethod(created.id, { name: "Updated courier", isActive: false }); expect(updated.isActive).toBe(false);
    expect((await shipping.listPublic({ page: 1, limit: 100 })).items.map((method) => method.id)).not.toContain(created.id);
    expect((await shipping.listAdmin({ page: 1, limit: 20, isActive: false })).items.map((method) => method.id)).toContain(created.id);
  });

  it("stores tracking, synchronizes through Order transitions, and scopes customer reads", async () => {
    const ownerId = await user(); const otherId = await user(); const adminId = await user(); const order = await confirmedOrder(ownerId);
    const tracked = await shipping.updateOrderShipping(order.id, { shippingProvider: "Local Courier", trackingNumber: "TN-TRACK-1" });
    expect(tracked).toMatchObject({ orderStatus: "CONFIRMED", shippingProvider: "Local Courier", trackingNumber: "TN-TRACK-1" });
    await expect(shipping.getOwnShipment(otherId, order.id)).rejects.toMatchObject({ code: "SHIPMENT_NOT_FOUND" });
    await orders.shipAny(adminId, order.id, { reason: "Carrier handover" }, new Date("2026-08-13T10:00:00.000Z"));
    await orders.deliverAny(adminId, order.id, { reason: "Delivered and collected" }, new Date("2026-08-13T12:00:00.000Z"));
    const replay = await orders.deliverAny(adminId, order.id, { reason: "Duplicate callback" }, new Date("2026-08-13T13:00:00.000Z"));
    expect(replay.idempotentReplay).toBe(true);
    const shipment = await shipping.getOwnShipment(ownerId, order.id);
    expect(shipment).toMatchObject({ orderStatus: "DELIVERED", shippedAt: new Date("2026-08-13T10:00:00.000Z"), deliveredAt: new Date("2026-08-13T12:00:00.000Z") });
    expect((await prisma.order.findUniqueOrThrow({ where: { id: order.id } })).paymentStatus).toBe("PAID");
    expect(await prisma.orderStatusHistory.count({ where: { orderId: order.id, toStatus: "DELIVERED" } })).toBe(1);
  });

  it("requires a provider inside the locked shipping transition and remains safe with concurrent detail updates", async () => {
    const ownerId = await user(); const adminId = await user(); const missing = await confirmedOrder(ownerId);
    await expect(orders.shipAny(adminId, missing.id, {})).rejects.toMatchObject({ code: "ORDER_SHIPPING_DETAILS_REQUIRED" });
    expect((await prisma.order.findUniqueOrThrow({ where: { id: missing.id } })).status).toBe("CONFIRMED");

    const provided = await confirmedOrder(ownerId);
    await shipping.updateOrderShipping(provided.id, { shippingProvider: "Provider only" });
    const shipped = await orders.shipAny(adminId, provided.id, {});
    expect(shipped.order).toMatchObject({ status: "SHIPPED", shippingProvider: "Provider only", trackingNumber: null });

    const concurrent = await confirmedOrder(ownerId);
    const attempts = await Promise.allSettled([
      shipping.updateOrderShipping(concurrent.id, { shippingProvider: "Concurrent Courier" }),
      orders.shipAny(adminId, concurrent.id, {}),
    ]);
    const final = await prisma.order.findUniqueOrThrow({ where: { id: concurrent.id } });
    if (final.status === "SHIPPED") expect(final.shippingProvider).toBe("Concurrent Courier");
    else expect(final).toMatchObject({ status: "CONFIRMED", shippingProvider: "Concurrent Courier" });
    const rejected = attempts.find((attempt) => attempt.status === "rejected");
    if (rejected?.status === "rejected") expect(rejected.reason).toMatchObject({ code: "ORDER_SHIPPING_DETAILS_REQUIRED" });
  });

  it("preserves the provider invariant on every SHIPPED and DELIVERED shipping-details mutation", async () => {
    const ownerId = await user(); const adminId = await user(); const order = await confirmedOrder(ownerId);

    const clearedConfirmed = await shipping.updateOrderShipping(order.id, { shippingProvider: null });
    expect(clearedConfirmed).toMatchObject({ orderStatus: "CONFIRMED", shippingProvider: null });
    await expect(orders.shipAny(adminId, order.id, {})).rejects.toMatchObject({ code: "ORDER_SHIPPING_DETAILS_REQUIRED" });

    await shipping.updateOrderShipping(order.id, { shippingProvider: "Provider A" });
    await orders.shipAny(adminId, order.id, {});
    await expect(shipping.updateOrderShipping(order.id, { shippingProvider: null })).rejects.toMatchObject({ code: "ORDER_SHIPPING_DETAILS_REQUIRED" });

    const replacement = await shipping.updateOrderShipping(order.id, { shippingProvider: "Provider B" });
    expect(replacement.shippingProvider).toBe("Provider B");
    const trackingOnly = await shipping.updateOrderShipping(order.id, { trackingNumber: "TRACKING-ONLY" });
    expect(trackingOnly).toMatchObject({ orderStatus: "SHIPPED", shippingProvider: "Provider B", trackingNumber: "TRACKING-ONLY" });

    await orders.deliverAny(adminId, order.id, {});
    await expect(shipping.updateOrderShipping(order.id, { shippingProvider: null })).rejects.toMatchObject({ code: "ORDER_SHIPPING_DETAILS_REQUIRED" });
    expect((await prisma.order.findUniqueOrThrow({ where: { id: order.id } })).shippingProvider).toBe("Provider B");
  });

  it("serializes SHIP versus provider clearing without permitting an invalid final state", async () => {
    const ownerId = await user(); const adminId = await user(); const order = await confirmedOrder(ownerId);
    await shipping.updateOrderShipping(order.id, { shippingProvider: "Provider A" });

    const attempts = await Promise.allSettled([
      orders.shipAny(adminId, order.id, {}),
      shipping.updateOrderShipping(order.id, { shippingProvider: null }),
    ]);
    expect(attempts.filter((attempt) => attempt.status === "fulfilled")).toHaveLength(1);
    const rejected = attempts.find((attempt) => attempt.status === "rejected");
    expect(rejected?.status).toBe("rejected");
    if (rejected?.status === "rejected") expect(rejected.reason).toMatchObject({ code: "ORDER_SHIPPING_DETAILS_REQUIRED" });

    const final = await prisma.order.findUniqueOrThrow({ where: { id: order.id } });
    expect(final.status === "SHIPPED" && !final.shippingProvider?.trim()).toBe(false);
    if (final.status === "SHIPPED") expect(final.shippingProvider).toBe("Provider A");
    else expect(final).toMatchObject({ status: "CONFIRMED", shippingProvider: null });
  });
});
