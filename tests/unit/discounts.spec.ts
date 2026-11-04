import { describe, expect, it, vi } from "vitest";
import { DiscountsRepositoryError } from "../../src/modules/discounts/discounts.repository";
import { DiscountsService, type DiscountsStore } from "../../src/modules/discounts/discounts.service";
import type { DiscountRecord } from "../../src/modules/discounts/discounts.types";
import { createDiscountSchema } from "../../src/modules/discounts/discounts.validation";
import { DiscountEngineService, type DiscountCandidate, type PricingLine } from "../../src/services/discount-engine.service";
import { discountStatus, toDiscountDto } from "../../src/modules/discounts/discounts.dto";

const discountId = "11111111-1111-4111-8111-111111111111";
const productId = "22222222-2222-4222-8222-222222222222";
const categoryId = "33333333-3333-4333-8333-333333333333";
const now = new Date("2026-08-13T12:00:00.000Z");

function discount(overrides: Partial<DiscountRecord> = {}): DiscountRecord {
  return {
    id: discountId, name: "Ten percent", description: null, code: null, type: "PERCENTAGE", scope: "ORDER", priority: 10,
    imageUrl: null, imageStorageProvider: null, imageStorageKey: null, showOnStorefront: false, sortOrder: 0, ctaUrl: null,
    value: 1000n, currency: null, minOrderMinor: null, maxDiscountMinor: null, usageLimit: null,
    perCustomerLimit: null, startsAt: new Date("2026-08-13T00:00:00.000Z"), endsAt: null,
    isActive: true, combinable: false, archivedAt: null, createdAt: now, updatedAt: now, translations: [], targets: [], _count: { redemptions: 0 }, ...overrides,
  };
}

function store(): DiscountsStore {
  return {
    list: vi.fn(async () => ({ items: [discount()], total: 1 })),
    findById: vi.fn(async (id) => id === discountId ? discount() : null),
    create: vi.fn(async (fields, targets, validate) => { const state = { ...fields, targets } as Parameters<typeof validate>[0]; validate(state); return discount({ ...fields }); }),
    update: vi.fn(async (id, fields, targets, validate) => { if (id !== discountId) return "NOT_FOUND" as const; const state = { ...discount(), ...fields, targets: targets ?? [] } as Parameters<typeof validate>[0]; validate(state); return discount({ ...fields }); }),
    delete: vi.fn(async (id) => id === discountId ? "DELETED" as const : "NOT_FOUND" as const),
    setActive: vi.fn(async (id, isActive) => id === discountId ? discount({ isActive }) : "NOT_FOUND" as const),
    archive: vi.fn(async (id, archivedAt) => id === discountId ? discount({ archivedAt, isActive: false }) : "NOT_FOUND" as const),
    statistics: vi.fn(async (id) => id === discountId ? { usageCount: 1, associatedOrders: 1, totalDiscountGrantedMinor: 100n, revenueMinor: 900n } : "NOT_FOUND" as const),
  };
}

const baseCreate = {
  name: "Ten percent", code: " summer10 ", type: "PERCENTAGE" as const, scope: "ORDER" as const,
  priority: 10, value: "1000", startsAt: "2026-08-13T00:00:00.000Z", targets: [],
};

