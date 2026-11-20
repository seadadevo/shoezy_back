import type { ReviewRecord } from "./reviews.types";

export const toPublicReviewDto = (review: ReviewRecord) => ({
  id: review.id,
  rating: review.rating,
  title: review.title,
  body: review.body,
  images: review.images ?? [],
  isVerifiedPurchase: review.isVerifiedPurchase,
  reviewer: {
    firstName: review.user.firstName,
    lastInitial: review.user.lastName ? `${review.user.lastName[0]}.` : "",
  },
  publishedAt: review.publishedAt,
  createdAt: review.createdAt,
});

export const toOwnReviewDto = (review: ReviewRecord) => ({
  id: review.id,
  productId: review.productId,
  orderItemId: review.orderItemId,
  rating: review.rating,
  title: review.title,
  body: review.body,
  images: review.images ?? [],
  status: review.status,
  isVerifiedPurchase: review.isVerifiedPurchase,
  publishedAt: review.publishedAt,
  createdAt: review.createdAt,
  updatedAt: review.updatedAt,
});

export const toAdminReviewDto = (review: ReviewRecord) => ({
  ...toOwnReviewDto(review),
  userId: review.userId,
  reviewer: review.user,
  product: review.product,
});
