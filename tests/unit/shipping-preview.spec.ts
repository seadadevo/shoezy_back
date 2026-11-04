import type { Prisma, PrismaClient } from "@prisma/client";
import request from "supertest";
import { afterEach, describe, expect, it, vi } from "vitest";
import { createApp } from "../../src/app";
import { resolveShippingRate, resolveShippingRates } from "../../src/modules/shipping/shipping-zone-pricing";
import { ShippingPreviewRepository } from "../../src/modules/shipping/shipping-preview.repository";
import { ShippingPreviewService } from "../../src/modules/shipping/shipping-preview.service";
import { shippingPreviewSchema } from "../../src/modules/shipping/shipping-preview.validation";

const address = { countryCode: "TN", state: "Tunis", city: "Tunis", area: null };
const standard = { id: "standard", code: "STANDARD", name: "Standard", currency: "TND", basePriceMinor: 999n, estimatedMinDays: 3, estimatedMaxDays: 5 };
const express = { id: "express", code: "EXPRESS", name: "Express", currency: "TND", basePriceMinor: 1999n, estimatedMinDays: 1, estimatedMaxDays: 2 };
const area = {
  cityKey: "tunis", areaKey: "",
  zone: { code: "TUNIS", name: "Tunis", rates: [
    { shippingMethodId: standard.id, priceMinor: 2500n, currency: "TND", estimatedMinDays: 2, estimatedMaxDays: 4 },
    { shippingMethodId: express.id, priceMinor: 4000n, currency: "TND", estimatedMinDays: 1, estimatedMaxDays: 2 },
  ] },
};

function transaction(zones = 1, matches = [area]) {
  return {
    product: { findFirst: vi.fn().mockResolvedValue({ id: "product" }) },
    storeSettings: { findUnique: vi.fn().mockResolvedValue({ currency: "TND" }) },
    shippingMethod: { findMany: vi.fn().mockResolvedValue([standard, express]) },
    shippingZone: { count: vi.fn().mockResolvedValue(zones) },
    shippingZoneArea: { findMany: vi.fn().mockResolvedValue(matches) },
  };
}

describe("product shipping preview", () => {
  afterEach(() => vi.restoreAllMocks());

  it("uses checkout's zone rate for each active method in one area query", async () => {
    const tx = transaction();
    const client = { $transaction: vi.fn(async (work: (value: Prisma.TransactionClient) => Promise<unknown>) => work(tx as unknown as Prisma.TransactionClient)) } as unknown as PrismaClient;
    const repository = new ShippingPreviewRepository(client);
    const result = await new ShippingPreviewService(repository).preview("trail-shoe", address);
    expect(result).toEqual({ available: true, methods: [
      { id: standard.id, code: "STANDARD", name: "Standard", priceMinor: "2500", currency: "TND", estimatedMinDays: 2, estimatedMaxDays: 4 },
      { id: express.id, code: "EXPRESS", name: "Express", priceMinor: "4000", currency: "TND", estimatedMinDays: 1, estimatedMaxDays: 2 },
    ] });
    expect(tx.shippingMethod.findMany.mock.calls[0]?.[0].where).toEqual({ isActive: true, currency: "TND" });
    expect(tx.shippingZoneArea.findMany).toHaveBeenCalledTimes(1);
    expect(tx.shippingZoneArea.findMany.mock.calls[0]?.[0].where.zone).toEqual({
      isActive: true, rates: { some: { shippingMethodId: { in: [standard.id, express.id] }, isActive: true } },
    });
    const checkout = await resolveShippingRate(tx as unknown as Prisma.TransactionClient, address, standard);
    expect(checkout).toMatchObject({ priceMinor: 2500n, estimatedMinDays: 2, estimatedMaxDays: 4 });
    expect(tx.product.findFirst.mock.calls[0]?.[0].where).toMatchObject({ slug: "trail-shoe", status: "ACTIVE", deletedAt: null });
  });

  it("returns no fabricated rate for unsupported addresses and uses the existing no-zone fallback", async () => {
    const unsupported = transaction(1, []);
    const unavailable = await resolveShippingRates(unsupported as unknown as Prisma.TransactionClient, address, [standard]);
    expect(unavailable.size).toBe(0);
    const noZones = transaction(0, []);
    const fallback = await resolveShippingRates(noZones as unknown as Prisma.TransactionClient, address, [standard]);
    expect(fallback.get(standard.id)?.priceMinor).toBe(standard.basePriceMinor);
    expect(noZones.shippingZoneArea.findMany).not.toHaveBeenCalled();
  });

  it("validates location and rejects client-supplied price or quantity", () => {
    const parse = (body: unknown) => shippingPreviewSchema.safeParse({ body, params: { slug: "trail-shoe" }, query: {} });
    expect(parse({ ...address }).success).toBe(true);
    expect(parse({ ...address, priceMinor: "0" }).success).toBe(false);
    expect(parse({ ...address, quantity: 99 }).success).toBe(false);
    expect(parse({ ...address, state: "" }).success).toBe(false);
    expect(parse({ ...address, countryCode: "Tunisia" }).success).toBe(false);
    expect(parse({ ...address, countryCode: "FR" }).success).toBe(false);
  });

  it("offers an anonymous, read-only route with a controlled empty result", async () => {
    vi.spyOn(ShippingPreviewService.prototype, "preview").mockResolvedValue({ available: false, methods: [] });
    const app = createApp();
    const response = await request(app).post("/api/v1/catalog/products/trail-shoe/shipping-preview").send(address);
    expect(response.status).toBe(200);
    expect(response.body.data).toEqual({ available: false, methods: [] });
    expect((await request(app).post("/api/v1/catalog/products/trail-shoe/shipping-preview").send({ ...address, priceMinor: "1" })).status).toBe(422);
  });
});
