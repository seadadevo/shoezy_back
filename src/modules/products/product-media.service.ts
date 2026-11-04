import { AppError } from "../../common/errors/app-error";
import { toProductMediaDto } from "./product-media.dto";
import { ProductMediaRepository, ProductMediaRepositoryError } from "./product-media.repository";
import type {
  CreateProductMediaInput,
  ListProductMediaQuery,
  UpdateProductMediaInput,
} from "./product-media.validation";
import { createMediaStorage, type MediaStorage } from "./media-storage";
import type { ProductVideoRecord } from "./product-media.types";

export interface ProductMediaStore {
  list: ProductMediaRepository["list"];
  create: ProductMediaRepository["create"];
  update: ProductMediaRepository["update"];
  delete: ProductMediaRepository["delete"];
  findVideo?: (productId: string) => Promise<ProductVideoRecord | null>;
}

export class ProductMediaService {
  constructor(private readonly repository: ProductMediaStore = new ProductMediaRepository(), private readonly storage: MediaStorage = createMediaStorage()) {}

  async findVideo(productId: string): Promise<ProductVideoRecord | null> {
    if (this.repository.findVideo) {
      return await this.repository.findVideo(productId);
    }
    return null;
  }

  private result<T extends { status: string; media?: Parameters<typeof toProductMediaDto>[0] }>(value: T) {
    if (value.status === "PRODUCT_NOT_FOUND") {
      throw new AppError(404, "Product not found", "PRODUCT_NOT_FOUND");
    }
    if (value.status === "MEDIA_NOT_FOUND") {
      throw new AppError(404, "Product media not found", "PRODUCT_MEDIA_NOT_FOUND");
    }
    if (value.status === "VARIANT_NOT_FOUND") {
      throw new AppError(404, "Product variant not found", "PRODUCT_VARIANT_NOT_FOUND");
    }
    if (!value.media) throw new AppError(500, "Product media result missing", "PRODUCT_MEDIA_RESULT_MISSING");
    return toProductMediaDto(value.media);
  }

  async list(productId: string, query: ListProductMediaQuery) {
    const result = await this.repository.list(productId, query);
    if (result.status === "PRODUCT_NOT_FOUND") {
      throw new AppError(404, "Product not found", "PRODUCT_NOT_FOUND");
    }
    return {
      items: result.items.map(toProductMediaDto),
      pagination: {
        page: query.page,
        limit: query.limit,
        total: result.total,
        totalPages: Math.ceil(result.total / query.limit),
      },
    };
  }

  async create(productId: string, input: CreateProductMediaInput & { storageProvider?: string; storageKey?: string }) {
    try { return this.result(await this.repository.create(productId, input)); }
    catch (error: unknown) {
      if (error instanceof ProductMediaRepositoryError) {
        if (error.code === "VIDEO_CANNOT_BE_PRIMARY") {
          throw new AppError(422, "Video media cannot be used as the product primary cover", "MEDIA_VIDEO_CANNOT_BE_PRIMARY");
        }
        if (error.code === "VIDEO_LIMIT_EXCEEDED") {
          throw new AppError(409, "Product already has a video", "MEDIA_VIDEO_LIMIT_EXCEEDED");
        }
        throw new AppError(409, "Product already has primary media", "PRODUCT_MEDIA_PRIMARY_CONFLICT");
      }
      throw error;
    }
  }

  async update(
    productId: string,
    mediaId: string,
    input: UpdateProductMediaInput & { storageProvider?: string | null; storageKey?: string | null },
  ) {
    try { return this.result(await this.repository.update(productId, mediaId, input)); }
    catch (error: unknown) {
      if (error instanceof ProductMediaRepositoryError) {
        if (error.code === "VIDEO_CANNOT_BE_PRIMARY") {
          throw new AppError(422, "Video media cannot be used as the product primary cover", "MEDIA_VIDEO_CANNOT_BE_PRIMARY");
        }
        if (error.code === "VIDEO_LIMIT_EXCEEDED") {
          throw new AppError(409, "Product already has a video", "MEDIA_VIDEO_LIMIT_EXCEEDED");
        }
        throw new AppError(409, "Product already has primary media", "PRODUCT_MEDIA_PRIMARY_CONFLICT");
      }
      throw error;
    }
  }

  async delete(productId: string, mediaId: string): Promise<void> {
    const deleted = await this.repository.delete(productId, mediaId);
    this.result(deleted);
    if (deleted.status === "OK") {
      const uploaded = deleted.media;
      if ((uploaded.storageProvider === "CLOUDINARY" || uploaded.storageProvider === "LOCAL") && uploaded.storageKey && this.storage.isConfigured()) {
        try { await this.storage.delete(uploaded.storageKey, { resourceType: uploaded.mediaType === "VIDEO" || uploaded.type === "VIDEO" ? "video" : "image" }); } catch { console.error("Deleted media cleanup failed", { storageProvider: uploaded.storageProvider, storageKey: uploaded.storageKey }); }
      }
    }
  }
}
