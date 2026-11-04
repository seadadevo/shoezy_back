import { randomUUID } from "node:crypto";
import { PrismaPg } from "@prisma/adapter-pg";
import { PrismaClient } from "@prisma/client";
import { afterAll, beforeAll, describe, expect, it } from "vitest";
import { SizeGuidesRepository } from "../../src/modules/size-guides/size-guides.repository";
import { CollectionsRepository } from "../../src/modules/collections/collections.repository";
import { ShippingZonesRepository } from "../../src/modules/shipping/shipping-zones.repository";

const databaseUrl = process.env.TEST_DATABASE_URL;
const describeDatabase = databaseUrl ? describe : describe.skip;
describeDatabase("other one Save workflows against disposable PostgreSQL", () => {
  if (!databaseUrl) return;
  const databaseName = new URL(databaseUrl).pathname.slice(1);
  if (!new Set(["shoe_store_tasks05_12_validation", "shoe_store_tasks13_26_validation"]).has(databaseName)) throw new Error(`Unsafe TEST_DATABASE_URL database: ${databaseName}`);
  const client = new PrismaClient({ adapter: new PrismaPg({ connectionString: databaseUrl }) });
  const actorId = randomUUID(), brandId = randomUUID(), productId = randomUUID(), methodId = randomUUID();
  const guides: string[] = [], collections: string[] = [], zones: string[] = [];
  const sizeGuides = new SizeGuidesRepository(client), collectionStore = new CollectionsRepository(client), shipping = new ShippingZonesRepository(client);
  beforeAll(async () => {
    expect((await client.$queryRaw<Array<{ database: string }>>`SELECT current_database() AS database`)[0]?.database).toBe(databaseName);
    await client.user.create({ data: { id: actorId, email: `${actorId}@example.com`, firstName: "Admin", lastName: "Test" } });
    await client.brand.create({ data: { id: brandId, name: `Brand ${brandId}`, slug: `brand-${brandId}` } });
    await client.product.create({ data: { id: productId, brandId, name: "Test Shoe", slug: `shoe-${productId}` } });
    await client.shippingMethod.create({ data: { id: methodId, code: `M-${methodId}`, name: "Home", basePriceMinor: 2000n, currency: "TND" } });
  });
  afterAll(async () => {
    if (zones.length) await client.shippingZone.deleteMany({ where: { id: { in: zones } } });
    if (collections.length) await client.collection.deleteMany({ where: { id: { in: collections } } });
    await client.product.deleteMany({ where: { id: productId } });
    if (guides.length) await client.sizeGuide.deleteMany({ where: { id: { in: guides } } });
    await client.shippingMethod.deleteMany({ where: { id: methodId } });
    await client.adminAuditLog.deleteMany({ where: { actorUserId: actorId } });
    await client.brand.deleteMany({ where: { id: brandId } });
    await client.user.deleteMany({ where: { id: actorId } });
    await client.$disconnect();
  });
  it("saves guide entries and rolls back a failed entry edit", async () => {
    const guide = await sizeGuides.create({ name: "Women", brandId, entries: [{ euSize: "40", sortOrder: 0 }, { euSize: "41", sortOrder: 1 }] }, actorId);
    guides.push(guide.id);
    expect(await client.sizeGuideEntry.count({ where: { sizeGuideId: guide.id } })).toBe(2);
    await expect(sizeGuides.updateAggregate(guide.id, { name: "Changed", entries: { upsert: [{ id: randomUUID(), euSize: "42" }], deleteIds: [] } }, actorId)).rejects.toMatchObject({ code: "SIZE_GUIDE_ENTRY_NOT_FOUND" });
    expect((await client.sizeGuide.findUniqueOrThrow({ where: { id: guide.id } })).name).toBe("Women");
  });
  it("saves collection membership and rolls back an invalid product", async () => {
    const collection = await collectionStore.create({ name: "Summer", slug: `summer-${randomUUID()}`, products: [{ productId, position: 0 }] }, actorId);
    collections.push(collection.id);
    expect(await client.collectionProduct.count({ where: { collectionId: collection.id } })).toBe(1);
    const before = await client.collection.count();
    await expect(collectionStore.create({ name: "Invalid", slug: `invalid-${randomUUID()}`, products: [{ productId: randomUUID(), position: 0 }] }, actorId)).rejects.toMatchObject({ code: "PRODUCT_NOT_FOUND" });
    expect(await client.collection.count()).toBe(before);
    await collectionStore.update(collection.id, { products: [] }, actorId);
    expect(await client.collectionProduct.count({ where: { collectionId: collection.id } })).toBe(0);
  });
  it("saves zone areas and rates, updates them, and rolls back an invalid rate", async () => {
    const zone = await shipping.create({ code: `Z-${randomUUID()}`, name: "Tunis", areas: [{ state: `State-${randomUUID()}` }], rates: [{ shippingMethodId: methodId, priceMinor: "2500", estimatedMinDays: 1, estimatedMaxDays: 2 }] }, actorId);
    zones.push(zone.id);
    expect(zone.areas).toHaveLength(1);
    expect(zone.rates).toHaveLength(1);
    await shipping.update(zone.id, { areas: { upsert: [{ id: zone.areas[0]!.id, city: "Tunis" }], deleteIds: [] }, rates: { upsert: [{ shippingMethodId: methodId, priceMinor: "3000" }], deleteMethodIds: [] } }, actorId);
    expect((await client.shippingZoneRate.findUniqueOrThrow({ where: { zoneId_shippingMethodId: { zoneId: zone.id, shippingMethodId: methodId } } })).priceMinor).toBe(3000n);
    const before = await client.shippingZone.count();
    await expect(shipping.create({ code: `BAD-${randomUUID()}`, name: "Invalid", rates: [{ shippingMethodId: randomUUID(), priceMinor: "1000" }] }, actorId)).rejects.toMatchObject({ code: "SHIPPING_METHOD_NOT_FOUND" });
    expect(await client.shippingZone.count()).toBe(before);
  });
});
