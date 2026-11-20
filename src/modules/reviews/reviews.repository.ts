import { Prisma, type PrismaClient } from "@prisma/client";
import { prisma } from "../../config/database";
import { isSerializableTransactionConflict } from "../../common/utils/prisma-transaction";
import { isUniqueConstraintError } from "../auth/auth.errors";
import { publicProductVisibility } from "../catalog/public-product-visibility";
import { reviewSelect } from "./reviews.types";
import { toOwnReviewDto } from "./reviews.dto";
import type { CreateReviewInput, ListAdminReviewsQuery, ListPublicReviewsQuery, UpdateReviewInput } from "./reviews.validation";
import { PERMISSIONS } from "../../common/auth/rbac.constants";
import { enqueueNotification } from "../notifications/notifications.outbox";
import { publicReviewWhere, ratingSummaryFromGroups } from "./rating-summary";

export class ReviewsRepository {
  constructor(private readonly client: PrismaClient = prisma) {}

  private async serializable<T>(operation: (transaction: Prisma.TransactionClient) => Promise<T>): Promise<T> {
    for (let attempt = 1; attempt <= 3; attempt += 1) {
      try {
        return await this.client.$transaction(operation, { isolationLevel: "Serializable" });
      } catch (error: unknown) {
        if (!isSerializableTransactionConflict(error) || attempt === 3) throw error;
      }
    }
    throw new Error("Serializable retry exhausted");
  }

  async listPublic(productId: string, query: ListPublicReviewsQuery, now: Date) {
    return this.client.$transaction(async (transaction) => {
      const product = await transaction.product.findFirst({ where: { id: productId, ...publicProductVisibility(now) }, select: { id: true } });
      if (!product) return null;
      const where = publicReviewWhere(productId, now);
      const ratingWhere = { ...where, rating: { not: null } };
      const orderBy: Prisma.ProductReviewOrderByWithRelationInput[] =
        query.sort === "oldest"
          ? [{ publishedAt: "asc" }, { id: "asc" }]
          : query.sort === "rating_desc"
          ? [{ rating: "desc" }, { publishedAt: "desc" }, { id: "asc" }]
          : query.sort === "rating_asc"
          ? [{ rating: "asc" }, { publishedAt: "desc" }, { id: "asc" }]
          : [{ publishedAt: "desc" }, { id: "desc" }];

      const [items, aggregate, groups] = await Promise.all([
        transaction.productReview.findMany({ where, skip: (query.page - 1) * query.limit, take: query.limit, orderBy, select: reviewSelect }),
        transaction.productReview.aggregate({ where: ratingWhere, _avg: { rating: true }, _count: { _all: true } }),
        transaction.productReview.groupBy({ by: ["rating"], where: ratingWhere, _count: { _all: true } }),
      ]);
      return {
        items,
        total: items.length,
        average: aggregate._avg.rating,
        count: aggregate._count._all,
        ratingSummary: ratingSummaryFromGroups(groups),
      };
    }, { isolationLevel: "RepeatableRead" });
  }

  async create(userId: string, productId: string, input: CreateReviewInput, now: Date) {
    try {
      return await this.serializable(async (transaction) => {
        let verifiedOrderItemId: string | null = null;
        if (input.orderItemId) {
          await transaction.$queryRaw`SELECT "id" FROM "order_items" WHERE "id" = ${input.orderItemId}::uuid FOR UPDATE`;
          const eligible = await transaction.orderItem.findFirst({
            where: { id: input.orderItemId, productId, order: { userId, status: { in: ["PENDING", "CONFIRMED", "SHIPPED", "DELIVERED"] } } },
            select: { id: true },
          });
          if (!eligible) return "NOT_ELIGIBLE" as const;
          verifiedOrderItemId = eligible.id;
        } else {
          const eligible = await transaction.orderItem.findFirst({
            where: { productId, order: { userId, status: { in: ["PENDING", "CONFIRMED", "SHIPPED", "DELIVERED"] } } },
            select: { id: true },
          });
          if (!eligible) return "NOT_ELIGIBLE" as const;
          verifiedOrderItemId = eligible.id;
        }

        // Check if user already submitted a rating for this product
        const existingRatedReview = await transaction.productReview.findFirst({
          where: { productId, userId, rating: { not: null } },
          select: { id: true },
        });

        // Constraint: User can rate only once per product. Subsequent reviews cannot add a new rating.
        const finalRating = existingRatedReview ? null : (input.rating ?? null);

        const value = await transaction.productReview.create({
          data: {
            productId,
            userId,
            orderItemId: verifiedOrderItemId,
            rating: finalRating,
            title: input.title ?? null,
            body: input.body ?? null,
            images: input.images ?? [],
            status: "PENDING",
            isVerifiedPurchase: true,
            publishedAt: null,
            createdAt: now,
          },
          select: reviewSelect,
        });

        await enqueueNotification(transaction, {
          audience: "ADMIN",
          recipientPermission: PERMISSIONS.REVIEWS_READ_ANY,
          type: "REVIEW_PENDING",
          entityType: "REVIEW",
          entityId: value.id,
          templateParams: {},
          metadata: { reviewId: value.id, productId },
          deduplicationKey: `review:${value.id}:pending:admin`,
          createdAt: now,
        });

        return value;
      });
    } catch (error: unknown) {
      if (isUniqueConstraintError(error)) return "DUPLICATE" as const;
      throw error;
    }
  }

