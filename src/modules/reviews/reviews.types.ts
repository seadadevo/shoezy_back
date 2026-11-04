import type { Prisma } from "@prisma/client";
export const reviewSelect = { id: true, productId: true, userId: true, orderItemId: true, rating: true, title: true, body: true, status: true, isVerifiedPurchase: true, publishedAt: true, createdAt: true, updatedAt: true, user: { select: { firstName: true, lastName: true } }, product: { select: { name: true, slug: true } } } as const satisfies Prisma.ProductReviewSelect;
export type ReviewRecord = Prisma.ProductReviewGetPayload<{ select: typeof reviewSelect }>;
