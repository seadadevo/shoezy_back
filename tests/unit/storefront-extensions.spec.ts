import { describe, expect, it, vi } from "vitest";
import type { Prisma } from "@prisma/client";
import { WhatsAppOrderService, formatTndMinor } from "../../src/modules/orders/whatsapp-order.service";
import type { OrderDetailRecord } from "../../src/modules/orders/orders.types";
import { resolveShippingRate } from "../../src/modules/shipping/shipping-zone-pricing";
import { updateStoreSettingsSchema } from "../../src/modules/store-settings/store-settings.validation";

const uuid = "11111111-1111-4111-8111-111111111111";
const order = { orderNumber: "SHZ-TEST", whatsappConfirmationNumber: "+21620123456", whatsappStoreName: "Shoozy", currency: "TND", subtotalMinor: 12345n, discountMinor: 1000n, shippingMinor: 2500n, totalMinor: 13845n, customerPhone: "+21620123456", items: [{ productName: "Runner", variantName: "Size 42", sku: "RUN-42", quantity: 2 }], address: { recipientName: "Amina", phone: "+21620123456", line1: "1 Avenue", line2: null, area: "Centre", city: "Tunis", state: "Tunis", countryCode: "TN" } } as unknown as OrderDetailRecord;
const method = { id: uuid, code: "STANDARD", name: "Standard", basePriceMinor: 1000n, currency: "TND", estimatedMinDays: 2, estimatedMaxDays: 4 };
const address = { countryCode: "TN", state: " Tunis ", city: " Tunis ", area: " Medina " };
const candidate = (cityKey: string, areaKey: string, priceMinor: bigint, currency = "TND") => ({ cityKey, areaKey, zone: { code: areaKey || cityKey || "STATE", name: "Zone", rates: [{ priceMinor, currency, estimatedMinDays: 1, estimatedMaxDays: 2 }] } });
function transaction(candidates: ReturnType<typeof candidate>[], zones = 1) {
  const count = vi.fn(async () => zones);
  const findMany = vi.fn(async () => candidates);
  return { value: { shippingZone: { count }, shippingZoneArea: { findMany } } as unknown as Prisma.TransactionClient, count, findMany };
}

describe("storefront settings and WhatsApp confirmation", () => {
  it("formats TND in three decimal millimes without floating point", () => {
    expect(formatTndMinor(12345n)).toBe("12.345 TND");
    expect(formatTndMinor(5n)).toBe("0.005 TND");
  });
  it("encodes persisted order details into a configured wa.me URL", () => {
    const result = new WhatsAppOrderService().confirmation(order);
    expect(result.enabled).toBe(true);
    expect(result.url).toMatch(/^https:\/\/wa\.me\/21620123456\?text=/);
    const message = decodeURIComponent(result.url!.split("?text=")[1]!);
    expect(message).toContain("Runner / Size 42 (SKU: RUN-42) x2");
    expect(message).toContain("Total on delivery: 13.845 TND");
    expect(message).toContain("Amina");
    expect(message).toContain("Payment: Cash on Delivery");
  });
  it("disables confirmation when the persisted setting was disabled or lacked a number", () => {
    const service = new WhatsAppOrderService();
    expect(service.confirmation({ ...order, whatsappConfirmationNumber: null } as OrderDetailRecord)).toEqual({ enabled: false, url: null });
    expect(service.confirmation({ ...order, whatsappConfirmationNumber: "" } as OrderDetailRecord)).toEqual({ enabled: false, url: null });
  });
  it("accepts international Tunisian numbers and rejects malformed ones", () => {
    const parse = (whatsappNumber: unknown) => updateStoreSettingsSchema.safeParse({ body: { whatsappNumber }, params: {}, query: {} }).success;
    expect(parse("+21620123456")).toBe(true);
    expect(parse("20123456")).toBe(false);
    expect(parse("+21620123")).toBe(false);
  });
});

describe("shipping zone resolution", () => {
  it("uses the governorate rate when there is no narrower match", async () => {
    const tx = transaction([candidate("", "", 2200n)]);
    expect(await resolveShippingRate(tx.value, address, method)).toMatchObject({ priceMinor: 2200n, zone: { code: "STATE" } });
    expect(tx.findMany).toHaveBeenCalledWith(expect.objectContaining({ where: expect.objectContaining({ stateKey: "tunis" }) }));
  });
  it("prefers city and then area over governorate", async () => {
    const tx = transaction([candidate("", "", 2200n), candidate("tunis", "", 1800n), candidate("tunis", "medina", 1500n)]);
    expect(await resolveShippingRate(tx.value, { ...address, area: null }, method)).toMatchObject({ priceMinor: 1800n });
    expect(await resolveShippingRate(tx.value, address, method)).toMatchObject({ priceMinor: 1500n });
  });
  it("requires active zones and rates and returns an explicit missing-rate result", async () => {
    const tx = transaction([]);
    expect(await resolveShippingRate(tx.value, address, method)).toBe("NOT_AVAILABLE");
    expect(tx.findMany).toHaveBeenCalledWith(expect.objectContaining({ where: expect.objectContaining({ zone: { isActive: true, rates: { some: { shippingMethodId: uuid, isActive: true } } } }) }));
  });
  it("protects currency and preserves base-price compatibility before any zones are configured", async () => {
    expect(await resolveShippingRate(transaction([candidate("", "", 100n, "USD")]).value, address, method)).toBe("CURRENCY_MISMATCH");
    expect(await resolveShippingRate(transaction([], 0).value, address, method)).toMatchObject({ priceMinor: 1000n, zone: null });
  });
});
