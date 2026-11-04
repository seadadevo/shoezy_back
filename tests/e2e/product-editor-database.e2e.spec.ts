import { randomUUID } from "node:crypto";
import { PrismaPg } from "@prisma/adapter-pg";
import { PrismaClient } from "@prisma/client";
import { afterAll, beforeAll, describe, expect, it, vi } from "vitest";
import { ProductEditorRepository } from "../../src/modules/products/product-editor.repository";
import { ProductEditorService } from "../../src/modules/products/product-editor.service";
import type { MediaStorage } from "../../src/modules/products/media-storage";

const databaseUrl = process.env.TEST_DATABASE_URL;
const describeDatabase = databaseUrl ? describe : describe.skip;
describeDatabase("complete product save against disposable PostgreSQL", () => {
  if (!databaseUrl) return;
  const databaseName = new URL(databaseUrl).pathname.slice(1);
  if (!new Set(["shoe_store_tasks05_12_validation", "shoe_store_tasks13_26_validation"]).has(databaseName)) throw new Error(`Unsafe TEST_DATABASE_URL database: ${databaseName}`);
  const client = new PrismaClient({ adapter: new PrismaPg({ connectionString: databaseUrl }) });
  const brandId = randomUUID(), categoryId = randomUUID(), actorId = randomUUID();
  const productIds: string[] = [];
  let uploads = 0;
  const storage = { isConfigured: vi.fn(() => true), upload: vi.fn(async () => { uploads += 1; return { provider: "CLOUDINARY" as const, key: `shoozy/test/${uploads}`, url: `https://example.com/${uploads}.png` }; }), delete: vi.fn(async () => undefined) } satisfies MediaStorage;
  const service = new ProductEditorService(new ProductEditorRepository(client), storage);
  const png = Buffer.from([137, 80, 78, 71, 13, 10, 26, 10, 0]);
  const file = { buffer: png, mimetype: "image/png", size: png.length };
  const slug = `editor-${randomUUID()}`;
  beforeAll(async () => {
    expect((await client.$queryRaw<Array<{ database: string }>>`SELECT current_database() AS database`)[0]?.database).toBe(databaseName);
    await client.user.create({ data: { id: actorId, email: `${actorId}@example.com`, firstName: "Editor", lastName: "Test" } });
    await client.brand.create({ data: { id: brandId, name: `Brand ${brandId}`, slug: `brand-${brandId}` } });
    await client.category.create({ data: { id: categoryId, name: `Category ${categoryId}`, slug: `category-${categoryId}` } });
  });
  afterAll(async () => {
    if (productIds.length) await client.product.deleteMany({ where: { id: { in: productIds } } });
    await client.adminAuditLog.deleteMany({ where: { actorUserId: actorId } });
    await client.category.deleteMany({ where: { id: categoryId } });
    await client.brand.deleteMany({ where: { id: brandId } });
    await client.user.deleteMany({ where: { id: actorId } });
    await client.$disconnect();
  });
  it("creates categories, options, values, variant, movement, and two mapped media atomically", async () => {
    const result = await service.create({
      product: { brandId, name: "Runner", slug, basePrice: "120.00" },
      categories: { categoryIds: [categoryId], primaryCategoryId: categoryId },
      options: [{ clientKey: "size", name: "Size", values: [{ clientKey: "size42", value: "42" }] }],
      variants: [{ clientKey: "runner42", sku: `RUN-${randomUUID()}`, title: "42", priceMinor: "120000", stockQuantity: 10, optionValueClientKeys: ["size42"] }],
      media: [{ fileIndex: 0, isPrimary: true }, { fileIndex: 1, variantClientKey: "runner42", position: 1 }],
    }, [file, file], actorId);
    productIds.push(result.id);
    expect(result).toMatchObject({ slug, categories: [{ id: categoryId, isPrimary: true }], options: [{ values: [{ value: "42" }] }], variants: [{ stockQuantity: 10 }], media: [{ isPrimary: true }, { variantId: result.variants[0]?.id }] });
    const movements = await client.inventoryMovement.findMany({ where: { variantId: result.variants[0]!.id } });
    expect(movements).toMatchObject([{ type: "INITIAL_STOCK", beforeQuantity: 0, afterQuantity: 10 }]);
    const edited = await service.update(result.id, { variants: { upsert: [{ id: result.variants[0]!.id, stockQuantity: 7 }], deleteIds: [] } }, [], actorId);
    expect(edited.categories).toHaveLength(1);
    expect(edited.options).toHaveLength(1);
    expect(edited.variants[0]?.stockQuantity).toBe(7);
    expect(await client.inventoryMovement.count({ where: { variantId: result.variants[0]!.id, type: "MANUAL_SET" } })).toBe(1);
    await expect(service.update(result.id, { options: { upsert: [], deleteIds: [result.options[0]!.id] }, product: { name: "Should Roll Back" } }, [], actorId)).rejects.toMatchObject({ code: "PRODUCT_OPTION_IN_USE" });
    expect((await client.product.findUniqueOrThrow({ where: { id: result.id }, select: { name: true } })).name).toBe("Runner");
  });
  it("rolls back invalid references and compensates the uploaded image", async () => {
    const candidate = `invalid-${randomUUID()}`;
    const before = await client.product.count();
    await expect(service.create({ product: { brandId, name: "Invalid", slug: candidate, basePrice: "10.00" }, categories: { categoryIds: [randomUUID()], primaryCategoryId: null }, media: [{ fileIndex: 0 }] }, [file], actorId)).rejects.toMatchObject({ code: "PRODUCT_EDITOR_REFERENCE_INVALID" });
    expect(await client.product.count()).toBe(before);
    expect(storage.delete).toHaveBeenCalledWith(`shoozy/test/${uploads}`);
  });
});
