import { randomUUID } from "node:crypto";
import { PrismaPg } from "@prisma/adapter-pg";
import { PrismaClient } from "@prisma/client";
import { afterAll, beforeAll, describe, expect, it } from "vitest";
import { CartsRepository } from "../../src/modules/carts/carts.repository";
import { CartsService } from "../../src/modules/carts/carts.service";
import { CheckoutRepository } from "../../src/modules/checkout/checkout.repository";
import { CheckoutService } from "../../src/modules/checkout/checkout.service";
import { ExchangesRepository } from "../../src/modules/exchanges/exchanges.repository";
import { ExchangesService } from "../../src/modules/exchanges/exchanges.service";
import { OrdersRepository } from "../../src/modules/orders/orders.repository";
import { OrdersService } from "../../src/modules/orders/orders.service";
import { ReturnsRepository } from "../../src/modules/returns/returns.repository";
import { ReturnsService } from "../../src/modules/returns/returns.service";

const url = process.env.TEST_DATABASE_URL;
const describeDatabase = url ? describe : describe.skip;
describeDatabase("store extensions against disposable PostgreSQL", () => {
  if (!url) return;
  const databaseName = new URL(url).pathname.slice(1);
  if (databaseName !== "shoe_store_tasks13_26_validation" || databaseName.includes("shineup")) throw new Error(`Unsafe TEST_DATABASE_URL database: ${databaseName}`);
  const prisma = new PrismaClient({ adapter: new PrismaPg({ connectionString: url }) });
  const carts = new CartsService(new CartsRepository(prisma));
  const checkout = new CheckoutService(new CheckoutRepository(prisma));
  const orders = new OrdersService(new OrdersRepository(prisma));
  const exchanges = new ExchangesService(new ExchangesRepository(prisma));
  const returns = new ReturnsService(new ReturnsRepository(prisma));
  const users: string[] = [], products: string[] = [], brands: string[] = [], categories: string[] = [], methods: string[] = [], zones: string[] = [], orderIds: string[] = [];

  beforeAll(async () => expect((await prisma.$queryRaw<Array<{ database: string }>>`SELECT current_database() AS database`)[0]?.database).toBe(databaseName));
  afterAll(async () => {
    if (orderIds.length) {
      await prisma.exchangeRequest.deleteMany({ where: { orderId: { in: orderIds } } });
      await prisma.returnRequest.deleteMany({ where: { orderId: { in: orderIds } } });
      await prisma.orderStatusHistory.deleteMany({ where: { orderId: { in: orderIds } } });
      await prisma.orderAddress.deleteMany({ where: { orderId: { in: orderIds } } });
      await prisma.orderItem.deleteMany({ where: { orderId: { in: orderIds } } });
      await prisma.order.deleteMany({ where: { id: { in: orderIds } } });
    }
    if (zones.length) await prisma.shippingZone.deleteMany({ where: { id: { in: zones } } });
    if (users.length) await prisma.cart.deleteMany({ where: { userId: { in: users } } });
    if (users.length) await prisma.user.deleteMany({ where: { id: { in: users } } });
    if (methods.length) await prisma.shippingMethod.deleteMany({ where: { id: { in: methods } } });
    if (products.length) await prisma.product.deleteMany({ where: { id: { in: products } } });
    if (categories.length) await prisma.category.deleteMany({ where: { id: { in: categories } } });
    if (brands.length) await prisma.brand.deleteMany({ where: { id: { in: brands } } });
    await prisma.$disconnect();
  });

  async function fixture() {
    const userId = randomUUID(), brandId = randomUUID(), categoryId = randomUUID(), productId = randomUUID();
    users.push(userId); brands.push(brandId); categories.push(categoryId); products.push(productId);
    const user = await prisma.user.create({ data: { id: userId, email: `extension-${userId}@example.com`, firstName: "Amina", lastName: "Test" } });
    const address = await prisma.address.create({ data: { userId, recipientName: "Amina Test", phone: "+21620123456", countryCode: "TN", state: "Tunis", city: "Tunis", area: "Medina", line1: "1 Avenue" } });
    await prisma.brand.create({ data: { id: brandId, name: `Extension ${brandId}`, slug: `extension-${brandId}` } });
    await prisma.category.create({ data: { id: categoryId, name: `Extension ${categoryId}`, slug: `extension-${categoryId}` } });
    const product = await prisma.product.create({ data: { id: productId, brandId, name: "Runner", slug: `runner-${productId}`, status: "ACTIVE", publishedAt: new Date("2026-01-01T00:00:00Z"), productCategories: { create: { categoryId, isPrimary: true } }, variants: { create: [{ sku: `ORIG-${randomUUID()}`, title: "42", priceMinor: 12000n, stockQuantity: 3 }, { sku: `REPL-${randomUUID()}`, title: "43", priceMinor: 12000n, stockQuantity: 2 }] } }, include: { variants: true } });
    return { user, address, product, original: product.variants[0]!, replacement: product.variants[1]! };
  }

  it("uses the same zone rate in checkout and order placement and audits each stock change once", async () => {
    const f = await fixture();
    const method = await prisma.shippingMethod.create({ data: { code: `EXT-${randomUUID()}`, name: "Courier", basePriceMinor: 999n } }); methods.push(method.id);
    const zone = await prisma.shippingZone.create({ data: { code: `ZONE-${randomUUID()}`, name: "Tunis", areas: { create: { state: "Tunis", city: "Tunis", area: "Medina", stateKey: "tunis", cityKey: "tunis", areaKey: "medina" } }, rates: { create: { shippingMethodId: method.id, priceMinor: 3456n } } } }); zones.push(zone.id);
    await carts.addItem(f.user.id, { variantId: f.original.id, quantity: 1 });
    const input = { addressId: f.address.id, shippingMethodId: method.id };
    const preview = await checkout.preview(f.user.id, input);
    expect(preview.totals.shippingMinor).toBe("3456");
    expect(preview.shippingZone).toMatchObject({ code: zone.code });
    const key = `extension-${randomUUID()}`;
    const placed = await orders.place(f.user.id, key, input); orderIds.push(placed.order.id);
    expect(placed.order.totals.shippingMinor).toBe(preview.totals.shippingMinor);
    expect(placed.order.paymentMethod).toBe("COD");
    expect(placed.order.paymentStatus).toBe("PENDING");
    expect(await prisma.inventoryMovement.count({ where: { referenceId: placed.order.id, type: "ORDER_PLACED" } })).toBe(1);
    const replay = await orders.place(f.user.id, key, input);
    expect(replay.whatsappConfirmation).toEqual(placed.whatsappConfirmation);
    expect(await prisma.inventoryMovement.count({ where: { referenceId: placed.order.id, type: "ORDER_PLACED" } })).toBe(1);
    await orders.cancelOwn(f.user.id, placed.order.id, {});
    await orders.cancelOwn(f.user.id, placed.order.id, {});
    expect(await prisma.inventoryMovement.count({ where: { referenceId: placed.order.id, type: "ORDER_CANCELLED" } })).toBe(1);

    const missing = await prisma.shippingMethod.create({ data: { code: `MISS-${randomUUID()}`, name: "Unrated", basePriceMinor: 500n } }); methods.push(missing.id);
    await carts.addItem(f.user.id, { variantId: f.original.id, quantity: 1 });
    await expect(checkout.preview(f.user.id, { addressId: f.address.id, shippingMethodId: missing.id })).rejects.toMatchObject({ code: "SHIPPING_RATE_NOT_AVAILABLE" });
    await expect(orders.place(f.user.id, `extension-${randomUUID()}`, { addressId: f.address.id, shippingMethodId: missing.id })).rejects.toMatchObject({ code: "SHIPPING_RATE_NOT_AVAILABLE" });
  });

  it("completes a size exchange atomically and blocks duplicate return quantity", async () => {
    const f = await fixture();
    const order = await prisma.order.create({ data: { orderNumber: `EXC-${randomUUID()}`, userId: f.user.id, status: "DELIVERED", paymentMethod: "COD", paymentStatus: "PAID", customerEmail: f.user.email, customerPhone: "+21620123456", subtotalMinor: 12000n, totalMinor: 12000n, paidMinor: 12000n, statusHistory: { create: { fromStatus: "SHIPPED", toStatus: "DELIVERED", createdAt: new Date(), changedByUserId: f.user.id } }, items: { create: { productId: f.product.id, variantId: f.original.id, productName: f.product.name, variantName: f.original.title, sku: f.original.sku, quantity: 1, unitPriceMinor: 12000n, lineTotalMinor: 12000n, snapshotJson: {} } } }, include: { items: true } }); orderIds.push(order.id);
    const requested = await exchanges.create(f.user.id, order.id, { orderItemId: order.items[0]!.id, replacementVariantId: f.replacement.id, quantity: 1 });
    await expect(returns.create(f.user.id, order.id, { reasonCode: "SIZE", items: [{ orderItemId: order.items[0]!.id, quantity: 1 }] })).rejects.toMatchObject({ code: "RETURN_QUANTITY_EXCEEDED" });
    await exchanges.decide(requested.id, "APPROVED");
    const completed = await exchanges.complete(f.user.id, requested.id);
    expect(completed.idempotentReplay).toBe(false);
    expect(await exchanges.complete(f.user.id, requested.id)).toMatchObject({ idempotentReplay: true });
    expect((await prisma.productVariant.findUniqueOrThrow({ where: { id: f.original.id } })).stockQuantity).toBe(4);
    expect((await prisma.productVariant.findUniqueOrThrow({ where: { id: f.replacement.id } })).stockQuantity).toBe(1);
    expect((await prisma.inventoryMovement.findMany({ where: { referenceId: requested.id }, orderBy: { type: "asc" } })).map((movement) => movement.type).sort()).toEqual(["EXCHANGE_REPLACEMENT", "EXCHANGE_RETURNED"]);
    expect((await prisma.order.findUniqueOrThrow({ where: { id: order.id } })).status).toBe("DELIVERED");
  });
});
