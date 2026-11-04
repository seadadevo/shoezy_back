import type { PrismaClient } from "@prisma/client";
import request from "supertest";
import { afterEach, describe, expect, it, vi } from "vitest";
import { createApp } from "../../src/app";
import { toCatalogPromotionDto } from "../../src/modules/catalog/catalog.dto";
import { CatalogRepository } from "../../src/modules/catalog/catalog.repository";
import { CatalogService } from "../../src/modules/catalog/catalog.service";
import type { CatalogPromotionRecord } from "../../src/modules/catalog/catalog.types";

const now = new Date("2026-10-01T12:00:00.000Z");

function promotion(overrides: Partial<CatalogPromotionRecord> = {}): CatalogPromotionRecord {
  return {
    id: "11111111-1111-4111-8111-111111111111",
    name: "Weekend Sale",
    description: "Selected shoes",
    imageUrl: "https://example.test/uploads/promotions/offer.jpg",
    ctaUrl: "/collections/weekend",
    code: "PRIVATE20",
    type: "PERCENTAGE",
    scope: "COLLECTION",
    value: 1250n,
    currency: null,
    minOrderMinor: 10000n,
    maxDiscountMinor: 5000n,
    startsAt: new Date("2026-10-01T00:00:00.000Z"),
    endsAt: new Date("2026-10-02T00:00:00.000Z"),
    sortOrder: 2,
    translations: [
      { locale: "en", name: "Weekend Sale", description: "Selected shoes" },
      { locale: "ar", name: "عرض نهاية الأسبوع", description: "أحذية مختارة" },
    ],
    ...overrides,
  };
}

describe("public storefront promotions", () => {
  afterEach(() => vi.restoreAllMocks());

  it("queries only storefront-visible, currently effective promotions in one deterministic query", async () => {
    const findMany = vi.fn().mockResolvedValue([promotion()]);
    const repository = new CatalogRepository({ discount: { findMany } } as unknown as PrismaClient);

    await expect(repository.listPromotions(now)).resolves.toHaveLength(1);
    expect(findMany).toHaveBeenCalledTimes(1);
    expect(findMany).toHaveBeenCalledWith(expect.objectContaining({
      where: {
        showOnStorefront: true,
        isActive: true,
        archivedAt: null,
        startsAt: { lte: now },
        OR: [{ endsAt: null }, { endsAt: { gt: now } }],
      },
      orderBy: [{ sortOrder: "asc" }, { startsAt: "desc" }, { id: "asc" }],
    }));
    const query = findMany.mock.calls[0]![0];
    expect(query.select.translations).toBeDefined();
    expect(query.select.targets).toBeUndefined();
  });

  it("localizes the public DTO and excludes private coupon and storage metadata", () => {
    const dto = toCatalogPromotionDto(promotion(), "ar");
    expect(dto).toMatchObject({
      name: "عرض نهاية الأسبوع",
      description: "أحذية مختارة",
      imageUrl: "https://example.test/uploads/promotions/offer.jpg",
      activationMode: "COUPON",
      discount: { type: "PERCENTAGE", percentage: "12.5", amountMinor: null, currency: null },
      sortOrder: 2,
    });
    const serialized = JSON.stringify(dto);
    expect(serialized).not.toContain("PRIVATE20");
    expect(serialized).not.toContain("storageProvider");
    expect(serialized).not.toContain("storageKey");
    expect(serialized).not.toContain("usageLimit");
    expect(serialized).not.toContain("redemption");
  });

  it("is public and requires no authentication", async () => {
    vi.spyOn(CatalogService.prototype, "listPromotions").mockResolvedValue({ items: [toCatalogPromotionDto(promotion(), "en")] });
    const response = await request(createApp()).get("/api/v1/catalog/promotions");

    expect(response.status).toBe(200);
    expect(response.body.data.items[0]).toMatchObject({
      id: promotion().id,
      imageUrl: promotion().imageUrl,
      activationMode: "COUPON",
    });
    expect(JSON.stringify(response.body)).not.toContain("PRIVATE20");
  });
});

