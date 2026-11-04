import { randomUUID } from "node:crypto";
import { PrismaPg } from "@prisma/adapter-pg";
import { PrismaClient } from "@prisma/client";
import { afterAll, beforeAll, describe, expect, it } from "vitest";
import { CartsRepository } from "../../src/modules/carts/carts.repository";
import { CartsService } from "../../src/modules/carts/carts.service";

const testDatabaseUrl = process.env.TEST_DATABASE_URL;
const describeDatabase = testDatabaseUrl ? describe : describe.skip;

describeDatabase("Task 18 Cart against disposable PostgreSQL", () => {
  if (!testDatabaseUrl) return;
  const databaseName = new URL(testDatabaseUrl).pathname.slice(1);
  if (databaseName !== "shoe_store_tasks13_26_validation" || databaseName.includes("shineup")) throw new Error(`Unsafe TEST_DATABASE_URL database: ${databaseName}`);
  const prisma = new PrismaClient({ adapter: new PrismaPg({ connectionString: testDatabaseUrl }) });
  const service = new CartsService(new CartsRepository(prisma));
  const userIds: string[] = [];
  const productIds: string[] = [];
  const brandIds: string[] = [];
  const categoryIds: string[] = [];
  const discountIds: string[] = [];

  beforeAll(async () => {
    const identity = await prisma.$queryRaw<Array<{ database: string }>>`SELECT current_database() AS database`;
    expect(identity[0]?.database).toBe("shoe_store_tasks13_26_validation");
    await prisma.cartItem.deleteMany({ where: { variant: { product: { slug: { startsWith: "cart-" } } } } });
    await prisma.product.deleteMany({ where: { slug: { startsWith: "cart-" } } });
    await prisma.category.deleteMany({ where: { slug: { startsWith: "cart-" } } });
    await prisma.brand.deleteMany({ where: { slug: { startsWith: "cart-" } } });
  });
  afterAll(async () => {
    if (userIds.length) await prisma.cart.deleteMany({ where: { userId: { in: userIds } } });
    if (userIds.length) await prisma.user.deleteMany({ where: { id: { in: userIds } } });
    if (discountIds.length) await prisma.discount.deleteMany({ where: { id: { in: discountIds } } });
    if (productIds.length) await prisma.product.deleteMany({ where: { id: { in: productIds } } });
    if (categoryIds.length) await prisma.category.deleteMany({ where: { id: { in: categoryIds } } });
    if (brandIds.length) await prisma.brand.deleteMany({ where: { id: { in: brandIds } } });
    await prisma.$disconnect();
  });

  async function createUser() {
    const id = randomUUID(); userIds.push(id);
    await prisma.user.create({ data: { id, email: `cart-${id}@example.com`, firstName: "Cart", lastName: "Owner" } });
    return id;
  }

  async function createProduct(stock = 10, priceMinor = 10_000n) {
    const brandId = randomUUID(); const categoryId = randomUUID(); const productId = randomUUID();
    brandIds.push(brandId); categoryIds.push(categoryId); productIds.push(productId);
    await prisma.brand.create({ data: { id: brandId, name: `Cart ${brandId}`, slug: `cart-${brandId}` } });
    await prisma.category.create({ data: { id: categoryId, name: `Cart ${categoryId}`, slug: `cart-${categoryId}` } });
    const product = await prisma.product.create({ data: { id: productId, brandId, name: `Cart ${productId}`, slug: `cart-${productId}`, status: "ACTIVE", publishedAt: new Date("2026-08-12T00:00:00.000Z"), productCategories: { create: { categoryId, isPrimary: true } }, variants: { create: { sku: `CART-${randomUUID()}`, title: "Default", priceMinor, costMinor: 7_000n, stockQuantity: stock, isActive: true } } }, include: { variants: true } });
    return { productId, categoryId, variantId: product.variants[0]!.id };
  }

  it("atomically merges concurrent adds into one active Cart line without reserving stock", async () => {
    const userId = await createUser(); const product = await createProduct(10);
    await Promise.all([service.addItem(userId, { variantId: product.variantId, quantity: 1 }), service.addItem(userId, { variantId: product.variantId, quantity: 1 })]);
    const carts = await prisma.cart.findMany({ where: { userId, status: "ACTIVE" }, include: { items: true } });
    expect(carts).toHaveLength(1);
    expect(carts[0]?.items).toHaveLength(1);
    expect(carts[0]?.items[0]?.quantity).toBe(2);
    expect((await prisma.productVariant.findUniqueOrThrow({ where: { id: product.variantId } })).stockQuantity).toBe(10);
  });

  it("rejects insufficient stock and scopes item mutation through Cart ownership", async () => {
    const ownerId = await createUser(); const otherId = await createUser(); const product = await createProduct(2);
    const cart = await service.addItem(ownerId, { variantId: product.variantId, quantity: 1 });
    const itemId = cart.items[0]!.id;
    await expect(service.addItem(ownerId, { variantId: product.variantId, quantity: 2 })).rejects.toMatchObject({ code: "CART_INSUFFICIENT_STOCK" });
    await expect(service.updateItem(otherId, itemId, { quantity: 1 })).rejects.toMatchObject({ code: "CART_ITEM_NOT_FOUND" });
    await expect(service.deleteItem(otherId, itemId)).rejects.toMatchObject({ code: "CART_ITEM_NOT_FOUND" });
    expect(await prisma.cartItem.count({ where: { id: itemId } })).toBe(1);
  });

  it("calculates current exact pricing and discounts without leaking cost", async () => {
    const userId = await createUser(); const product = await createProduct(5, 10_001n);
    const discount = await prisma.discount.create({ data: { name: `Cart ten percent ${randomUUID()}`, type: "PERCENTAGE", scope: "PRODUCT", priority: 1_700_000_000, value: 1_000n, startsAt: new Date("2026-08-12T00:00:00.000Z"), targets: { create: { productId: product.productId } } } });
    discountIds.push(discount.id);
    await service.addItem(userId, { variantId: product.variantId, quantity: 2 }, new Date("2026-08-13T00:00:00.000Z"));
    const cart = await service.get(userId, new Date("2026-08-13T00:00:00.000Z"));
    expect(cart.totals).toEqual({ subtotalMinor: "20002", merchandiseDiscountMinor: "2000", estimatedTotalMinor: "18002" });
    expect(cart.checkoutEligible).toBe(true);
    expect(JSON.stringify(cart)).not.toContain("costMinor");
    expect(JSON.stringify(cart)).not.toContain("1000n");
  });

  it("updates, deletes, clears, and validates coupon eligibility", async () => {
    const userId = await createUser(); const product = await createProduct(5);
    const discount = await prisma.discount.create({ data: { name: `Cart coupon ${randomUUID()}`, code: `SAVE-${randomUUID()}`.toUpperCase(), type: "FIXED_AMOUNT", scope: "ORDER", priority: 1_700_000_001, value: 500n, currency: "TND", startsAt: new Date("2026-08-12T00:00:00.000Z") } });
    discountIds.push(discount.id);
    let cart = await service.addItem(userId, { variantId: product.variantId, quantity: 1 }, new Date("2026-08-13T00:00:00.000Z"));
    cart = await service.updateItem(userId, cart.items[0]!.id, { quantity: 2 }, new Date("2026-08-13T00:00:00.000Z"));
    expect(cart.items[0]!.quantity).toBe(2);
    cart = await service.setDiscountCode(userId, { code: discount.code! }, new Date("2026-08-13T00:00:00.000Z"));
    expect(cart.discountCode).toBe(discount.code);
    await expect(service.setDiscountCode(userId, { code: "DOES-NOT-EXIST" }, new Date("2026-08-13T00:00:00.000Z"))).rejects.toMatchObject({ code: "DISCOUNT_CODE_NOT_ELIGIBLE" });
    await service.deleteItem(userId, cart.items[0]!.id);
    await service.clear(userId);
    expect((await service.get(userId)).items).toHaveLength(0);
  });
});
