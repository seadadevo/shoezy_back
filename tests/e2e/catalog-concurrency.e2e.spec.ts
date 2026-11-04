import { randomUUID } from "node:crypto";
import { PrismaPg } from "@prisma/adapter-pg";
import { PrismaClient } from "@prisma/client";
import { afterAll, beforeAll, describe, expect, it } from "vitest";
import { AddressesRepository } from "../../src/modules/addresses/addresses.repository";
import { BrandsRepository } from "../../src/modules/brands/brands.repository";
import { BrandsService } from "../../src/modules/brands/brands.service";
import { CategoriesRepository } from "../../src/modules/categories/categories.repository";
import { CategoriesService } from "../../src/modules/categories/categories.service";
import { ProductOptionsRepository } from "../../src/modules/products/product-options.repository";
import { ProductOptionsService } from "../../src/modules/products/product-options.service";
import { ProductsRepository } from "../../src/modules/products/products.repository";
import { ProductsService } from "../../src/modules/products/products.service";
import { UsersRepository } from "../../src/modules/users/users.repository";
import { VariantsRepository } from "../../src/modules/variants/variants.repository";
import { VariantsService } from "../../src/modules/variants/variants.service";

const testDatabaseUrl = process.env.TEST_DATABASE_URL;
const describeDatabase = testDatabaseUrl ? describe : describe.skip;

