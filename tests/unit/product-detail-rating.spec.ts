import { describe, expect, it, vi } from "vitest";
import { Prisma, type PrismaClient } from "@prisma/client";
import { publicReviewWhere, ratingSummaryFromGroups } from "../../src/modules/reviews/rating-summary";
import { ReviewsRepository } from "../../src/modules/reviews/reviews.repository";
import { ReviewsService } from "../../src/modules/reviews/reviews.service";
import { publicProductVisibility } from "../../src/modules/catalog/public-product-visibility";
import { CatalogRepository } from "../../src/modules/catalog/catalog.repository";
import type { CommercePricingService } from "../../src/services/commerce-pricing.service";

const productId = "11111111-1111-4111-8111-111111111111";
const group = (rating: number, count: number) => ({ rating, _count: { _all: count } });

describe("public product rating summary", () => {
  it("returns numeric zeroes and all five buckets without approved reviews", () => {
    expect(ratingSummaryFromGroups([])).toEqual({
      average: 0, count: 0,
      distribution: {
        5: { count: 0, percentage: 0 }, 4: { count: 0, percentage: 0 },
        3: { count: 0, percentage: 0 }, 2: { count: 0, percentage: 0 },
        1: { count: 0, percentage: 0 },
      },
    });
  });

  it("calculates one-star-through-five-star counts, percentages, and one-decimal average", () => {
    const summary = ratingSummaryFromGroups([group(5, 2), group(4, 1), group(3, 1), group(2, 1), group(1, 1)]);
    expect(summary).toEqual({
      average: 3.3, count: 6,
      distribution: {
        5: { count: 2, percentage: 33.3 }, 4: { count: 1, percentage: 16.7 },
        3: { count: 1, percentage: 16.7 }, 2: { count: 1, percentage: 16.7 },
        1: { count: 1, percentage: 16.7 },
      },
    });
    expect(Object.values(summary.distribution).reduce((sum, item) => sum + item.count, 0)).toBe(summary.count);
    expect(ratingSummaryFromGroups([group(5, 1)]).average).toBe(5);
    expect(ratingSummaryFromGroups([group(5, 1), group(4, 2)]).average).toBe(4.3);
  });

  it("uses approved and published review visibility with public product visibility", () => {
    const now = new Date("2026-08-13T12:00:00.000Z");
    expect(publicReviewWhere(productId, now)).toEqual({
      productId, status: "APPROVED", publishedAt: { not: null }, product: publicProductVisibility(now),
    });
  });

  it("loads the detail summary in one grouped review query", async () => {
    const now = new Date("2026-08-13T12:00:00.000Z");
    const groupBy = vi.fn().mockResolvedValue([group(5, 1), group(4, 2)]);
    const client = {
      product: { findFirst: vi.fn().mockResolvedValue({ id: productId }) },
      productVariant: { findMany: vi.fn().mockResolvedValue([]) },
      productReview: { groupBy },
    } as unknown as PrismaClient;
    const pricing = { calculateCatalogLines: vi.fn(async () => new Map()) } as unknown as CommercePricingService;
    const detail = await new CatalogRepository(client, pricing).findProductBySlug("trail-shoe", now);
    expect(detail?.ratingSummary).toMatchObject({ average: 4.3, count: 3 });
    expect(groupBy).toHaveBeenCalledTimes(1);
    expect(groupBy.mock.calls[0]?.[0].where).toEqual(publicReviewWhere(productId, now));
  });

  it("preserves existing public review aggregate fields while adding distribution", async () => {
    const summary = ratingSummaryFromGroups([group(5, 1)]);
    const repository = { listPublic: vi.fn(async () => ({
      items: [], total: 1, average: new Prisma.Decimal(5), count: 1, ratingSummary: summary,
    })) } as unknown as ReviewsRepository;
    const result = await new ReviewsService(repository).listPublic(productId, { page: 1, limit: 20, sort: "newest" });
    expect(result.aggregate).toMatchObject({ count: 1, averageRating: "5", distribution: { 5: { count: 1, percentage: 100 } } });
    expect(result.items).toEqual([]);
  });
});
