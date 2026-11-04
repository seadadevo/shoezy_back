import { AppError } from "../../common/errors/app-error";
import { toDiscountDto } from "./discounts.dto";
import { DiscountsRepository, DiscountsRepositoryError, type DiscountWriteFields, type FinalDiscountState } from "./discounts.repository";
import type { CreateDiscountInput, ListDiscountsQuery, ReplaceDiscountTargetsInput, UpdateDiscountInput } from "./discounts.validation";
import { createMediaStorage, type MediaStorage, type UploadedMedia } from "../products/media-storage";
import { MAX_IMAGE_BYTES, imageMime } from "../products/product-media-upload.service";

export type PromotionUploadFile = Express.Multer.File | { buffer: Buffer; mimetype: string; size: number; originalname?: string };

export interface DiscountsStore {
  list: DiscountsRepository["list"];
  findById: DiscountsRepository["findById"];
  create: DiscountsRepository["create"];
  update: DiscountsRepository["update"];
  delete: DiscountsRepository["delete"];
  setActive: DiscountsRepository["setActive"];
  archive: DiscountsRepository["archive"];
  statistics: DiscountsRepository["statistics"];
}

function writeFields(input: Omit<CreateDiscountInput, "targets"> | Omit<UpdateDiscountInput, "targets">): DiscountWriteFields {
  const result: DiscountWriteFields = {};
  if (input.name !== undefined) result.name = input.name;
  if (input.description !== undefined) result.description = input.description;
  if (input.imageUrl !== undefined) result.imageUrl = input.imageUrl;
  if (input.showOnStorefront !== undefined) result.showOnStorefront = input.showOnStorefront;
  if (input.sortOrder !== undefined) result.sortOrder = input.sortOrder;
  if (input.ctaUrl !== undefined) result.ctaUrl = input.ctaUrl;
  if (input.code !== undefined) result.code = input.code === null ? null : input.code.trim().toUpperCase();
  if (input.type !== undefined) result.type = input.type;
  if (input.scope !== undefined) result.scope = input.scope;
  if (input.priority !== undefined) result.priority = input.priority;
  if (input.value !== undefined) result.value = BigInt(input.value);
  if (input.currency !== undefined) result.currency = input.currency;
  if (input.minOrderMinor !== undefined) result.minOrderMinor = input.minOrderMinor === null ? null : BigInt(input.minOrderMinor);
  if (input.maxDiscountMinor !== undefined) result.maxDiscountMinor = input.maxDiscountMinor === null ? null : BigInt(input.maxDiscountMinor);
  if (input.usageLimit !== undefined) result.usageLimit = input.usageLimit;
  if (input.perCustomerLimit !== undefined) result.perCustomerLimit = input.perCustomerLimit;
  if (input.startsAt !== undefined) result.startsAt = new Date(input.startsAt);
  if (input.endsAt !== undefined) result.endsAt = input.endsAt === null ? null : new Date(input.endsAt);
  if (input.isActive !== undefined) result.isActive = input.isActive;
  if (input.combinable !== undefined) result.combinable = input.combinable;
  if (input.translations !== undefined) result.translations = input.translations;
  return result;
}

function validateState(state: FinalDiscountState): void {
  if (state.endsAt && state.endsAt <= state.startsAt) throw new AppError(400, "Discount end time must be after its start time", "DISCOUNT_DATE_RANGE_INVALID");
  if (state.perCustomerLimit !== null && state.perCustomerLimit !== undefined && state.usageLimit !== null && state.usageLimit !== undefined && state.perCustomerLimit > state.usageLimit) {
    throw new AppError(400, "Per-customer limit cannot exceed total usage limit", "DISCOUNT_USAGE_LIMIT_INVALID");
  }
  if (state.type === "PERCENTAGE" && (state.value < 1n || state.value > 10_000n)) throw new AppError(400, "Percentage value must be 1 to 10000 basis points", "DISCOUNT_VALUE_INVALID");
  if (state.type === "FIXED_AMOUNT" && (state.value <= 0n || !state.currency)) throw new AppError(400, "Fixed discounts require a positive value and currency", "DISCOUNT_VALUE_INVALID");
  if (state.type === "FREE_SHIPPING" && (state.value !== 0n || state.scope !== "ORDER")) throw new AppError(400, "Free shipping requires ORDER scope and zero value", "DISCOUNT_VALUE_INVALID");
  if ((state.scope === "ORDER" || state.scope === "CATALOG") && state.targets.length !== 0) throw new AppError(400, `${state.scope} discounts cannot have targets`, "DISCOUNT_TARGETS_INVALID");
  if (state.scope === "PRODUCT" && (state.targets.length === 0 || state.targets.some((target) => !("productId" in target)))) throw new AppError(400, "Product discounts require Product targets", "DISCOUNT_TARGETS_INVALID");
  if (state.scope === "VARIANT" && (state.targets.length === 0 || state.targets.some((target) => !("variantId" in target)))) throw new AppError(400, "Variant discounts require Variant targets", "DISCOUNT_TARGETS_INVALID");
  if (state.scope === "CATEGORY" && (state.targets.length === 0 || state.targets.some((target) => !("categoryId" in target)))) throw new AppError(400, "Category discounts require Category targets", "DISCOUNT_TARGETS_INVALID");
  if (state.scope === "COLLECTION" && (state.targets.length === 0 || state.targets.some((target) => !("collectionId" in target)))) throw new AppError(400, "Collection discounts require Collection targets", "DISCOUNT_TARGETS_INVALID");
}