describe("discount administration", () => {
  it("normalizes coupon code and serializes BigInt values", async () => {
    const repository = store(); const result = await new DiscountsService(repository).create(baseCreate);
    expect(result.value).toBe("1000");
    expect(repository.create).toHaveBeenCalledWith(expect.objectContaining({ code: "SUMMER10", value: 1000n }), [], expect.any(Function));
  });

  it.each([
    [{ ...baseCreate, value: "0" }, "DISCOUNT_VALUE_INVALID"],
    [{ ...baseCreate, value: "10001" }, "DISCOUNT_VALUE_INVALID"],
    [{ ...baseCreate, type: "FIXED_AMOUNT" as const, value: "100", currency: null }, "DISCOUNT_VALUE_INVALID"],
    [{ ...baseCreate, type: "FREE_SHIPPING" as const, value: "1" }, "DISCOUNT_VALUE_INVALID"],
    [{ ...baseCreate, scope: "PRODUCT" as const, targets: [] }, "DISCOUNT_TARGETS_INVALID"],
    [{ ...baseCreate, scope: "ORDER" as const, targets: [{ productId }] }, "DISCOUNT_TARGETS_INVALID"],
    [{ ...baseCreate, usageLimit: 1, perCustomerLimit: 2 }, "DISCOUNT_USAGE_LIMIT_INVALID"],
  ])("rejects invalid business state", async (input, code) => {
    await expect(new DiscountsService(store()).create(input)).rejects.toMatchObject({ code });
  });

  it.each([
    ["DUPLICATE_CODE", "DISCOUNT_CODE_ALREADY_EXISTS"],
    ["DUPLICATE_PRIORITY", "DISCOUNT_PRIORITY_ALREADY_EXISTS"],
    ["DUPLICATE_TARGET", "DISCOUNT_TARGET_ALREADY_EXISTS"],
  ] as const)("maps %s to a stable conflict", async (repositoryCode, apiCode) => {
    const repository = store(); vi.mocked(repository.create).mockRejectedValue(new DiscountsRepositoryError(repositoryCode));
    await expect(new DiscountsService(repository).create(baseCreate)).rejects.toMatchObject({ statusCode: 409, code: apiCode });
  });

  it("strictly validates integer money and target XOR bodies", () => {
    const parse = (body: unknown) => createDiscountSchema.safeParse({ body, params: {}, query: {} }).success;
    expect(parse(baseCreate)).toBe(true);
    expect(parse({ ...baseCreate, value: "10.5" })).toBe(false);
    expect(parse({ ...baseCreate, targets: [{ productId, categoryId }] })).toBe(false);
    expect(parse({ ...baseCreate, userId: productId })).toBe(false);
  });

  it("activates, deactivates, archives, and serializes statistics", async () => {
    const repository = store();
    const service = new DiscountsService(repository);
    expect((await service.setActive(discountId, false)).status).toBe("DISABLED");
    expect((await service.setActive(discountId, true)).status).toBe("ACTIVE");
    expect((await service.archive(discountId)).status).toBe("ARCHIVED");
    await expect(service.statistics(discountId)).resolves.toEqual({
      usageCount: 1,
      associatedOrders: 1,
      totalDiscountGrantedMinor: "100",
      revenueMinor: "900",
    });
  });

  it("calculates schedule states and exposes bilingual promotion translations", () => {
    expect(discountStatus(discount({ startsAt: new Date("2026-08-14T00:00:00.000Z") }), now)).toBe("SCHEDULED");
    expect(discountStatus(discount({ endsAt: now }), now)).toBe("EXPIRED");
    const dto = toDiscountDto(discount({ translations: [
      { locale: "ar", name: "عرض نهاية الأسبوع", description: "وصف" },
      { locale: "en", name: "Weekend Sale", description: "Description" },
    ] }), now);
    expect(dto.translations).toMatchObject({ ar: { name: "عرض نهاية الأسبوع" }, en: { name: "Weekend Sale" } });
  });
});

function candidate(overrides: Partial<DiscountCandidate> = {}): DiscountCandidate {
  return {
    id: discountId, name: "Discount", code: null, type: "PERCENTAGE", scope: "ORDER", priority: 10,
    value: 1000n, currency: null, minOrderMinor: null, maxDiscountMinor: null, usageLimit: null,
    perCustomerLimit: null, startsAt: new Date("2026-08-13T00:00:00.000Z"), endsAt: null,
    isActive: true, combinable: false, archivedAt: null, productIds: [], variantIds: [], categoryIds: [], collectionIds: [], ...overrides,
  };
}
function line(overrides: Partial<PricingLine> = {}): PricingLine {
  return { variantId: "a", productId, categoryIds: [categoryId], collectionIds: [], unitPriceMinor: 100n, quantity: 1, ...overrides };
}

