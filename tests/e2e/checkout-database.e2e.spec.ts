import { randomUUID } from "node:crypto";
import { PrismaPg } from "@prisma/adapter-pg";
import { PrismaClient } from "@prisma/client";
import { afterAll, beforeAll, describe, expect, it } from "vitest";
import { CartsRepository } from "../../src/modules/carts/carts.repository";
import { CartsService } from "../../src/modules/carts/carts.service";
import { CheckoutRepository } from "../../src/modules/checkout/checkout.repository";
import { CheckoutService } from "../../src/modules/checkout/checkout.service";

const testDatabaseUrl = process.env.TEST_DATABASE_URL;
const describeDatabase = testDatabaseUrl ? describe : describe.skip;

describeDatabase("Task 19 Checkout preview against disposable PostgreSQL", () => {
  if (!testDatabaseUrl) return;
  const databaseName = new URL(testDatabaseUrl).pathname.slice(1);
  if (databaseName !== "shoe_store_tasks13_26_validation" || databaseName.includes("shineup")) throw new Error(`Unsafe TEST_DATABASE_URL database: ${databaseName}`);
  const prisma = new PrismaClient({ adapter: new PrismaPg({ connectionString: testDatabaseUrl }) });
  const carts = new CartsService(new CartsRepository(prisma));
  const checkout = new CheckoutService(new CheckoutRepository(prisma));
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
    if (userIds.length) await prisma.cart.deleteMany({ where: { userId: { in: userIds } } });
    if (userIds.length) await prisma.user.deleteMany({ where: { id: { in: userIds } } });
    if (shippingIds.length) await prisma.shippingMethod.deleteMany({ where: { id: { in: shippingIds } } });
    if (productIds.length) await prisma.product.deleteMany({ where: { id: { in: productIds } } });
    if (categoryIds.length) await prisma.category.deleteMany({ where: { id: { in: categoryIds } } });
    if (brandIds.length) await prisma.brand.deleteMany({ where: { id: { in: brandIds } } });
    await prisma.$disconnect();
  });

  async function createUser() {
    const id = randomUUID(); userIds.push(id);
    const user = await prisma.user.create({ data: { id, email: `checkout-${id}@example.com`, firstName: "Check", lastName: "Out" } });
    const address = await prisma.address.create({ data: { userId: id, recipientName: "Check Out", phone: "+21620000000", countryCode: "TN", city: "Tunis", line1: "1 Test Street" } });
    return { user, address };
  }

  async function createProduct(stock = 3) {
    const brandId = randomUUID(); const categoryId = randomUUID(); const productId = randomUUID();
    brandIds.push(brandId); categoryIds.push(categoryId); productIds.push(productId);
    await prisma.brand.create({ data: { id: brandId, name: `Checkout ${brandId}`, slug: `checkout-${brandId}` } });
    await prisma.category.create({ data: { id: categoryId, name: `Checkout ${categoryId}`, slug: `checkout-${categoryId}` } });
    const product = await prisma.product.create({ data: { id: productId, brandId, name: `Checkout ${productId}`, slug: `checkout-${productId}`, status: "ACTIVE", publishedAt: new Date("2026-08-12T00:00:00.000Z"), productCategories: { create: { categoryId, isPrimary: true } }, variants: { create: { sku: `CHECKOUT-${randomUUID()}`, title: "Default", priceMinor: 10_001n, stockQuantity: stock, isActive: true } } }, include: { variants: true } });
    return { productId, variantId: product.variants[0]!.id };
  }

  async function createShipping(active = true) {
    const shipping = await prisma.shippingMethod.create({ data: { code: `CHECKOUT-${randomUUID()}`, name: "Checkout delivery", basePriceMinor: 999n, currency: "TND", estimatedMinDays: 1, estimatedMaxDays: 3, isActive: active } });
    shippingIds.push(shipping.id); return shipping;
  }

  it("returns exact current totals and performs no Cart or inventory mutation", async () => {
    const { user, address } = await createUser(); const product = await createProduct(); const shipping = await createShipping();
    await carts.addItem(user.id, { variantId: product.variantId, quantity: 2 }, new Date("2026-08-13T00:00:00.000Z"));
    const beforeVariant = await prisma.productVariant.findUniqueOrThrow({ where: { id: product.variantId } });
    const beforeCart = await prisma.cart.findFirstOrThrow({ where: { userId: user.id, status: "ACTIVE" }, include: { items: true } });
    const preview = await checkout.preview(user.id, { addressId: address.id, shippingMethodId: shipping.id }, new Date("2026-08-13T00:00:00.000Z"));
    const afterVariant = await prisma.productVariant.findUniqueOrThrow({ where: { id: product.variantId } });
    const afterCart = await prisma.cart.findFirstOrThrow({ where: { userId: user.id, status: "ACTIVE" }, include: { items: true } });
    expect(preview.totals).toEqual({ itemsSubtotalMinor: "20002", merchandiseDiscountMinor: "0", shippingMinor: "999", shippingDiscountMinor: "0", totalDiscountMinor: "0", grandTotalMinor: "21001" });
    expect(preview.advisory).toBe(true);
    expect(afterVariant.stockQuantity).toBe(beforeVariant.stockQuantity);
    expect(afterCart).toEqual(beforeCart);
    expect(JSON.stringify(preview)).not.toContain("costMinor");
  });

  it("rejects empty Carts, foreign Addresses, and inactive Shipping Methods", async () => {
    const first = await createUser(); const second = await createUser(); const shipping = await createShipping(false);
    await expect(checkout.preview(first.user.id, { addressId: second.address.id, shippingMethodId: shipping.id })).rejects.toMatchObject({ code: "ADDRESS_NOT_FOUND" });
    await expect(checkout.preview(first.user.id, { addressId: first.address.id, shippingMethodId: shipping.id })).rejects.toMatchObject({ code: "SHIPPING_METHOD_NOT_FOUND" });
    const activeShipping = await createShipping();
    await expect(checkout.preview(first.user.id, { addressId: first.address.id, shippingMethodId: activeShipping.id })).rejects.toMatchObject({ code: "CHECKOUT_CART_EMPTY" });
  });

  it("revalidates changed stock, sellability, and discounts", async () => {
    const first = await createUser(); const product = await createProduct(1); const shipping = await createShipping();
    await carts.addItem(first.user.id, { variantId: product.variantId, quantity: 1 });
    await prisma.productVariant.update({ where: { id: product.variantId }, data: { stockQuantity: 0 } });
    await expect(checkout.preview(first.user.id, { addressId: first.address.id, shippingMethodId: shipping.id })).rejects.toMatchObject({ code: "CHECKOUT_INSUFFICIENT_STOCK" });
    await prisma.productVariant.update({ where: { id: product.variantId }, data: { stockQuantity: 1, isActive: false } });
    await expect(checkout.preview(first.user.id, { addressId: first.address.id, shippingMethodId: shipping.id })).rejects.toMatchObject({ code: "CHECKOUT_ITEM_UNAVAILABLE" });
    await prisma.productVariant.update({ where: { id: product.variantId }, data: { isActive: true } });
    await prisma.cart.updateMany({ where: { userId: first.user.id, status: "ACTIVE" }, data: { discountCode: "EXPIRED-CODE" } });
    await expect(checkout.preview(first.user.id, { addressId: first.address.id, shippingMethodId: shipping.id })).rejects.toMatchObject({ code: "CHECKOUT_DISCOUNT_CHANGED" });
  });
});