export class DiscountsService {
  constructor(
    private readonly repository: DiscountsStore = new DiscountsRepository(),
    private readonly storage: MediaStorage = createMediaStorage(),
  ) {}

  private validateFile(file: PromotionUploadFile): "image/jpeg" | "image/png" | "image/webp" {
    if (file.size > MAX_IMAGE_BYTES) {
      throw new AppError(413, "Image exceeds 8 MB", "MEDIA_FILE_TOO_LARGE");
    }
    const detected = imageMime(file.buffer);
    if (!detected || detected !== file.mimetype.toLowerCase()) {
      throw new AppError(422, "Only valid JPEG, PNG, and WebP images are accepted", "MEDIA_FILE_INVALID");
    }
    return detected;
  }

  private async uploadImage(file: PromotionUploadFile): Promise<UploadedMedia> {
    const mimetype = this.validateFile(file);
    if (!this.storage.isConfigured()) {
      throw new AppError(503, "Image storage is not configured", "MEDIA_STORAGE_NOT_CONFIGURED");
    }
    return this.storage.upload(
      { buffer: file.buffer, mimetype },
      { folder: "shoozy/promotions" },
    );
  }

  private async deleteOwnedImage(
    image: Pick<DiscountWriteFields, "imageStorageProvider" | "imageStorageKey">,
    context: string,
  ): Promise<void> {
    if (!image.imageStorageKey || !["LOCAL", "CLOUDINARY"].includes(image.imageStorageProvider ?? "")) return;
    try {
      await this.storage.delete(image.imageStorageKey);
    } catch (error: unknown) {
      console.error(`[Storage] Failed to ${context}:`, {
        storageProvider: image.imageStorageProvider,
        storageKey: image.imageStorageKey,
        error,
      });
    }
  }

  private map(error: unknown): never {
    if (error instanceof DiscountsRepositoryError) {
      if (error.code === "DUPLICATE_CODE") throw new AppError(409, "Discount code already exists", "DISCOUNT_CODE_ALREADY_EXISTS");
      if (error.code === "DUPLICATE_PRIORITY") throw new AppError(409, "Discount priority already exists", "DISCOUNT_PRIORITY_ALREADY_EXISTS");
      throw new AppError(409, "Discount target already exists", "DISCOUNT_TARGET_ALREADY_EXISTS");
    }
    throw error;
  }

