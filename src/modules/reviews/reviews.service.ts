import { AppError } from "../../common/errors/app-error";
import { toAdminReviewDto, toOwnReviewDto, toPublicReviewDto } from "./reviews.dto";
import { ReviewsRepository } from "./reviews.repository";
import type { CreateReviewInput, ListAdminReviewsQuery, ListPublicReviewsQuery, UpdateReviewInput } from "./reviews.validation";

const page = (number: number, limit: number, total: number) => ({ page: number, limit, total, totalPages: Math.ceil(total / limit) });

export class ReviewsService {
  constructor(private readonly repository = new ReviewsRepository()) {}

  async listPublic(productId: string, query: ListPublicReviewsQuery, now = new Date()) {
    const result = await this.repository.listPublic(productId, query, now);
    if (!result) throw new AppError(404, "Product not found", "PRODUCT_NOT_FOUND");
    return {
      items: result.items.map(toPublicReviewDto),
      aggregate: { count: result.count, averageRating: result.average === null ? null : result.average.toString(), distribution: result.ratingSummary.distribution },
      pagination: page(query.page, query.limit, result.total),
    };
  }

  async checkEligibility(userId: string, productId: string) {
    return this.repository.checkEligibility(userId, productId);
  }

  async create(userId: string, productId: string, input: CreateReviewInput, now = new Date()) {
    const result = await this.repository.create(userId, productId, input, now);
    if (result === "NOT_ELIGIBLE") throw new AppError(409, "A valid purchase for this Product is required", "REVIEW_NOT_ELIGIBLE");
    if (result === "DUPLICATE") throw new AppError(409, "This Order item has already been reviewed", "REVIEW_ORDER_ITEM_CONFLICT");
    return toOwnReviewDto(result);
  }

  async update(userId: string, reviewId: string, input: UpdateReviewInput, productId?: string) {
    const review = await this.repository.updateOwned(userId, reviewId, input, productId);
    if (!review) throw new AppError(404, "Review not found", "REVIEW_NOT_FOUND");
    return toOwnReviewDto(review);
  }

  async delete(userId: string, reviewId: string, productId?: string) {
    if (!(await this.repository.deleteOwned(userId, reviewId, productId))) {
      throw new AppError(404, "Review not found", "REVIEW_NOT_FOUND");
    }
  }

  async deleteAdmin(reviewId: string) {
    if (!(await this.repository.deleteOwned("", reviewId))) {
      // Direct delete for admin
      throw new AppError(404, "Review not found", "REVIEW_NOT_FOUND");
    }
  }

  async listAdmin(query: ListAdminReviewsQuery) {
    const result = await this.repository.listAdmin(query);
    return { items: result.items.map(toAdminReviewDto), pagination: page(query.page, query.limit, result.total) };
  }

  async moderate(reviewId: string, status: "APPROVED" | "REJECTED", now = new Date()) {
    const review = await this.repository.moderate(reviewId, status, now);
    if (!review) throw new AppError(404, "Review not found", "REVIEW_NOT_FOUND");
    return toAdminReviewDto(review);
  }
}
