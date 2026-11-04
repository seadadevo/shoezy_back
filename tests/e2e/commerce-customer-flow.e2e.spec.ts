import { randomUUID } from "node:crypto";
import { PrismaPg } from "@prisma/adapter-pg";
import { PrismaClient } from "@prisma/client";
import type { Express } from "express";
import request from "supertest";
import { afterAll, beforeAll, describe, expect, it, vi } from "vitest";

const testDatabaseUrl = process.env.TEST_DATABASE_URL;
const describeDatabase = testDatabaseUrl ? describe : describe.skip;

describeDatabase("Task 26 full customer commerce flow", () => {
  if (!testDatabaseUrl) return;
  const databaseName = new URL(testDatabaseUrl).pathname.slice(1);
  if (databaseName !== "shoe_store_tasks13_26_validation" || databaseName.includes("shineup")) {
    throw new Error(`Unsafe TEST_DATABASE_URL database: ${databaseName}`);
  }

  const prisma = new PrismaClient({ adapter: new PrismaPg({ connectionString: testDatabaseUrl }) });
  let app: Express;
  let disconnectAppDatabase: () => Promise<void>;
  const suffix = randomUUID();
  const adminId = randomUUID();
  const brandId = randomUUID();
  const categoryId = randomUUID();
  const productId = randomUUID();
  const customerIds: string[] = [];
  const orderIds: string[] = [];
  const adminEmail = `flow-admin-${suffix}@example.com`;
  const customerEmail = `flow-customer-${suffix}@example.com`;
  const customerPhone = `+216-${suffix.slice(0, 20)}`;
  const password = "Full-flow-password-123!";
  let variantId = "";
  let shippingMethodId = "";

  beforeAll(async () => {
    expect((await prisma.$queryRaw<Array<{ database: string }>>`SELECT current_database() AS database`)[0]?.database).toBe(databaseName);
    process.env.DATABASE_URL = testDatabaseUrl;
    process.env.AUTH_REQUIRE_EMAIL_VERIFICATION = "false";
    vi.resetModules();
    const [{ createApp }, { hashPassword }, appDatabase] = await Promise.all([
      import("../../src/app.js"),
      import("../../src/common/auth/auth.security.js"),
      import("../../src/config/database.js"),
    ]);
    app = createApp();
    disconnectAppDatabase = () => appDatabase.prisma.$disconnect();
    const adminRole = await prisma.role.findUniqueOrThrow({ where: { code: "ADMIN" } });
    await prisma.user.create({
      data: {
        id: adminId,
        email: adminEmail,
        passwordHash: await hashPassword(password),
        provider: "EMAIL",
        providerId: adminEmail,
        firstName: "Flow",
        lastName: "Admin",
        emailVerifiedAt: new Date(),
        role: "ADMIN",
        roles: { create: { roleId: adminRole.id } },
      },
    });
    await prisma.brand.create({ data: { id: brandId, name: `Flow ${suffix}`, slug: `flow-${suffix}` } });
    await prisma.category.create({ data: { id: categoryId, name: `Flow ${suffix}`, slug: `flow-${suffix}` } });
    const product = await prisma.product.create({
      data: {
        id: productId,
        brandId,
        name: `Flow Shoe ${suffix}`,
        slug: `flow-shoe-${suffix}`,
        status: "ACTIVE",
        publishedAt: new Date("2026-08-12T00:00:00.000Z"),
        basePrice: "125.00",
        productCategories: { create: { categoryId, isPrimary: true } },
        media: { create: { type: "IMAGE", url: "https://example.com/flow-shoe.jpg", isPrimary: true } },
        variants: {
          create: {
            sku: `FLOW-${suffix}`,
            title: "Default",
            priceMinor: 12_500n,
            costMinor: 7_000n,
            stockQuantity: 2,
            isActive: true,
          },
        },
      },
      include: { variants: true },
    });
    variantId = product.variants[0]!.id;
    shippingMethodId = (await prisma.shippingMethod.create({
      data: { code: `FLOW-${suffix}`, name: "Flow delivery", basePriceMinor: 500n, currency: "TND", isActive: true },
    })).id;
  }, 30_000);

  afterAll(async () => {
    if (orderIds.length) await prisma.returnRequest.deleteMany({ where: { orderId: { in: orderIds } } });
    if (orderIds.length) await prisma.productReview.deleteMany({ where: { orderItem: { orderId: { in: orderIds } } } });
    if (orderIds.length) await prisma.discountRedemption.deleteMany({ where: { orderId: { in: orderIds } } });
    if (orderIds.length) await prisma.orderStatusHistory.deleteMany({ where: { orderId: { in: orderIds } } });
    if (orderIds.length) await prisma.orderAddress.deleteMany({ where: { orderId: { in: orderIds } } });
    if (orderIds.length) await prisma.orderItem.deleteMany({ where: { orderId: { in: orderIds } } });
    if (orderIds.length) await prisma.order.deleteMany({ where: { id: { in: orderIds } } });
    if (customerIds.length) await prisma.cart.deleteMany({ where: { userId: { in: customerIds } } });
    if (customerIds.length) await prisma.address.deleteMany({ where: { userId: { in: customerIds } } });
    if (customerIds.length) await prisma.user.deleteMany({ where: { id: { in: customerIds } } });
    await prisma.user.deleteMany({ where: { id: adminId } });
    await prisma.shippingMethod.deleteMany({ where: { id: shippingMethodId } });
    await prisma.product.deleteMany({ where: { id: productId } });
    await prisma.category.deleteMany({ where: { id: categoryId } });
    await prisma.brand.deleteMany({ where: { id: brandId } });
    await disconnectAppDatabase?.();
    await prisma.$disconnect();
  }, 30_000);

  it("runs register through received Return with exact stock and history", async () => {
    const registration = await request(app).post("/api/v1/auth/register").send({
      email: customerEmail,
      password,
      firstName: "Flow",
      lastName: "Customer",
      phone: customerPhone,
    });
    expect(registration.status).toBe(201);
    const customerId = registration.body.data.user.id as string;
    customerIds.push(customerId);

    const customerLogin = await request(app).post("/api/v1/auth/login").send({ email: customerEmail, password });
    expect(customerLogin.status).toBe(200);
    const customerToken = customerLogin.body.data.accessToken as string;
    const customer = () => ({ Authorization: `Bearer ${customerToken}` });

    expect((await request(app).get("/api/v1/users/me").set(customer())).status).toBe(200);
    expect((await request(app).patch("/api/v1/users/me").set(customer()).send({ firstName: "Updated Flow" })).status).toBe(200);
    const addressResponse = await request(app).post("/api/v1/addresses").set(customer()).send({
      recipientName: "Flow Customer",
      phone: customerPhone,
      countryCode: "TN",
      city: "Tunis",
      line1: "1 Commerce Street",
      isDefault: true,
    });
    expect(addressResponse.status).toBe(201);
    const addressId = addressResponse.body.data.id as string;

    const catalog = await request(app).get(`/api/v1/catalog/products/flow-shoe-${suffix}`);
    expect(catalog.status).toBe(200);
    expect(JSON.stringify(catalog.body)).not.toContain("costMinor");

    const wishlist = await request(app).post("/api/v1/wishlist/items").set(customer()).send({ productId, variantId });
    expect(wishlist.status).toBe(201);
    const cart = await request(app).post("/api/v1/cart/items").set(customer()).send({ variantId, quantity: 1 });
    expect(cart.status).toBe(201);
    expect(cart.body.data.stockNotice).toContain("do not reserve");

    const preview = await request(app).post("/api/v1/checkout/preview").set(customer()).send({ addressId, shippingMethodId });
    expect(preview.status).toBe(200);
    expect(preview.body.data.totals.grandTotalMinor).toBe("13000");

    const placed = await request(app).post("/api/v1/orders").set(customer()).set("Idempotency-Key", `flow:${suffix}`).send({ addressId, shippingMethodId });
    expect(placed.status).toBe(201);
    const order = placed.body.data.order;
    const orderId = order.id as string;
    orderIds.push(orderId);
    const orderItemId = order.items[0].id as string;
    expect((await request(app).get(`/api/v1/orders/${orderId}`).set(customer())).status).toBe(200);

    const adminLogin = await request(app).post("/api/v1/auth/login").send({ email: adminEmail, password });
    expect(adminLogin.status).toBe(200);
    const adminToken = adminLogin.body.data.accessToken as string;
    const admin = () => ({ Authorization: `Bearer ${adminToken}` });
    expect((await request(app).post(`/api/v1/admin/orders/${orderId}/confirm`).set(admin()).send({ reason: "Validated" })).status).toBe(200);
    expect((await request(app).patch(`/api/v1/admin/orders/${orderId}/shipping`).set(admin()).send({ shippingProvider: "Manual Carrier", trackingNumber: `TRACK-${suffix}` })).status).toBe(200);
    expect((await request(app).post(`/api/v1/admin/orders/${orderId}/ship`).set(admin()).send({ reason: "Handed to carrier" })).status).toBe(200);
    expect((await request(app).post(`/api/v1/admin/orders/${orderId}/deliver`).set(admin()).send({ reason: "COD collected" })).status).toBe(200);
    expect((await request(app).get(`/api/v1/orders/${orderId}/shipment`).set(customer())).body.data.orderStatus).toBe("DELIVERED");

    const review = await request(app).post(`/api/v1/products/${productId}/reviews`).set(customer()).send({ orderItemId, rating: 5, title: "Delivered", body: "Verified flow review" });
    expect(review.status).toBe(201);
    const reviewId = review.body.data.id as string;
    expect((await request(app).post(`/api/v1/admin/reviews/${reviewId}/moderation`).set(admin()).send({ status: "APPROVED" })).status).toBe(200);
    expect((await request(app).get(`/api/v1/catalog/products/${productId}/reviews`)).body.data.aggregate).toMatchObject({ count: 1, averageRating: "5" });

    const requestedReturn = await request(app).post(`/api/v1/orders/${orderId}/returns`).set(customer()).send({ reasonCode: "SIZE", items: [{ orderItemId, quantity: 1 }] });
    expect(requestedReturn.status).toBe(201);
    const returnId = requestedReturn.body.data.id as string;
    const returnItemId = requestedReturn.body.data.items[0].id as string;
    expect((await request(app).post(`/api/v1/admin/returns/${returnId}/decision`).set(admin()).send({ status: "APPROVED" })).status).toBe(200);
    const received = await request(app).post(`/api/v1/admin/returns/${returnId}/receive`).set(admin()).send({ refundMethod: "MANUAL_CASH", restockableItemIds: [returnItemId] });
    expect(received.status).toBe(200);
    expect(received.body.data.return.refundNotice).toContain("manual/offline");

    expect((await prisma.productVariant.findUniqueOrThrow({ where: { id: variantId } })).stockQuantity).toBe(2);
    expect((await prisma.order.findUniqueOrThrow({ where: { id: orderId } }))).toMatchObject({ status: "RETURNED", paymentStatus: "PAID", refundedMinor: 12_500n });
    expect(await prisma.orderStatusHistory.count({ where: { orderId } })).toBe(5);
  });
});
