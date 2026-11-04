import { randomUUID } from "node:crypto";
import { PrismaPg } from "@prisma/adapter-pg";
import { PrismaClient } from "@prisma/client";
import { afterAll, beforeAll, describe, expect, it } from "vitest";
import { WishlistsRepository } from "../../src/modules/wishlists/wishlists.repository";
import { WishlistsService } from "../../src/modules/wishlists/wishlists.service";

const testDatabaseUrl = process.env.TEST_DATABASE_URL;
const describeDatabase = testDatabaseUrl ? describe : describe.skip;

describeDatabase("Task 17 Wishlist against disposable PostgreSQL", () => {
  if (!testDatabaseUrl) return;
  const databaseName = new URL(testDatabaseUrl).pathname.slice(1);
  if (databaseName !== "shoe_store_tasks13_26_validation" || databaseName.includes("shineup")) throw new Error(`Unsafe TEST_DATABASE_URL database: ${databaseName}`);
  const prisma = new PrismaClient({ adapter: new PrismaPg({ connectionString: testDatabaseUrl }) });
  const service = new WishlistsService(new WishlistsRepository(prisma));
  const userIds: string[] = [];
  const productIds: string[] = [];
  const brandIds: string[] = [];
  const categoryIds: string[] = [];

  beforeAll(async () => {
    const identity = await prisma.$queryRaw<Array<{ database: string }>>`SELECT current_database() AS database`;
    expect(identity[0]?.database).toBe("shoe_store_tasks13_26_validation");
  });
  afterAll(async () => {
    if (userIds.length) await prisma.user.deleteMany({ where: { id: { in: userIds } } });
    if (productIds.length) await prisma.product.deleteMany({ where: { id: { in: productIds } } });
    if (categoryIds.length) await prisma.category.deleteMany({ where: { id: { in: categoryIds } } });
    if (brandIds.length) await prisma.brand.deleteMany({ where: { id: { in: brandIds } } });
    await prisma.$disconnect();
  });

  async function createUser() {
    const id = randomUUID(); userIds.push(id);
    await prisma.user.create({ data: { id, email: `wishlist-${id}@example.com`, firstName: "Wish", lastName: "List" } });
    return id;
  }

  async function createProduct(status: "ACTIVE" | "DRAFT" = "ACTIVE") {
    const brandId = randomUUID(); const categoryId = randomUUID(); const productId = randomUUID();
    brandIds.push(brandId); categoryIds.push(categoryId); productIds.push(productId);
    await prisma.brand.create({ data: { id: brandId, name: `Wishlist ${brandId}`, slug: `wishlist-${brandId}` } });
    await prisma.category.create({ data: { id: categoryId, name: `Wishlist ${categoryId}`, slug: `wishlist-${categoryId}` } });
    const product = await prisma.product.create({ data: { id: productId, brandId, name: `Wishlist ${productId}`, slug: `wishlist-${productId}`, status, publishedAt: status === "ACTIVE" ? new Date("2026-08-12T00:00:00.000Z") : null, productCategories: { create: { categoryId, isPrimary: true } }, variants: { create: { sku: `WISH-${randomUUID()}`, title: "Default", priceMinor: 10_000n, stockQuantity: 1, isActive: true } } }, include: { variants: true } });
    return { productId, variantId: product.variants[0]!.id };
  }

  it("makes concurrent product-level duplicate adds idempotent despite nullable variant uniqueness", async () => {
    const userId = await createUser(); const product = await createProduct();
    const [first, second] = await Promise.all([service.add(userId, { productId: product.productId }, new Date()), service.add(userId, { productId: product.productId }, new Date())]);
    expect(first.id).toBe(second.id);
    expect(await prisma.wishlist.count({ where: { userId, productId: product.productId } })).toBe(1);
  });

  it("rejects draft Products and cross-Product variants", async () => {
    const userId = await createUser(); const draft = await createProduct("DRAFT"); const other = await createProduct();
    await expect(service.add(userId, { productId: draft.productId }, new Date())).rejects.toMatchObject({ code: "PRODUCT_NOT_FOUND" });
    await expect(service.add(userId, { productId: other.productId, variantId: draft.variantId }, new Date())).rejects.toMatchObject({ code: "PRODUCT_VARIANT_NOT_FOUND" });
  });

  it("scopes deletion to the authenticated customer", async () => {
    const ownerId = await createUser(); const otherId = await createUser(); const product = await createProduct();
    const item = await service.add(ownerId, { productId: product.productId, variantId: product.variantId }, new Date());
    await expect(service.delete(otherId, item.id)).rejects.toMatchObject({ code: "WISHLIST_ITEM_NOT_FOUND" });
    expect(await prisma.wishlist.count({ where: { id: item.id, userId: ownerId } })).toBe(1);
  });
});