  async list(query: ListDiscountsQuery) {
    const result = await this.repository.list(query);
    return { items: result.items.map((discount) => toDiscountDto(discount)), pagination: { page: query.page, limit: query.limit, total: result.total, totalPages: Math.ceil(result.total / query.limit) } };
  }
  async get(discountId: string) {
    const discount = await this.repository.findById(discountId);
    if (!discount) throw new AppError(404, "Discount not found", "DISCOUNT_NOT_FOUND");
    return toDiscountDto(discount);
  }
  async create(input: CreateDiscountInput, file?: PromotionUploadFile) {
    const { targets, ...fields } = input;
    let uploaded: UploadedMedia | null = null;
    if (file) uploaded = await this.uploadImage(file);

    const persistedFields = writeFields(fields);
    if (uploaded) {
      persistedFields.imageUrl = uploaded.url;
      persistedFields.imageStorageProvider = uploaded.provider;
      persistedFields.imageStorageKey = uploaded.key;
    }

    try {
      const result = await this.repository.create(persistedFields, targets, validateState);
      if (result === "TARGET_NOT_FOUND") throw new AppError(404, "Discount target not found", "DISCOUNT_TARGET_NOT_FOUND");
      return toDiscountDto(result);
    } catch (error: unknown) {
      if (uploaded) await this.deleteOwnedImage({ imageStorageProvider: uploaded.provider, imageStorageKey: uploaded.key }, "clean up newly uploaded promotion image after DB creation failure");
      this.map(error);
    }
  }
  async update(discountId: string, input: UpdateDiscountInput, file?: PromotionUploadFile) {
    const current = await this.repository.findById(discountId);
    if (!current) throw new AppError(404, "Discount not found", "DISCOUNT_NOT_FOUND");

    const { targets, ...fields } = input;
    let uploaded: UploadedMedia | null = null;
    if (file) uploaded = await this.uploadImage(file);

    const persistedFields = writeFields(fields);
    let replacesImage = false;
    if (uploaded) {
      persistedFields.imageUrl = uploaded.url;
      persistedFields.imageStorageProvider = uploaded.provider;
      persistedFields.imageStorageKey = uploaded.key;
      replacesImage = current.imageUrl !== uploaded.url;
    } else if (input.imageUrl !== undefined && input.imageUrl !== current.imageUrl) {
      persistedFields.imageStorageProvider = null;
      persistedFields.imageStorageKey = null;
      replacesImage = true;
    }

    let result;
    try {
      result = await this.repository.update(discountId, persistedFields, targets, validateState);
      if (result === "NOT_FOUND") throw new AppError(404, "Discount not found", "DISCOUNT_NOT_FOUND");
      if (result === "TARGET_NOT_FOUND") throw new AppError(404, "Discount target not found", "DISCOUNT_TARGET_NOT_FOUND");
    } catch (error: unknown) {
      if (uploaded) await this.deleteOwnedImage({ imageStorageProvider: uploaded.provider, imageStorageKey: uploaded.key }, "clean up newly uploaded promotion image after DB update failure");
      this.map(error);
    }

    if (replacesImage) {
      await this.deleteOwnedImage(current, "delete replaced promotion image");
    }
    return toDiscountDto(result);
  }
  async replaceTargets(discountId: string, input: ReplaceDiscountTargetsInput) {
    try {
      const result = await this.repository.update(discountId, {}, input.targets, validateState);
      if (result === "NOT_FOUND") throw new AppError(404, "Discount not found", "DISCOUNT_NOT_FOUND");
      if (result === "TARGET_NOT_FOUND") throw new AppError(404, "Discount target not found", "DISCOUNT_TARGET_NOT_FOUND");
      return toDiscountDto(result);
    } catch (error: unknown) { this.map(error); }
  }
  async delete(discountId: string): Promise<void> {
    const existing = await this.repository.findById(discountId);
    if (!existing) throw new AppError(404, "Discount not found", "DISCOUNT_NOT_FOUND");
    const result = await this.repository.delete(discountId);
    if (result === "NOT_FOUND") throw new AppError(404, "Discount not found", "DISCOUNT_NOT_FOUND");
    if (result === "IN_USE") throw new AppError(409, "Discount has redemptions and cannot be deleted", "DISCOUNT_IN_USE");
    await this.deleteOwnedImage(existing, "delete promotion image after promotion deletion");
  }

  async setActive(discountId: string, isActive: boolean) {
    const result = await this.repository.setActive(discountId, isActive);
    if (result === "NOT_FOUND") throw new AppError(404, "Discount not found", "DISCOUNT_NOT_FOUND");
    if (result === "ARCHIVED") throw new AppError(409, "Archived discounts cannot be activated or deactivated", "DISCOUNT_ARCHIVED");
    return toDiscountDto(result);
  }

  async archive(discountId: string) {
    const result = await this.repository.archive(discountId, new Date());
    if (result === "NOT_FOUND") throw new AppError(404, "Discount not found", "DISCOUNT_NOT_FOUND");
    return toDiscountDto(result);
  }

  async statistics(discountId: string) {
    const result = await this.repository.statistics(discountId);
    if (result === "NOT_FOUND") throw new AppError(404, "Discount not found", "DISCOUNT_NOT_FOUND");
    return {
      usageCount: result.usageCount,
      associatedOrders: result.associatedOrders,
      totalDiscountGrantedMinor: result.totalDiscountGrantedMinor.toString(),
      revenueMinor: result.revenueMinor.toString(),
    };
  }
}
