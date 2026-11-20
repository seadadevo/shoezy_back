import type { Prisma } from "@prisma/client";
import { publicProductVisibility } from "../catalog/public-product-visibility";

export function publicReviewWhere(productId: string, now: Date): Prisma.ProductReviewWhereInput {
  return {
    productId,
    status: "APPROVED",
    publishedAt: { not: null },
    product: publicProductVisibility(now),
  };
}

const stars = [5, 4, 3, 2, 1] as const;
type Star = (typeof stars)[number];
type Bucket = { count: number; percentage: number };
export type RatingSummary = {
  average: number;
  count: number;
  distribution: Record<Star, Bucket>;
};

const oneDecimal = (value: number) => Math.round(value * 10) / 10;

export function ratingSummaryFromGroups(groups: ReadonlyArray<{ rating: number | null; _count: { _all: number } }>): RatingSummary {
  const counts = new Map(groups.filter((g) => g.rating !== null).map((group) => [group.rating as Star, group._count._all]));
  const count = stars.reduce((total, star) => total + (counts.get(star) ?? 0), 0);
  const weighted = stars.reduce((total, star) => total + star * (counts.get(star) ?? 0), 0);
  const bucket = (star: Star): Bucket => {
    const value = counts.get(star) ?? 0;
    return { count: value, percentage: count === 0 ? 0 : oneDecimal(value * 100 / count) };
  };
  return {
    average: count === 0 ? 0 : oneDecimal(weighted / count),
    count,
    distribution: { 5: bucket(5), 4: bucket(4), 3: bucket(3), 2: bucket(2), 1: bucket(1) },
  };
}