describeDatabase("Tasks 05-12 concurrency against disposable PostgreSQL", () => {
  if (!testDatabaseUrl) return;
  const databaseName = new URL(testDatabaseUrl).pathname.slice(1);
  if (!new Set(["shoe_store_tasks05_12_validation", "shoe_store_tasks13_26_validation"]).has(databaseName) || databaseName.includes("shineup")) {
    throw new Error(`Unsafe TEST_DATABASE_URL database: ${databaseName}`);
  }
  const prisma = new PrismaClient({ adapter: new PrismaPg({ connectionString: testDatabaseUrl }) });
  const addresses = new AddressesRepository(prisma);
  const brands = new BrandsRepository(prisma);
  const brandService = new BrandsService(brands);
  const categories = new CategoriesRepository(prisma);
  const categoryService = new CategoriesService(categories);
  const productOptions = new ProductOptionsRepository(prisma);
  const productOptionsService = new ProductOptionsService(productOptions);
  const products = new ProductsRepository(prisma);
  const productService = new ProductsService(products);
  const users = new UsersRepository(prisma);
  const variants = new VariantsRepository(prisma);
  const variantService = new VariantsService(variants);
  const userIds: string[] = [];
  const productIds: string[] = [];
  const categoryIds: string[] = [];
  const brandIds: string[] = [];

  beforeAll(async () => {
    const identity = await prisma.$queryRaw<Array<{ database: string }>>`SELECT current_database() AS database`;
    expect(new Set(["shoe_store_tasks05_12_validation", "shoe_store_tasks13_26_validation"])).toContain(identity[0]?.database);
  });
  afterAll(async () => {
    if (productIds.length) await prisma.product.deleteMany({ where: { id: { in: productIds } } });
    if (categoryIds.length) await prisma.category.deleteMany({ where: { id: { in: categoryIds } } });
    if (brandIds.length) await prisma.brand.deleteMany({ where: { id: { in: brandIds } } });
    if (userIds.length) await prisma.user.deleteMany({ where: { id: { in: userIds } } });
    await prisma.$disconnect();
  });

  async function createUser() {
    const id = randomUUID(); userIds.push(id);
    await prisma.user.create({ data: { id, email: `tasks05-12-${id}@example.com`, firstName: "Race", lastName: "Test" } });
    return id;
  }
  async function createProduct() {
    const brandId = randomUUID(); const productId = randomUUID(); brandIds.push(brandId); productIds.push(productId);
    await prisma.brand.create({ data: { id: brandId, name: `Brand ${brandId}`, slug: `brand-${brandId}` } });
    await prisma.product.create({ data: { id: productId, brandId, name: `Product ${productId}`, slug: `product-${productId}` } });
    return productId;
  }

  it("keeps at most one default address during concurrent default creation", async () => {
    const userId = await createUser();
    const base = { recipientName: "Race Test", phone: "+21620000000", countryCode: "TN", city: "Tunis", line1: "1 Main Street", isDefault: true };
    await Promise.all([
      addresses.createOwned(userId, { ...base, label: "First" }),
      addresses.createOwned(userId, { ...base, label: "Second" }),
    ]);
    expect(await prisma.address.count({ where: { userId, isDefault: true } })).toBe(1);
  });

  it("maps a concurrent duplicate phone and persists it once", async () => {
    const [first, second] = await Promise.all([createUser(), createUser()]);
    const results = await Promise.allSettled([
      users.updateProfile(first, { phone: "+21621111111" }),
      users.updateProfile(second, { phone: "+21621111111" }),
    ]);
    expect(results.filter((result) => result.status === "fulfilled")).toHaveLength(1);
    expect(await prisma.user.count({ where: { phone: "+21621111111" } })).toBe(1);
  });

  it("leaves exactly one primary link after concurrent category replacement", async () => {
    const productId = await createProduct();
    const ids = [randomUUID(), randomUUID()]; categoryIds.push(...ids);
    await prisma.category.createMany({ data: ids.map((id) => ({ id, name: `Category ${id}`, slug: `category-${id}` })) });
    await Promise.all([
      products.replaceCategories(productId, { categoryIds: ids, primaryCategoryId: ids[0] }),
      products.replaceCategories(productId, { categoryIds: ids, primaryCategoryId: ids[1] }),
    ]);
    expect(await prisma.productCategory.count({ where: { productId, isPrimary: true } })).toBe(1);
  });

  it("allows one concurrent SKU insert and maps the other collision", async () => {
    const productId = await createProduct(); const sku = `SKU-${randomUUID()}`;
    const results = await Promise.allSettled([
      variants.create(productId, { sku, title: "First", priceMinor: "100", optionValueIds: [] }),
      variants.create(productId, { sku, title: "Second", priceMinor: "100", optionValueIds: [] }),
    ]);
    expect(results.filter((result) => result.status === "fulfilled")).toHaveLength(1);
    expect(await prisma.productVariant.count({ where: { sku } })).toBe(1);
  });

  it("never makes stock negative during concurrent decrements", async () => {
    const productId = await createProduct(); const sku = `SKU-${randomUUID()}`;
    const variant = await variants.create(productId, { sku, title: "Stock", stockQuantity: 5, priceMinor: "100", optionValueIds: [] });
    const results = await Promise.all([
      variants.decrementStock(productId, variant.id, 4),
      variants.decrementStock(productId, variant.id, 4),
    ]);
    expect(results.sort()).toEqual(["INSUFFICIENT", "UPDATED"]);
    expect((await prisma.productVariant.findUniqueOrThrow({ where: { id: variant.id } })).stockQuantity).toBe(1);
  });

  it("prevents concurrent reciprocal category parent updates from creating a cycle", async () => {
    const [firstId, secondId] = [randomUUID(), randomUUID()]; categoryIds.push(firstId, secondId);
    await prisma.category.createMany({ data: [
      { id: firstId, name: `Category ${firstId}`, slug: `category-${firstId}` },
      { id: secondId, name: `Category ${secondId}`, slug: `category-${secondId}` },
    ] });
    const results = await Promise.all([
      categories.update(firstId, { parentId: secondId }),
      categories.update(secondId, { parentId: firstId }),
    ]);
    expect(results.filter((result) => result === "CYCLE")).toHaveLength(1);
    const rows = await prisma.category.findMany({ where: { id: { in: [firstId, secondId] } }, select: { id: true, parentId: true } });
    const parents = new Map(rows.map((row) => [row.id, row.parentId]));
    expect(!(parents.get(firstId) === secondId && parents.get(secondId) === firstId)).toBe(true);
  });

  it("rolls back ACTIVE Product reassignment to an inactive Brand when status is omitted", async () => {
    const originalBrandId = randomUUID(); const inactiveBrandId = randomUUID(); const productId = randomUUID(); const categoryId = randomUUID();
    brandIds.push(originalBrandId, inactiveBrandId); productIds.push(productId); categoryIds.push(categoryId);
    await prisma.brand.createMany({ data: [
      { id: originalBrandId, name: `Brand ${originalBrandId}`, slug: `brand-${originalBrandId}`, isActive: true },
      { id: inactiveBrandId, name: `Brand ${inactiveBrandId}`, slug: `brand-${inactiveBrandId}`, isActive: false },
    ] });
    await prisma.category.create({ data: { id: categoryId, name: `Category ${categoryId}`, slug: `category-${categoryId}`, isActive: true } });
    await prisma.product.create({ data: { id: productId, brandId: originalBrandId, name: `Product ${productId}`, slug: `product-${productId}`, status: "ACTIVE", publishedAt: new Date(), productCategories: { create: { categoryId, isPrimary: true } }, variants: { create: { sku: `SKU-${randomUUID()}`, title: "Ready", priceMinor: 100n, isActive: true } } } });
    await expect(productService.update(productId, { brandId: inactiveBrandId })).rejects.toMatchObject({ code: "PRODUCT_NOT_READY" });
    expect((await prisma.product.findUniqueOrThrow({ where: { id: productId }, select: { brandId: true, status: true } }))).toEqual({ brandId: originalBrandId, status: "ACTIVE" });
  });

  it("rejects stale incomplete Variant activation and accepts a complete final selection", async () => {
    const brandId = randomUUID(); const productId = randomUUID(); const categoryId = randomUUID(); brandIds.push(brandId); productIds.push(productId); categoryIds.push(categoryId);
    await prisma.brand.create({ data: { id: brandId, name: `Brand ${brandId}`, slug: `brand-${brandId}`, isActive: true } });
    await prisma.category.create({ data: { id: categoryId, name: `Category ${categoryId}`, slug: `category-${categoryId}`, isActive: true } });
    await prisma.product.create({ data: { id: productId, brandId, name: `Product ${productId}`, slug: `product-${productId}`, productCategories: { create: { categoryId, isPrimary: true } } } });
    const size = await prisma.productOption.create({ data: { productId, name: "Size", values: { create: [{ value: "42" }, { value: "43" }] } }, include: { values: true } });
    const size42 = size.values.find((value) => value.value === "42")!; const size43 = size.values.find((value) => value.value === "43")!;
    const stale = await variants.create(productId, { sku: `SKU-${randomUUID()}`, title: "42", isActive: false, priceMinor: "100", optionValueIds: [size42.id] });
    const color = await prisma.productOption.create({ data: { productId, name: "Color", values: { create: { value: "Black" } } }, include: { values: true } });
    const black = color.values[0]!;
    await variants.create(productId, { sku: `SKU-${randomUUID()}`, title: "43 / Black", isActive: true, priceMinor: "100", optionValueIds: [size43.id, black.id] });
    await expect(productService.update(productId, { status: "ACTIVE" })).resolves.toMatchObject({ status: "ACTIVE" });
    await expect(variantService.update(productId, stale.id, { isActive: true })).rejects.toMatchObject({ code: "VARIANT_OPTION_INCOMPLETE" });
    expect((await prisma.productVariant.findUniqueOrThrow({ where: { id: stale.id } })).isActive).toBe(false);
    await expect(variantService.update(productId, stale.id, { isActive: true, optionValueIds: [size42.id, black.id] })).resolves.toMatchObject({ isActive: true });
  });

  it("prevents atomic stock increment beyond PostgreSQL INTEGER max", async () => {
    const productId = await createProduct(); const variant = await variants.create(productId, { sku: `SKU-${randomUUID()}`, title: "Max stock", stockQuantity: 2_147_483_647, priceMinor: "100", optionValueIds: [] });
    await expect(variantService.stock(productId, variant.id, { operation: "INCREMENT", quantity: 1 })).rejects.toMatchObject({ code: "STOCK_LIMIT_EXCEEDED" });
    expect((await prisma.productVariant.findUniqueOrThrow({ where: { id: variant.id } })).stockQuantity).toBe(2_147_483_647);
  });

  it("preserves active Brand dependency during concurrent Product activation and Brand deactivation", async () => {
    const brandId = randomUUID(); const categoryId = randomUUID(); const productId = randomUUID(); brandIds.push(brandId); categoryIds.push(categoryId); productIds.push(productId);
    await prisma.brand.create({ data: { id: brandId, name: `Brand ${brandId}`, slug: `brand-${brandId}`, isActive: true } });
    await prisma.category.create({ data: { id: categoryId, name: `Category ${categoryId}`, slug: `category-${categoryId}`, isActive: true } });
    await prisma.product.create({ data: { id: productId, brandId, name: `Product ${productId}`, slug: `product-${productId}`, productCategories: { create: { categoryId, isPrimary: true } }, variants: { create: { sku: `SKU-${randomUUID()}`, title: "Ready", priceMinor: 100n, isActive: true } } } });
    const results = await Promise.allSettled([
      productService.update(productId, { status: "ACTIVE" }),
      brandService.update(brandId, { isActive: false }),
    ]);
    expect(results.filter((result) => result.status === "fulfilled")).toHaveLength(1);
    const final = await prisma.product.findUniqueOrThrow({ where: { id: productId }, select: { status: true, brand: { select: { isActive: true } } } });
    expect(final.status === "ACTIVE" && !final.brand.isActive).toBe(false);
  });

  it("preserves active Category dependency during concurrent Product activation and Category deactivation", async () => {
    const brandId = randomUUID(); const categoryId = randomUUID(); const productId = randomUUID(); brandIds.push(brandId); categoryIds.push(categoryId); productIds.push(productId);
    await prisma.brand.create({ data: { id: brandId, name: `Brand ${brandId}`, slug: `brand-${brandId}`, isActive: true } });
    await prisma.category.create({ data: { id: categoryId, name: `Category ${categoryId}`, slug: `category-${categoryId}`, isActive: true } });
    await prisma.product.create({ data: { id: productId, brandId, name: `Product ${productId}`, slug: `product-${productId}`, productCategories: { create: { categoryId, isPrimary: true } }, variants: { create: { sku: `SKU-${randomUUID()}`, title: "Ready", priceMinor: 100n, isActive: true } } } });
    const results = await Promise.allSettled([
      productService.update(productId, { status: "ACTIVE" }),
      categoryService.update(categoryId, { isActive: false }),
    ]);
    expect(results.filter((result) => result.status === "fulfilled")).toHaveLength(1);
    const final = await prisma.product.findUniqueOrThrow({ where: { id: productId }, select: { status: true, productCategories: { where: { categoryId }, select: { category: { select: { isActive: true } } } } } });
    expect(final.status === "ACTIVE" && !final.productCategories[0]?.category.isActive).toBe(false);
  });

  it("preserves active Variant completeness during concurrent Product activation and Option creation", async () => {
    const brandId = randomUUID(); const categoryId = randomUUID(); const productId = randomUUID(); brandIds.push(brandId); categoryIds.push(categoryId); productIds.push(productId);
    await prisma.brand.create({ data: { id: brandId, name: `Brand ${brandId}`, slug: `brand-${brandId}`, isActive: true } });
    await prisma.category.create({ data: { id: categoryId, name: `Category ${categoryId}`, slug: `category-${categoryId}`, isActive: true } });
    await prisma.product.create({ data: { id: productId, brandId, name: `Product ${productId}`, slug: `product-${productId}`, productCategories: { create: { categoryId, isPrimary: true } } } });
    const size = await prisma.productOption.create({ data: { productId, name: "Size", values: { create: { value: "42" } } }, include: { values: true } });
    await variants.create(productId, { sku: `SKU-${randomUUID()}`, title: "42", priceMinor: "100", isActive: true, optionValueIds: [size.values[0]!.id] });
    const results = await Promise.allSettled([
      productService.update(productId, { status: "ACTIVE" }),
      productOptionsService.create(productId, { name: "Color" }),
    ]);
    expect(results.filter((result) => result.status === "fulfilled")).toHaveLength(1);
    const final = await prisma.product.findUniqueOrThrow({ where: { id: productId }, select: { status: true, options: { select: { id: true } }, variants: { where: { isActive: true, deletedAt: null }, select: { optionValues: { select: { optionValue: { select: { optionId: true } } } } } } } });
    if (final.status === "ACTIVE") {
      const optionIds = new Set(final.options.map((option) => option.id));
      expect(final.variants.length).toBeGreaterThan(0);
      for (const variant of final.variants) {
        const selected = new Set(variant.optionValues.map((link) => link.optionValue.optionId));
        expect(selected).toEqual(optionIds);
      }
    }
  });

  it("serializes first Variant reference against canonical OptionValue mutation and allows presentation changes", async () => {
    const productId = await createProduct();
    const option = await prisma.productOption.create({ data: { productId, name: "Size", values: { create: { value: "42", displayValue: "EU 42" } } }, include: { values: true } });
    const optionValue = option.values[0]!;
    const results = await Promise.allSettled([
      productOptionsService.updateValue(productId, option.id, optionValue.id, { value: "43" }),
      variantService.create(productId, { sku: `SKU-${randomUUID()}`, title: "42", priceMinor: "100", optionValueIds: [optionValue.id] }),
    ]);
    expect(results[1]?.status).toBe("fulfilled");
    const serializedValue = (await prisma.productOptionValue.findUniqueOrThrow({ where: { id: optionValue.id } })).value;
    expect(serializedValue).toBe(results[0]?.status === "fulfilled" ? "43" : "42");
    await expect(productOptionsService.updateValue(productId, option.id, optionValue.id, { value: "44" })).rejects.toMatchObject({ code: "OPTION_VALUE_IN_USE" });
    await expect(productOptionsService.updateValue(productId, option.id, optionValue.id, { displayValue: "EU Forty Two" })).resolves.toMatchObject({ value: serializedValue, displayValue: "EU Forty Two" });
  });
});
