import { Prisma, type PrismaClient } from "@prisma/client";
import { prisma } from "../../config/database";
import { isSerializableTransactionConflict } from "../../common/utils/prisma-transaction";
import { isUniqueConstraintError } from "../auth/auth.errors";
import { publicProductVisibility } from "../catalog/public-product-visibility";
import { reviewSelect } from "./reviews.types";
import type { CreateReviewInput, ListAdminReviewsQuery, ListPublicReviewsQuery, UpdateReviewInput } from "./reviews.validation";
import { PERMISSIONS } from "../../common/auth/rbac.constants";
import { enqueueNotification } from "../notifications/notifications.outbox";
import { publicReviewWhere, ratingSummaryFromGroups } from "./rating-summary";
export class ReviewsRepository {
  constructor(private readonly client: PrismaClient = prisma) {}
  private async serializable<T>(operation: (transaction: Prisma.TransactionClient) => Promise<T>): Promise<T> { for (let attempt = 1; attempt <= 3; attempt += 1) { try { return await this.client.$transaction(operation, { isolationLevel: "Serializable" }); } catch (error: unknown) { if (!isSerializableTransactionConflict(error) || attempt === 3) throw error; } } throw new Error("Serializable retry exhausted"); }
  async listPublic(productId: string, query: ListPublicReviewsQuery, now: Date) {
    return this.client.$transaction(async (transaction) => {
      const product = await transaction.product.findFirst({ where: { id: productId, ...publicProductVisibility(now) }, select: { id: true } });
      if (!product) return null;
      const where = publicReviewWhere(productId, now);
      const orderBy: Prisma.ProductReviewOrderByWithRelationInput[] = query.sort === "oldest" ? [{ publishedAt: "asc" }, { id: "asc" }] : query.sort === "rating_desc" ? [{ rating: "desc" }, { publishedAt: "desc" }, { id: "asc" }] : query.sort === "rating_asc" ? [{ rating: "asc" }, { publishedAt: "desc" }, { id: "asc" }] : [{ publishedAt: "desc" }, { id: "desc" }];
      const [items, aggregate, groups] = await Promise.all([
        transaction.productReview.findMany({ where, skip: (query.page - 1) * query.limit, take: query.limit, orderBy, select: reviewSelect }),
        transaction.productReview.aggregate({ where, _avg: { rating: true }, _count: { _all: true } }),
        transaction.productReview.groupBy({ by: ["rating"], where, _count: { _all: true } }),
      ]);
      return { items, total: aggregate._count._all, average: aggregate._avg.rating, count: aggregate._count._all, ratingSummary: ratingSummaryFromGroups(groups) };
    }, { isolationLevel: "RepeatableRead" });
  }
  async create(userId: string, productId: string, input: CreateReviewInput, now: Date) {
    try {
      return await this.serializable(async (transaction) => {
        await transaction.$queryRaw`SELECT "id" FROM "order_items" WHERE "id" = ${input.orderItemId}::uuid FOR UPDATE`;
        const eligible = await transaction.orderItem.findFirst({ where: { id: input.orderItemId, productId, order: { userId, status: { in: ["PENDING", "CONFIRMED", "SHIPPED", "DELIVERED"] } } }, select: { id: true } });
        if (!eligible) return "NOT_ELIGIBLE" as const;
        const value = await transaction.productReview.create({ data: { productId, userId, orderItemId: input.orderItemId, rating: input.rating, title: input.title, body: input.body, status: "PENDING", isVerifiedPurchase: true, publishedAt: null, createdAt: now }, select: reviewSelect });
        await enqueueNotification(transaction, {
          audience: "ADMIN", recipientPermission: PERMISSIONS.REVIEWS_READ_ANY, type: "REVIEW_PENDING", entityType: "REVIEW", entityId: value.id,
          templateParams: {}, metadata: { reviewId: value.id, productId }, deduplicationKey: `review:${value.id}:pending:admin`, createdAt: now,
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
        review: null,
      },
      select: {
        id: true,
        productName: true,
        order: { select: { orderNumber: true, status: true } },
      },
    });
    const existingReview = await this.client.productReview.findFirst({
      where: { productId, userId },
      select: { id: true, rating: true, title: true, body: true, status: true, createdAt: true },
    });
    return {
      canReview: Boolean(eligibleItem),
      orderItemId: eligibleItem?.id ?? null,
      orderNumber: eligibleItem?.order.orderNumber ?? null,
      alreadyReviewed: Boolean(existingReview),
      existingReview: existingReview ?? null,
    };
  }
  async updateOwned(userId: string, productId: string, reviewId: string, input: UpdateReviewInput) { const result = await this.client.productReview.updateMany({ where: { id: reviewId, userId, productId }, data: { ...input, status: "PENDING", publishedAt: null } }); return result.count === 1 ? this.client.productReview.findUnique({ where: { id: reviewId }, select: reviewSelect }) : null; }
  async deleteOwned(userId: string, productId: string, reviewId: string) { return (await this.client.productReview.deleteMany({ where: { id: reviewId, userId, productId } })).count === 1; }
  async listAdmin(query: ListAdminReviewsQuery) { const where = { status: query.status, productId: query.productId, rating: query.rating }; const [items, total] = await this.client.$transaction([this.client.productReview.findMany({ where, skip: (query.page - 1) * query.limit, take: query.limit, orderBy: [{ createdAt: "desc" }, { id: "desc" }], select: reviewSelect }), this.client.productReview.count({ where })]); return { items, total }; }
  async moderate(reviewId: string, status: "APPROVED" | "REJECTED", now: Date) { const result = await this.client.productReview.updateMany({ where: { id: reviewId }, data: { status, publishedAt: status === "APPROVED" ? now : null } }); return result.count === 1 ? this.client.productReview.findUnique({ where: { id: reviewId }, select: reviewSelect }) : null; }
}
