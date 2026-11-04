import type { PrismaClient } from "@prisma/client";
import { describe, expect, it, vi } from "vitest";
import { SizeGuidesRepository } from "../../src/modules/size-guides/size-guides.repository";
import { createSizeGuideSchema, updateSizeGuideSchema } from "../../src/modules/size-guides/size-guides.validation";
import { CollectionsRepository } from "../../src/modules/collections/collections.repository";
import { createCollectionSchema } from "../../src/modules/collections/collections.validation";
import { ShippingZonesRepository } from "../../src/modules/shipping/shipping-zones.repository";
import { createZoneSchema, updateZoneSchema } from "../../src/modules/shipping/shipping-zones.validation";
import { OrdersRepository } from "../../src/modules/orders/orders.repository";
import { shipOrderSchema } from "../../src/modules/orders/orders.validation";
import { DashboardService } from "../../src/modules/admin-dashboard/dashboard.service";

const id = "11111111-1111-4111-8111-111111111111";
const otherId = "22222222-2222-4222-8222-222222222222";
const txClient = <T extends object>(tx: T) => ({ $transaction: vi.fn(async (work: (tx: T) => Promise<unknown>) => work(tx)) }) as unknown as PrismaClient;

describe("one Save admin workflows", () => {
  it("creates a size guide with entries and audit in the same transaction", async () => {
    const tx = { sizeGuide: { create: vi.fn(async () => ({ id })) }, sizeGuideEntry: { createMany: vi.fn(async () => ({ count: 2 })) }, adminAuditLog: { create: vi.fn(async () => ({})) } };
    const input = createSizeGuideSchema.parse({ body: { name: "Women", entries: [{ euSize: "40", sortOrder: 0 }, { euSize: "41", sortOrder: 1 }] }, params: {}, query: {} }).body;
    await new SizeGuidesRepository(txClient(tx)).create(input, otherId);
    expect(tx.sizeGuideEntry.createMany).toHaveBeenCalledWith({ data: [{ euSize: "40", sortOrder: 0, sizeGuideId: id }, { euSize: "41", sortOrder: 1, sizeGuideId: id }] });
    expect(tx.adminAuditLog.create).toHaveBeenCalledOnce();
    expect(updateSizeGuideSchema.safeParse({ body: { entries: { upsert: [{ id: otherId, euSize: "42" }], deleteIds: [] } }, params: { sizeGuideId: id }, query: {} }).success).toBe(true);
  });
  it("rejects a missing collection product inside the transaction", async () => {
    const tx = { collection: { create: vi.fn(async () => ({ id })) }, product: { count: vi.fn(async () => 0) }, collectionProduct: { deleteMany: vi.fn(), createMany: vi.fn() }, adminAuditLog: { create: vi.fn() } };
    const input = createCollectionSchema.parse({ body: { name: "Summer", products: [{ productId: otherId, position: 0 }] }, params: {}, query: {} }).body;
    const { startsAt: _startsAt, endsAt: _endsAt, ...collection } = input;
    await expect(new CollectionsRepository(txClient(tx)).create({ ...collection, slug: "summer" }, otherId)).rejects.toMatchObject({ code: "PRODUCT_NOT_FOUND" });
    expect(tx.collectionProduct.createMany).not.toHaveBeenCalled();
    expect(tx.adminAuditLog.create).not.toHaveBeenCalled();
  });
  it("creates zone, normalized area, and TND rate in one transaction", async () => {
    const tx = {
      shippingZone: { create: vi.fn(async () => ({ id })), findUniqueOrThrow: vi.fn(async () => ({ id, areas: [], rates: [] })) },
      shippingZoneArea: { createMany: vi.fn(async () => ({ count: 1 })) },
      shippingMethod: { findUnique: vi.fn(async () => ({ currency: "TND" })) },
      shippingZoneRate: { findUnique: vi.fn(async () => null), upsert: vi.fn(async () => ({})) },
      adminAuditLog: { create: vi.fn(async () => ({})) },
    };
    const input = createZoneSchema.parse({ body: { code: "tunis", name: "Tunis", areas: [{ state: " Tunis " }], rates: [{ shippingMethodId: otherId, priceMinor: "2500", estimatedMinDays: 1, estimatedMaxDays: 2 }] }, params: {}, query: {} }).body;
    await new ShippingZonesRepository(txClient(tx)).create(input, otherId);
    expect(tx.shippingZoneArea.createMany).toHaveBeenCalledWith({ data: [expect.objectContaining({ zoneId: id, countryCode: "TN", state: "Tunis", stateKey: "tunis" })] });
    expect(tx.shippingZoneRate.upsert).toHaveBeenCalledWith(expect.objectContaining({ create: expect.objectContaining({ currency: "TND", priceMinor: 2500n }) }));
    expect(updateZoneSchema.safeParse({ body: { areas: { upsert: [{ id: otherId, city: "Tunis" }], deleteIds: [] }, rates: { upsert: [], deleteMethodIds: [] } }, params: { zoneId: id }, query: {} }).success).toBe(true);
  });
  it("rejects a non TND rate without recording success", async () => {
    const tx = { shippingZone: { create: vi.fn(async () => ({ id })) }, shippingZoneArea: { createMany: vi.fn() }, shippingMethod: { findUnique: vi.fn(async () => ({ currency: "EUR" })) }, shippingZoneRate: { findUnique: vi.fn(), upsert: vi.fn() }, adminAuditLog: { create: vi.fn() } };
    await expect(new ShippingZonesRepository(txClient(tx)).create({ code: "TUNIS", name: "Tunis", rates: [{ shippingMethodId: otherId, priceMinor: "1000" }] }, otherId)).rejects.toMatchObject({ code: "SHIPPING_CURRENCY_MISMATCH" });
    expect(tx.shippingZoneRate.upsert).not.toHaveBeenCalled();
    expect(tx.adminAuditLog.create).not.toHaveBeenCalled();
  });
  it("ships with provider and tracking in the status transaction", async () => {
    const tx = {
      $queryRaw: vi.fn(async () => []),
      order: { findFirst: vi.fn(async () => ({ id, status: "CONFIRMED", totalMinor: 1000n, shippingProvider: null, items: [] })), update: vi.fn(async () => ({})), findUniqueOrThrow: vi.fn(async () => ({ id, status: "SHIPPED" })) },
      orderStatusHistory: { create: vi.fn(async () => ({})) }, adminAuditLog: { create: vi.fn(async () => ({})) },
    };
    const input = shipOrderSchema.parse({ body: { shippingProvider: "DHL", trackingNumber: "TN123" }, params: { orderId: id }, query: {} }).body;
    const result = await new OrdersRepository(txClient(tx)).transition(id, otherId, "SHIPPED", ["CONFIRMED"], null, undefined, new Date(), input);
    expect(result.kind).toBe("UPDATED");
    expect(tx.order.update).toHaveBeenCalledWith({ where: { id }, data: expect.objectContaining({ status: "SHIPPED", shippingProvider: "DHL", trackingNumber: "TN123" }) });
    expect(tx.orderStatusHistory.create).toHaveBeenCalledOnce();
    expect(tx.adminAuditLog.create).toHaveBeenCalledOnce();
  });
  it("reuses bounded dashboard widgets for one initial load", async () => {
    const service = new DashboardService();
    const overview = vi.spyOn(service, "overview").mockResolvedValue({ section: "overview" } as never);
    const orders = vi.spyOn(service, "orders").mockResolvedValue({ section: "orders" } as never);
    const inventory = vi.spyOn(service, "inventory").mockResolvedValue({ section: "inventory" } as never);
    expect(await service.summary()).toEqual({ overview: { section: "overview" }, orders: { section: "orders" }, inventory: { section: "inventory" } });
    expect(overview).toHaveBeenCalledWith({ lowStockThreshold: 5 });
    expect(orders).toHaveBeenCalledWith({ page: 1, limit: 10 });
    expect(inventory).toHaveBeenCalledWith({ page: 1, limit: 10, threshold: 5, state: "LOW" });
  });
});
