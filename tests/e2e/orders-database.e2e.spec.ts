import { randomUUID } from "node:crypto";
import { PrismaPg } from "@prisma/adapter-pg";
import { PrismaClient } from "@prisma/client";
import { afterAll, beforeAll, describe, expect, it } from "vitest";
import { CartsRepository } from "../../src/modules/carts/carts.repository";
import { CartsService } from "../../src/modules/carts/carts.service";
import { OrdersRepository } from "../../src/modules/orders/orders.repository";
import { OrdersService } from "../../src/modules/orders/orders.service";

const testDatabaseUrl = process.env.TEST_DATABASE_URL;
const describeDatabase = testDatabaseUrl ? describe : describe.skip;

describeDatabase("Task 20 Orders against disposable PostgreSQL", () => {
  if (!testDatabaseUrl) return;
  const databaseName = new URL(testDatabaseUrl).pathname.slice(1);
  if (databaseName !== "shoe_store_tasks13_26_validation" || databaseName.includes("shineup")) throw new Error(`Unsafe TEST_DATABASE_URL database: ${databaseName}`);
  const prisma = new PrismaClient({ adapter: new PrismaPg({ connectionString: testDatabaseUrl }) });
  const carts = new CartsService(new CartsRepository(prisma));
  const orders = new OrdersService(new OrdersRepository(prisma));
  const userIds: string[] = [];
  const productIds: string[] = [];
  const brandIds: string[] = [];
  const categoryIds: string[] = [];
  const shippingIds: string[] = [];

  beforeAll(async () => {
    const identity = await prisma.$queryRaw<Array<{ database: string }>>`SELECT current_database() AS database`;
    expect(identity[0]?.database).toBe("shoe_store_tasks13_26_validation");
  });
  afterAll(async () => {
    const orderIds = userIds.length ? (await prisma.order.findMany({ where: { userId: { in: userIds } }, select: { id: true } })).map((order) => order.id) : [];
    if (orderIds.length) await prisma.discountRedemption.deleteMany({ where: { orderId: { in: orderIds } } });
    if (orderIds.length) await prisma.orderStatusHistory.deleteMany({ where: { orderId: { in: orderIds } } });
    if (orderIds.length) await prisma.orderAddress.deleteMany({ where: { orderId: { in: orderIds } } });
    if (orderIds.length) await prisma.orderItem.deleteMany({ where: { orderId: { in: orderIds } } });
    if (orderIds.length) await prisma.order.deleteMany({ where: { id: { in: orderIds } } });
    if (userIds.length) await prisma.cart.deleteMany({ where: { userId: { in: userIds } } });
    if (userIds.length) await prisma.user.deleteMany({ where: { id: { in: userIds } } });
    if (shippingIds.length) await prisma.shippingMethod.deleteMany({ where: { id: { in: shippingIds } } });
    if (productIds.length) await prisma.product.deleteMany({ where: { id: { in: productIds } } });
    if (categoryIds.length) await prisma.category.deleteMany({ where: { id: { in: categoryIds } } });
    if (brandIds.length) await prisma.brand.deleteMany({ where: { id: { in: brandIds } } });
    await prisma.$disconnect();
  });

  async function createCustomer() {
    const id = randomUUID(); userIds.push(id);
    const user = await prisma.user.create({ data: { id, email: `order-${id}@example.com`, firstName: "Order", lastName: "Customer" } });
    const address = await prisma.address.create({ data: { userId: id, recipientName: "Original Recipient", phone: "+21620000000", countryCode: "TN", city: "Tunis", line1: "Original address" } });
    return { user, address };
  }

  async function createProduct(stock: number, priceMinor = 10_001n) {
    const brandId = randomUUID(); const categoryId = randomUUID(); const productId = randomUUID();
    brandIds.push(brandId); categoryIds.push(categoryId); productIds.push(productId);
    await prisma.brand.create({ data: { id: brandId, name: `Order ${brandId}`, slug: `order-${brandId}` } });
    await prisma.category.create({ data: { id: categoryId, name: `Order ${categoryId}`, slug: `order-${categoryId}` } });
    const product = await prisma.product.create({ data: { id: productId, brandId, name: `Order ${productId}`, slug: `order-${productId}`, status: "ACTIVE", publishedAt: new Date("2026-08-12T00:00:00.000Z"), productCategories: { create: { categoryId, isPrimary: true } }, variants: { create: { sku: `ORDER-${randomUUID()}`, title: "Default", priceMinor, costMinor: 7_001n, stockQuantity: stock, isActive: true } } }, include: { variants: true } });
    const variantId = product.variants[0]!.id;
    const variantImageUrl = `https://example.com/${variantId}.jpg`;
    await prisma.productMedia.createMany({ data: [
      { productId, type: "IMAGE", mediaType: "IMAGE", url: `https://example.com/${productId}.jpg`, isPrimary: true },
      { productId, variantId, type: "IMAGE", mediaType: "IMAGE", url: variantImageUrl, position: 1 },
      { productId, variantId, type: "VIDEO", mediaType: "VIDEO", url: `https://example.com/${variantId}.mp4`, position: 0 },
    ] });
    return { productId, variantId, variantImageUrl };
  }

  async function createShipping() {
    const shipping = await prisma.shippingMethod.create({ data: { code: `ORDER-${randomUUID()}`, name: "Order delivery", basePriceMinor: 999n, currency: "TND", isActive: true } });
    shippingIds.push(shipping.id); return shipping;
  }

  it("creates a reconciled immutable COD snapshot and consumes stock atomically", async () => {
    const customer = await createCustomer(); const product = await createProduct(3); const shipping = await createShipping();
    await carts.addItem(customer.user.id, { variantId: product.variantId, quantity: 2 });
    const result = await orders.place(customer.user.id, `order-${randomUUID()}`, { addressId: customer.address.id, shippingMethodId: shipping.id, notes: "Leave at reception" }, new Date("2026-08-13T00:00:00.000Z"));
    expect(result.idempotentReplay).toBe(false);
    expect(result.order).toMatchObject({ status: "PENDING", paymentMethod: "COD", paymentStatus: "PENDING", paidAt: null });
    expect(result.order.totals).toEqual({ currency: "TND", subtotalMinor: "20002", discountMinor: "0", shippingMinor: "999", totalMinor: "21001", paidMinor: "0", refundedMinor: "0" });
    expect(BigInt(result.order.totals.totalMinor)).toBe(BigInt(result.order.totals.subtotalMinor) - BigInt(result.order.totals.discountMinor) + BigInt(result.order.totals.shippingMinor));
    expect(result.order.statusHistory).toHaveLength(1);
    expect(result.order.items[0]?.imageUrl).toBe(product.variantImageUrl);
    expect((await prisma.productVariant.findUniqueOrThrow({ where: { id: product.variantId } })).stockQuantity).toBe(1);
    expect((await prisma.cart.findFirstOrThrow({ where: { userId: customer.user.id } })).status).toBe("ORDERED");
    const internalItem = await prisma.orderItem.findFirstOrThrow({ where: { orderId: result.order.id } });
    expect(internalItem.unitCostMinor).toBe(7_001n);
    expect(internalItem.snapshotJson).toMatchObject({ imageUrl: product.variantImageUrl });
    expect(JSON.stringify(result.order)).not.toContain("unitCostMinor");
    await prisma.address.update({ where: { id: customer.address.id }, data: { recipientName: "Changed", line1: "Changed address" } });
    expect((await orders.getOwn(customer.user.id, result.order.id)).address).toMatchObject({ recipientName: "Original Recipient", line1: "Original address" });
  });

  it("makes concurrent duplicate retries return one Order and decrement once", async () => {
    const customer = await createCustomer(); const product = await createProduct(2); const shipping = await createShipping();
    await carts.addItem(customer.user.id, { variantId: product.variantId, quantity: 1 });
    const key = `order-${randomUUID()}`; const input = { addressId: customer.address.id, shippingMethodId: shipping.id };
    const [first, second] = await Promise.all([orders.place(customer.user.id, key, input), orders.place(customer.user.id, key, input)]);
    expect(first.order.id).toBe(second.order.id);
    expect([first.idempotentReplay, second.idempotentReplay].sort()).toEqual([false, true]);
    expect(await prisma.order.count({ where: { idempotencyKey: key } })).toBe(1);
    expect((await prisma.productVariant.findUniqueOrThrow({ where: { id: product.variantId } })).stockQuantity).toBe(1);
  });

  it("allows at most one customer to purchase the final unit", async () => {
    const first = await createCustomer(); const second = await createCustomer(); const product = await createProduct(1); const shipping = await createShipping();
    await Promise.all([carts.addItem(first.user.id, { variantId: product.variantId, quantity: 1 }), carts.addItem(second.user.id, { variantId: product.variantId, quantity: 1 })]);
    const attempts = await Promise.allSettled([
      orders.place(first.user.id, `order-${randomUUID()}`, { addressId: first.address.id, shippingMethodId: shipping.id }),
      orders.place(second.user.id, `order-${randomUUID()}`, { addressId: second.address.id, shippingMethodId: shipping.id }),
    ]);
    expect(attempts.filter((attempt) => attempt.status === "fulfilled")).toHaveLength(1);
    expect(attempts.filter((attempt) => attempt.status === "rejected")).toHaveLength(1);
    const rejected = attempts.find((attempt) => attempt.status === "rejected");
    expect(rejected?.reason).toMatchObject({ code: "ORDER_INSUFFICIENT_STOCK" });
    expect((await prisma.productVariant.findUniqueOrThrow({ where: { id: product.variantId } })).stockQuantity).toBe(0);
    expect(await prisma.order.count({ where: { userId: { in: [first.user.id, second.user.id] } } })).toBe(1);
  });

  it("rejects foreign Addresses and protects customer reads", async () => {
    const first = await createCustomer(); const second = await createCustomer(); const product = await createProduct(1); const shipping = await createShipping();
    await carts.addItem(first.user.id, { variantId: product.variantId, quantity: 1 });
    await expect(orders.place(first.user.id, `order-${randomUUID()}`, { addressId: second.address.id, shippingMethodId: shipping.id })).rejects.toMatchObject({ code: "ADDRESS_NOT_FOUND" });
    const created = await orders.place(first.user.id, `order-${randomUUID()}`, { addressId: first.address.id, shippingMethodId: shipping.id });
    await expect(orders.getOwn(second.user.id, created.order.id)).rejects.toMatchObject({ code: "ORDER_NOT_FOUND" });
    expect((await orders.listOwn(first.user.id, { page: 1, limit: 20, sortBy: 'createdAt', sortOrder: 'desc' })).items).toHaveLength(1);
    expect((await orders.listOwn(second.user.id, { page: 1, limit: 20, sortBy: 'createdAt', sortOrder: 'desc' })).items).toHaveLength(0);
  });
});
