import { randomInt, randomUUID } from "node:crypto";
import { PrismaPg } from "@prisma/adapter-pg";
import { PrismaClient } from "@prisma/client";
import { afterAll, beforeAll, describe, expect, it } from "vitest";
import { DiscountsRepository } from "../../src/modules/discounts/discounts.repository";

const testDatabaseUrl = process.env.TEST_DATABASE_URL;
const describeDatabase = testDatabaseUrl ? describe : describe.skip;

describeDatabase("Task 16 Discount invariants against disposable PostgreSQL", () => {
  if (!testDatabaseUrl) return;
  const databaseName = new URL(testDatabaseUrl).pathname.slice(1);
  if (databaseName !== "shoe_store_tasks13_26_validation" || databaseName.includes("shineup")) throw new Error(`Unsafe TEST_DATABASE_URL database: ${databaseName}`);
  const prisma = new PrismaClient({ adapter: new PrismaPg({ connectionString: testDatabaseUrl }) });
  const repository = new DiscountsRepository(prisma);
  const discountIds: string[] = []; const userIds: string[] = []; const orderIds: string[] = [];

  beforeAll(async () => {
    const identity = await prisma.$queryRaw<Array<{ database: string }>>`SELECT current_database() AS database`;
    expect(identity[0]?.database).toBe("shoe_store_tasks13_26_validation");
    const stale = await prisma.discount.findMany({ where: { OR: [{ name: { startsWith: "Discount " } }, { name: { in: ["First", "Second"] } }] }, select: { id: true } });
    const staleIds = stale.map((item) => item.id);
    if (staleIds.length) await prisma.discountRedemption.deleteMany({ where: { discountId: { in: staleIds } } });
    if (staleIds.length) await prisma.discount.deleteMany({ where: { id: { in: staleIds } } });
  });
  afterAll(async () => {
    if (discountIds.length) await prisma.discountRedemption.deleteMany({ where: { discountId: { in: discountIds } } });
    if (orderIds.length) await prisma.order.deleteMany({ where: { id: { in: orderIds } } });
    if (discountIds.length) await prisma.discount.deleteMany({ where: { id: { in: discountIds } } });
    if (userIds.length) await prisma.user.deleteMany({ where: { id: { in: userIds } } });
    await prisma.$disconnect();
  });

  async function user() {
    const id = randomUUID(); userIds.push(id);
    await prisma.user.create({ data: { id, email: `discount-${id}@example.com`, firstName: "Discount", lastName: "Race" } });
    return id;
  }
  async function order(userId: string) {
    const id = randomUUID(); orderIds.push(id);
    await prisma.order.create({ data: { id, orderNumber: `D-${id}`, userId, customerEmail: `discount-${userId}@example.com`, customerPhone: "+21620000000", subtotalMinor: 100n, totalMinor: 100n } });
    return id;
  }
  async function discount(data: { usageLimit?: number; perCustomerLimit?: number }) {
    const id = randomUUID(); discountIds.push(id);
    await prisma.discount.create({ data: { id, name: `Discount ${id}`, code: `TEST-${id}`.toUpperCase(), type: "PERCENTAGE", scope: "ORDER", priority: randomInt(1_000_000, 2_000_000_000), value: 1000n, startsAt: new Date("2026-01-01T00:00:00.000Z"), ...data } });
    return id;
  }

  it("enforces unique priority under concurrent writes", async () => {
    const priority = randomInt(1_000_000, 2_000_000_000); const first = randomUUID(); const second = randomUUID();
    discountIds.push(first, second);
    const results = await Promise.allSettled([
      prisma.discount.create({ data: { id: first, name: "First", code: `TEST-${first}`.toUpperCase(), type: "PERCENTAGE", priority, value: 100n, startsAt: new Date() } }),
      prisma.discount.create({ data: { id: second, name: "Second", code: `TEST-${second}`.toUpperCase(), type: "PERCENTAGE", priority, value: 100n, startsAt: new Date() } }),
    ]);
    expect(results.filter((result) => result.status === "fulfilled")).toHaveLength(1);
  });

  it("enforces target XOR and partial target uniqueness", async () => {
    const discountId = await discount({});
    await expect(prisma.discountTarget.create({ data: { discountId } })).rejects.toBeDefined();
    const brand = await prisma.brand.create({ data: { name: `Brand ${randomUUID()}`, slug: `brand-${randomUUID()}` } });
    const product = await prisma.product.create({ data: { brandId: brand.id, name: "Target", slug: `target-${randomUUID()}` } });
    const category = await prisma.category.create({ data: { name: "Target", slug: `target-${randomUUID()}` } });
    await expect(prisma.discountTarget.create({ data: { discountId, productId: product.id, categoryId: category.id } })).rejects.toBeDefined();
    await prisma.discountTarget.create({ data: { discountId, productId: product.id } });
    await expect(prisma.discountTarget.create({ data: { discountId, productId: product.id } })).rejects.toBeDefined();
    await prisma.product.delete({ where: { id: product.id } }); await prisma.brand.delete({ where: { id: brand.id } }); await prisma.category.delete({ where: { id: category.id } });
  });

  async function attempt(discountId: string, userId: string, orderId: string) {
    return prisma.$transaction(async (transaction) => {
      const capacity = await repository.lockAndValidateUsage(transaction, [discountId], userId);
      if (capacity === "LIMIT_EXCEEDED") return capacity;
      await repository.createRedemptions(transaction, orderId, userId, [{ discountId, amountMinor: 10n }]);
      return "REDEEMED" as const;
    });
  }

  it("serializes the total usage limit", async () => {
    const discountId = await discount({ usageLimit: 1 }); const firstUser = await user(); const secondUser = await user();
    const results = await Promise.all([attempt(discountId, firstUser, await order(firstUser)), attempt(discountId, secondUser, await order(secondUser))]);
    expect(results.sort()).toEqual(["LIMIT_EXCEEDED", "REDEEMED"]);
    expect(await prisma.discountRedemption.count({ where: { discountId } })).toBe(1);
  });

  it("serializes the per-customer usage limit and redemption exact-once", async () => {
    const discountId = await discount({ perCustomerLimit: 1 }); const customer = await user(); const firstOrder = await order(customer); const secondOrder = await order(customer);
    const results = await Promise.all([attempt(discountId, customer, firstOrder), attempt(discountId, customer, secondOrder)]);
    expect(results.sort()).toEqual(["LIMIT_EXCEEDED", "REDEEMED"]);
    const appliedOrder = (await prisma.discountRedemption.findFirstOrThrow({ where: { discountId } })).orderId;
    await expect(prisma.discountRedemption.create({ data: { discountId, userId: customer, orderId: appliedOrder, amountMinor: 10n, redeemedAt: new Date() } })).rejects.toBeDefined();
  });
});