  async checkEligibility(userId: string, productId: string) {
    const eligibleItem = await this.client.orderItem.findFirst({
      where: {
        productId,
        order: { userId, status: { in: ["PENDING", "CONFIRMED", "SHIPPED", "DELIVERED"] } },
      },
      select: {
        id: true,
        productName: true,
        order: { select: { orderNumber: true, status: true } },
      },
    });

    const existingRatedReview = await this.client.productReview.findFirst({
      where: { productId, userId, rating: { not: null } },
      select: { id: true, rating: true, title: true, body: true, status: true, createdAt: true },
    });

    const userReviews = await this.client.productReview.findMany({
      where: { productId, userId },
      orderBy: { createdAt: "desc" },
      select: reviewSelect,
    });

    return {
      canReview: Boolean(eligibleItem),
      hasRated: Boolean(existingRatedReview),
      existingRating: existingRatedReview?.rating ?? null,
      orderItemId: eligibleItem?.id ?? null,
      orderNumber: eligibleItem?.order.orderNumber ?? null,
      alreadyReviewed: userReviews.length > 0,
      existingReview: existingRatedReview ?? userReviews[0] ?? null,
      userReviews: userReviews.map(toOwnReviewDto),
    };
  }

  async updateOwned(userId: string, reviewId: string, input: UpdateReviewInput, productId?: string) {
    const where: Prisma.ProductReviewWhereInput = { id: reviewId, userId };
    if (productId) where.productId = productId;

    // If rating is passed, verify rating constraint
    let updateData: Prisma.ProductReviewUpdateInput = {
      title: input.title,
      body: input.body,
      images: input.images,
      status: "PENDING",
      publishedAt: null,
    };
    if (input.rating !== undefined) {
      updateData.rating = input.rating;
    }

    const result = await this.client.productReview.updateMany({
      where,
      data: updateData,
    });
    return result.count === 1 ? this.client.productReview.findUnique({ where: { id: reviewId }, select: reviewSelect }) : null;
  }

  async deleteOwned(userId: string, reviewId: string, productId?: string) {
    const where: Prisma.ProductReviewWhereInput = { id: reviewId, userId };
    if (productId) where.productId = productId;
    return (await this.client.productReview.deleteMany({ where })).count === 1;
  }

  async listAdmin(query: ListAdminReviewsQuery) {
    const where: Prisma.ProductReviewWhereInput = {
      status: query.status,
      productId: query.productId,
      ...(query.rating ? { rating: query.rating } : {}),
    };
    const [items, total] = await this.client.$transaction([
      this.client.productReview.findMany({
        where,
        skip: (query.page - 1) * query.limit,
        take: query.limit,
        orderBy: [{ createdAt: "desc" }, { id: "desc" }],
        select: reviewSelect,
      }),
      this.client.productReview.count({ where }),
    ]);
    return { items, total };
  }

  async moderate(reviewId: string, status: "APPROVED" | "REJECTED", now: Date) {
    const result = await this.client.productReview.updateMany({
      where: { id: reviewId },
      data: { status, publishedAt: status === "APPROVED" ? now : null },
    });
    return result.count === 1 ? this.client.productReview.findUnique({ where: { id: reviewId }, select: reviewSelect }) : null;
  }
}