describe("deterministic discount engine", () => {
  const engine = new DiscountEngineService();
  it("uses basis points with exact half-up rounding", () => {
    const result = engine.calculate({ lines: [line({ unitPriceMinor: 1n })], discounts: [candidate({ value: 5000n })], currency: "TND", shippingMinor: 0n, now });
    expect(result.merchandiseDiscountMinor).toBe(1n);
    expect(result.grandTotalMinor).toBe(0n);
  });
  it("chooses the highest-precedence non-combinable Discount only", () => {
    const result = engine.calculate({ lines: [line()], discounts: [candidate({ id: "low", priority: 20, value: 9000n }), candidate({ id: "high", priority: 10, value: 1000n })], currency: "TND", shippingMinor: 0n, now });
    expect(result.discounts.map((item) => item.discountId)).toEqual(["high"]);
    expect(result.totalDiscountMinor).toBe(10n);
  });
  it("stacks only combinable Discounts in priority order against remaining base", () => {
    const result = engine.calculate({ lines: [line()], discounts: [candidate({ id: "second", priority: 20, combinable: true }), candidate({ id: "first", priority: 10, combinable: true }), candidate({ id: "ignored", priority: 30, combinable: false, value: 9000n })], currency: "TND", shippingMinor: 0n, now });
    expect(result.discounts.map((item) => item.discountId)).toEqual(["first", "second"]);
    expect(result.totalDiscountMinor).toBe(19n);
  });
  it("targets Products and Categories and allocates exact remainders deterministically", () => {
    const lines = [line({ variantId: "b", unitPriceMinor: 1n }), line({ variantId: "a", unitPriceMinor: 1n })];
    const result = engine.calculate({ lines, discounts: [candidate({ scope: "CATEGORY", categoryIds: [categoryId], value: 5000n })], currency: "TND", shippingMinor: 0n, now });
    expect(result.merchandiseDiscountMinor).toBe(1n);
    expect(result.lines.find((item) => item.variantId === "a")?.discountMinor).toBe(1n);
    expect(result.lines.reduce((sum, item) => sum + item.finalMinor, 0n)).toBe(result.grandTotalMinor);
  });
  it("targets individual Variants, Collections, and the entire Catalog", () => {
    const lines = [line({ variantId: "target", collectionIds: ["summer"] }), line({ variantId: "other", collectionIds: [] })];
    const variantResult = engine.calculate({ lines, discounts: [candidate({ scope: "VARIANT", variantIds: ["target"] })], currency: "TND", shippingMinor: 0n, now });
    expect(variantResult.lines.map((item) => item.discountMinor)).toEqual([10n, 0n]);
    const collectionResult = engine.calculate({ lines, discounts: [candidate({ scope: "COLLECTION", collectionIds: ["summer"] })], currency: "TND", shippingMinor: 0n, now });
    expect(collectionResult.lines.map((item) => item.discountMinor)).toEqual([10n, 0n]);
    const catalogResult = engine.calculate({ lines, discounts: [candidate({ scope: "CATALOG" })], currency: "TND", shippingMinor: 0n, now });
    expect(catalogResult.totalDiscountMinor).toBe(20n);
  });
  it("rejects a coupon when a higher-precedence exclusive automatic promotion wins", () => {
    const result = engine.calculate({
      lines: [line()],
      discounts: [candidate({ id: "automatic", priority: 1 }), candidate({ id: "coupon", code: "SAVE", priority: 2 })],
      currency: "TND",
      shippingMinor: 0n,
      couponCode: "SAVE",
      now,
    });
    expect(result.discounts.map((item) => item.discountId)).toEqual(["automatic"]);
    expect(result.eligibleCoupon).toBe(false);
  });
  it("applies caps, minimum spend, currency, coupon, usage, and exclusive time boundaries", () => {
    const discounts = [
      candidate({ id: "coupon", code: "SAVE", type: "FIXED_AMOUNT", currency: "TND", value: 50n, maxDiscountMinor: 20n, minOrderMinor: 100n }),
      candidate({ id: "expired", priority: 20, endsAt: now }),
      candidate({ id: "exhausted", priority: 30, usageLimit: 1, totalUsage: 1 }),
    ];
    const result = engine.calculate({ lines: [line()], discounts, currency: "TND", shippingMinor: 0n, couponCode: " save ", now });
    expect(result.eligibleCoupon).toBe(true); expect(result.totalDiscountMinor).toBe(20n);
    expect(engine.calculate({ lines: [line()], discounts, currency: "USD", shippingMinor: 0n, couponCode: "SAVE", now }).eligibleCoupon).toBe(false);
  });
  it("applies free shipping without reducing merchandise below zero", () => {
    const result = engine.calculate({ lines: [line()], discounts: [candidate({ type: "FREE_SHIPPING", scope: "ORDER", value: 0n })], currency: "TND", shippingMinor: 25n, now });
    expect(result.shippingDiscountMinor).toBe(25n); expect(result.grandTotalMinor).toBe(100n);
  });
});
