import { randomUUID } from "node:crypto";
import { PrismaPg } from "@prisma/adapter-pg";
import { PrismaClient } from "@prisma/client";
import { afterAll, beforeAll, describe, expect, it } from "vitest";
import { ProductMediaRepository } from "../../src/modules/products/product-media.repository";

const testDatabaseUrl = process.env.TEST_DATABASE_URL;
const describeDatabase = testDatabaseUrl ? describe : describe.skip;

describeDatabase("Task 13 Product Media concurrency against disposable PostgreSQL", () => {
  if (!testDatabaseUrl) return;
  const databaseName = new URL(testDatabaseUrl).pathname.slice(1);
  if (databaseName !== "shoe_store_tasks13_26_validation" || databaseName.includes("shineup")) {
    throw new Error(`Unsafe TEST_DATABASE_URL database: ${databaseName}`);
  }
  const prisma = new PrismaClient({ adapter: new PrismaPg({ connectionString: testDatabaseUrl }) });
  const repository = new ProductMediaRepository(prisma);
  const productIds: string[] = [];
  const brandIds: string[] = [];

  beforeAll(async () => {
    const identity = await prisma.$queryRaw<Array<{ database: string }>>`SELECT current_database() AS database`;
    expect(identity[0]?.database).toBe("shoe_store_tasks13_26_validation");
  });

  afterAll(async () => {
    if (productIds.length) await prisma.product.deleteMany({ where: { id: { in: productIds } } });
    if (brandIds.length) await prisma.brand.deleteMany({ where: { id: { in: brandIds } } });
    await prisma.$disconnect();
  });

  async function createProduct() {
    const brandId = randomUUID();
    const productId = randomUUID();
    brandIds.push(brandId);
    productIds.push(productId);
    await prisma.brand.create({ data: { id: brandId, name: `Media ${brandId}`, slug: `media-${brandId}` } });
    await prisma.product.create({ data: { id: productId, brandId, name: `Media ${productId}`, slug: `media-${productId}` } });
    return productId;
  }

  it("leaves exactly one primary after concurrent primary creates", async () => {
    const productId = await createProduct();
    await Promise.all([
      repository.create(productId, { type: "IMAGE", url: "https://example.com/first.jpg", isPrimary: true }),
      repository.create(productId, { type: "IMAGE", url: "https://example.com/second.jpg", isPrimary: true }),
    ]);
    expect(await prisma.productMedia.count({ where: { productId, isPrimary: true } })).toBe(1);
  });

  it("rejects cross-product Variant association", async () => {
    const productId = await createProduct();
    const otherProductId = await createProduct();
    const variant = await prisma.productVariant.create({
      data: { productId: otherProductId, sku: `MEDIA-${randomUUID()}`, title: "Other", priceMinor: 100n },
    });
    await expect(repository.create(productId, {
      variantId: variant.id,
      type: "IMAGE",
      url: "https://example.com/cross-product.jpg",
    })).resolves.toEqual({ status: "VARIANT_NOT_FOUND" });
  });
});
