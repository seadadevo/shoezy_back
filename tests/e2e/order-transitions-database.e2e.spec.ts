import { randomUUID } from "node:crypto";
import { PrismaPg } from "@prisma/adapter-pg";
import { PrismaClient, type OrderStatus } from "@prisma/client";
import { afterAll, beforeAll, describe, expect, it } from "vitest";
import { OrdersRepository } from "../../src/modules/orders/orders.repository";
import { ORDER_TRANSITIONS, OrdersService } from "../../src/modules/orders/orders.service";

const testDatabaseUrl = process.env.TEST_DATABASE_URL;
const describeDatabase = testDatabaseUrl ? describe : describe.skip;

describeDatabase("Task 21 Order transitions against disposable PostgreSQL", () => {
  if (!testDatabaseUrl) return;
  const databaseName = new URL(testDatabaseUrl).pathname.slice(1);
  if (databaseName !== "shoe_store_tasks13_26_validation" || databaseName.includes("shineup")) throw new Error(`Unsafe TEST_DATABASE_URL database: ${databaseName}`);
  const prisma = new PrismaClient({ adapter: new PrismaPg({ connectionString: testDatabaseUrl }) });
  const service = new OrdersService(new OrdersRepository(prisma));
  const userIds: string[] = [];
  const productIds: string[] = [];
  const brandIds: string[] = [];
  const categoryIds: string[] = [];
  const orderIds: string[] = [];

  beforeAll(async () => {
    const identity = await prisma.$queryRaw<Array<{ database: string }>>`SELECT current_database() AS database`;
    expect(identity[0]?.database).toBe("shoe_store_tasks13_26_validation");
  });
  afterAll(async () => {
    if (orderIds.length) await prisma.orderStatusHistory.deleteMany({ where: { orderId: { in: orderIds } } });
    if (orderIds.length) await prisma.orderAddress.deleteMany({ where: { orderId: { in: orderIds } } });
    if (orderIds.length) await prisma.orderItem.deleteMany({ where: { orderId: { in: orderIds } } });
    if (orderIds.length) await prisma.order.deleteMany({ where: { id: { in: orderIds } } });
    if (userIds.length) await prisma.user.deleteMany({ where: { id: { in: userIds } } });
    if (productIds.length) await prisma.product.deleteMany({ where: { id: { in: productIds } } });
    if (categoryIds.length) await prisma.category.deleteMany({ where: { id: { in: categoryIds } } });
    if (brandIds.length) await prisma.brand.deleteMany({ where: { id: { in: brandIds } } });
    await prisma.$disconnect();
  });

  async function createUser() {
    const id = randomUUID(); userIds.push(id);
    await prisma.user.create({ data: { id, email: `transition-${id}@example.com`, firstName: "Status", lastName: "Actor" } });
    return id;
  }

  async function createOrder(userId: string, status: OrderStatus = "PENDING", stock = 3) {
    const brandId = randomUUID(); const categoryId = randomUUID(); const productId = randomUUID();
    brandIds.push(brandId); categoryIds.push(categoryId); productIds.push(productId);
    await prisma.brand.create({ data: { id: brandId, name: `Transition ${brandId}`, slug: `transition-${brandId}` } });
    await prisma.category.create({ data: { id: categoryId, name: `Transition ${categoryId}`, slug: `transition-${categoryId}` } });
    const product = await prisma.product.create({ data: { id: productId, brandId, name: `Transition ${productId}`, slug: `transition-${productId}`, productCategories: { create: { categoryId, isPrimary: true } }, variants: { create: { sku: `TRANSITION-${randomUUID()}`, title: "Default", priceMinor: 1_000n, stockQuantity: stock } } }, include: { variants: true } });
    const variant = product.variants[0]!;
    const order = await prisma.order.create({ data: {
      orderNumber: `TRANS-${randomUUID().replaceAll("-", "").slice(0, 30)}`, userId, status, paymentMethod: "COD", paymentStatus: "PENDING", currency: "TND",
      customerEmail: `transition-${userId}@example.com`, customerPhone: "+21620000000", subtotalMinor: 2_000n,
      discountMinor: 0n, shippingMinor: 0n, totalMinor: 2_000n, placedAt: new Date(),
      items: { create: { productId, variantId: variant.id, productName: product.name, variantName: variant.title, sku: variant.sku, quantity: 2, unitPriceMinor: 1_000n, lineTotalMinor: 2_000n, snapshotJson: {} } },
      statusHistory: { create: { fromStatus: null, toStatus: status, changedByUserId: userId } },
    } });
    orderIds.push(order.id); return { order, variant };
  }

  it("documents the explicit transition matrix", () => {
    expect(ORDER_TRANSITIONS).toEqual({
      CUSTOMER_CANCEL: { target: "CANCELLED", allowedFrom: ["PENDING", "CONFIRMED"] },
      ADMIN_CONFIRM: { target: "CONFIRMED", allowedFrom: ["PENDING"] },
      ADMIN_CANCEL: { target: "CANCELLED", allowedFrom: ["PENDING", "CONFIRMED"] },
      ADMIN_SHIP: { target: "SHIPPED", allowedFrom: ["CONFIRMED"] },
      ADMIN_DELIVER: { target: "DELIVERED", allowedFrom: ["SHIPPED"] },
    });
  });

  it("restores stock and records history exactly once under concurrent cancellation", async () => {
    const customerId = await createUser(); const created = await createOrder(customerId, "PENDING", 3);
    const [first, second] = await Promise.all([service.cancelOwn(customerId, created.order.id, { reason: "Changed mind" }), service.cancelOwn(customerId, created.order.id, { reason: "Changed mind" })]);
    expect([first.idempotentReplay, second.idempotentReplay].sort()).toEqual([false, true]);
    expect((await prisma.productVariant.findUniqueOrThrow({ where: { id: created.variant.id } })).stockQuantity).toBe(5);
    const order = await prisma.order.findUniqueOrThrow({ where: { id: created.order.id }, include: { statusHistory: true } });
    expect(order.status).toBe("CANCELLED"); expect(order.paymentStatus).toBe("CANCELLED"); expect(order.statusHistory).toHaveLength(2);
  });

  it("allows concurrent customer cancellation from CONFIRMED exactly once and blocks it after shipment", async () => {
    const customerId = await createUser(); const adminId = await createUser(); const created = await createOrder(customerId, "CONFIRMED", 3);
    const [first, second] = await Promise.all([service.cancelOwn(customerId, created.order.id, { reason: "Changed mind" }), service.cancelOwn(customerId, created.order.id, { reason: "Changed mind" })]);
    expect([first.idempotentReplay, second.idempotentReplay].sort()).toEqual([false, true]);
    expect((await prisma.productVariant.findUniqueOrThrow({ where: { id: created.variant.id } })).stockQuantity).toBe(5);
    const order = await prisma.order.findUniqueOrThrow({ where: { id: created.order.id }, include: { statusHistory: true } });
    expect(order).toMatchObject({ status: "CANCELLED", paymentStatus: "CANCELLED" });
    expect(order.statusHistory.filter((history) => history.toStatus === "CANCELLED")).toHaveLength(1);

    const shipped = await createOrder(customerId, "CONFIRMED", 3);
    await prisma.order.update({ where: { id: shipped.order.id }, data: { shippingProvider: "Courier" } });
    await service.shipAny(adminId, shipped.order.id, {});
    await expect(service.cancelOwn(customerId, shipped.order.id, {})).rejects.toMatchObject({ code: "ORDER_TRANSITION_INVALID" });
  });

  it("enforces admin transitions and records COD collection only on delivery", async () => {
    const customerId = await createUser(); const adminId = await createUser(); const created = await createOrder(customerId);
    await expect(service.shipAny(adminId, created.order.id, { reason: "Too early" })).rejects.toMatchObject({ code: "ORDER_TRANSITION_INVALID" });
    await service.confirmAny(adminId, created.order.id, { reason: "Validated" });
    await prisma.order.update({ where: { id: created.order.id }, data: { shippingProvider: "Courier" } });
    await service.shipAny(adminId, created.order.id, { reason: "Handover" });
    const delivered = await service.deliverAny(adminId, created.order.id, { reason: "COD collected" }, new Date("2026-08-13T12:00:00.000Z"));
    expect(delivered.order).toMatchObject({ status: "DELIVERED", paymentStatus: "PAID" });
    expect(delivered.order.totals.paidMinor).toBe("2000");
    expect(delivered.order.paidAt).toEqual(new Date("2026-08-13T12:00:00.000Z"));
    expect((await prisma.orderStatusHistory.count({ where: { orderId: created.order.id } }))).toBe(4);
  });

  it("hides foreign customer Orders and supports bounded admin filtering", async () => {
    const ownerId = await createUser(); const otherId = await createUser(); const adminId = await createUser(); const created = await createOrder(ownerId);
    await expect(service.cancelOwn(otherId, created.order.id, {})).rejects.toMatchObject({ code: "ORDER_NOT_FOUND" });
    const result = await service.listAny({ page: 1, limit: 20, status: 'PENDING', sortBy: 'createdAt', sortOrder: 'desc' });
    expect(result.items.map((order) => order.id)).toContain(created.order.id);
    await service.cancelAny(adminId, created.order.id, { reason: "Fraud review" });
  });
});
