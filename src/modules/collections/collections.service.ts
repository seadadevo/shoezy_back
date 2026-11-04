import { AppError } from "../../common/errors/app-error";
import { normalizeSlug } from "../../common/utils/slug";
import { toCollectionDetailDto, toCollectionDto } from "./collections.dto";
import { CollectionsRepository, CollectionsRepositoryError } from "./collections.repository";
import type {
  CreateCollectionInput,
  ListCollectionsQuery,
  ReplaceCollectionProductsInput,
  UpdateCollectionInput,
} from "./collections.validation";
import { createMediaStorage, type MediaStorage, type UploadedMedia } from "../products/media-storage";
import { MAX_IMAGE_BYTES, MAX_VIDEO_BYTES, imageMime, isMp4Buffer } from "../products/product-media-upload.service";

export type CollectionUploadFile = Express.Multer.File | { buffer: Buffer; mimetype: string; size: number; originalname?: string };

export interface CollectionsStore {
  list: CollectionsRepository["list"];
  findById: CollectionsRepository["findById"];
  create: CollectionsRepository["create"];
  update: CollectionsRepository["update"];
  replaceProducts: CollectionsRepository["replaceProducts"];
  delete: CollectionsRepository["delete"];
}

function normalizedSlug(value: string): string {
  const result = normalizeSlug(value);
  if (!result || result.length > 180) {
    throw new AppError(422, "Collection slug is invalid", "COLLECTION_SLUG_INVALID");
  }
  return result;
}

function date(value: string | null | undefined): Date | null | undefined {
  return value === undefined ? undefined : value === null ? null : new Date(value);
}

function assertWindow(startsAt: Date | null | undefined, endsAt: Date | null | undefined): void {
  if (startsAt && endsAt && endsAt <= startsAt) {
    throw new AppError(400, "Collection end time must be after its start time", "COLLECTION_DATE_RANGE_INVALID");
  }
}

export class CollectionsService {
  constructor(
    private readonly repository: CollectionsStore = new CollectionsRepository(),
    private readonly storage: MediaStorage = createMediaStorage(),
  ) {}

  private validateImage(file: CollectionUploadFile): "image/jpeg" | "image/png" | "image/webp" {
    if (file.size > MAX_IMAGE_BYTES) {
      throw new AppError(413, "Image exceeds 8 MB", "MEDIA_FILE_TOO_LARGE");
    }
    const detected = imageMime(file.buffer);
    if (!detected || detected !== file.mimetype) {
      throw new AppError(422, "Only valid JPEG, PNG, and WebP images are accepted", "MEDIA_FILE_INVALID");
    }
    return detected;
  }

  private async uploadImage(file: CollectionUploadFile): Promise<string> {
    const mimetype = this.validateImage(file);
    if (!this.storage.isConfigured()) {
      throw new AppError(503, "Image storage is not configured", "MEDIA_STORAGE_NOT_CONFIGURED");
    }
    const uploaded = await this.storage.upload(
      { buffer: file.buffer, mimetype },
      { folder: "shoozy/collections" },
    );
    return uploaded.url;
  }

  private async uploadVideo(file: CollectionUploadFile): Promise<UploadedMedia> {
    if (file.size > MAX_VIDEO_BYTES) {
      throw new AppError(413, "Video exceeds 50 MB", "MEDIA_VIDEO_TOO_LARGE");
    }
    if (file.mimetype.toLowerCase() !== "video/mp4" || !isMp4Buffer(file.buffer)) {
      throw new AppError(422, "Only valid MP4 videos are accepted", "MEDIA_FILE_INVALID");
    }
    if (!this.storage.isConfigured()) {
      throw new AppError(503, "Media storage is not configured", "MEDIA_STORAGE_NOT_CONFIGURED");
    }
    return this.storage.upload(
      { buffer: file.buffer, mimetype: "video/mp4" },
      { folder: "shoozy/collections", resourceType: "video" },
    );
  }

  private async cleanup(keyOrUrl: string, message: string, resourceType: "image" | "video" = "image"): Promise<void> {
    try {
      await this.storage.delete(keyOrUrl, { resourceType });
    } catch (error: unknown) {
      console.error(message, { keyOrUrl, error });
    }
  }

  private async deleteOwnedVideo(provider: string | null, key: string | null, message: string): Promise<void> {
    if (key && (provider === "LOCAL" || provider === "CLOUDINARY")) {
      await this.cleanup(key, message, "video");
    }
  }

  private map(error: unknown): never {
    if (error instanceof CollectionsRepositoryError) {
      if (error.code === "INVALID_DATE_RANGE") {
        throw new AppError(400, "Collection end time must be after its start time", "COLLECTION_DATE_RANGE_INVALID");
      }
      throw new AppError(409, "A collection already uses this slug", "COLLECTION_SLUG_ALREADY_EXISTS");
    }
    throw error;
  }

  async list(query: ListCollectionsQuery) {
    const result = await this.repository.list(query);
    return {
      items: result.items.map(toCollectionDto),
      pagination: {
        page: query.page,
        limit: query.limit,
        total: result.total,
        totalPages: Math.ceil(result.total / query.limit),
      },
    };
  }

  async get(collectionId: string) {
    const collection = await this.repository.findById(collectionId);
    if (!collection) throw new AppError(404, "Collection not found", "COLLECTION_NOT_FOUND");
    return toCollectionDetailDto(collection);
  }

  async create(input: CreateCollectionInput, actorId?: string, file?: CollectionUploadFile, videoFile?: CollectionUploadFile) {
    const startsAt = date(input.startsAt);
    const endsAt = date(input.endsAt);
    assertWindow(startsAt, endsAt);

    let imageUrl = input.imageUrl ?? null;
    let newlyUploadedUrl: string | null = null;
    let uploadedVideo: UploadedMedia | null = null;

    try {
      if (file) {
        imageUrl = await this.uploadImage(file);
        newlyUploadedUrl = imageUrl;
      }
      if (videoFile) uploadedVideo = await this.uploadVideo(videoFile);
      const payload = {
        ...input,
        imageUrl,
        ...(uploadedVideo ? {
          videoUrl: uploadedVideo.url,
          videoMimeType: "video/mp4",
          videoStorageProvider: uploadedVideo.provider,
          videoStorageKey: uploadedVideo.key,
        } : {}),
        slug: normalizedSlug(input.slug ?? input.name),
        startsAt,
        endsAt,
      };
      const created = actorId ? await this.repository.create(payload, actorId) : await this.repository.create(payload);
      return input.products === undefined ? toCollectionDto(created) : this.get(created.id);
    } catch (error: unknown) {
      if (uploadedVideo) await this.cleanup(uploadedVideo.key, "[Storage] Failed to clean up newly uploaded collection video after create failure:", "video");
      if (newlyUploadedUrl) await this.cleanup(newlyUploadedUrl, "[Storage] Failed to clean up newly uploaded collection image after create failure:");
      this.map(error);
    }
  }

  async update(collectionId: string, input: UpdateCollectionInput, actorId?: string, file?: CollectionUploadFile, videoFile?: CollectionUploadFile) {
    const current = await this.repository.findById(collectionId);
    if (!current) throw new AppError(404, "Collection not found", "COLLECTION_NOT_FOUND");
    if (input.removeVideo && videoFile) {
      throw new AppError(422, "Video cannot be uploaded and removed in the same request", "COLLECTION_VIDEO_CONFLICT");
    }
    const startsAt = date(input.startsAt);
    const endsAt = date(input.endsAt);
    assertWindow(startsAt === undefined ? current.startsAt : startsAt, endsAt === undefined ? current.endsAt : endsAt);

    let imageUrl = input.imageUrl;
    let newlyUploadedUrl: string | null = null;
    let uploadedVideo: UploadedMedia | null = null;

    try {
      if (file) {
        imageUrl = await this.uploadImage(file);
        newlyUploadedUrl = imageUrl;
      }
      if (videoFile) uploadedVideo = await this.uploadVideo(videoFile);
      const { removeVideo, ...collectionInput } = input;
      const payload = {
        ...collectionInput,
        ...(input.slug !== undefined ? { slug: normalizedSlug(input.slug) } : {}),
        ...(imageUrl !== undefined ? { imageUrl } : {}),
        ...(uploadedVideo ? {
          videoUrl: uploadedVideo.url,
          videoMimeType: "video/mp4",
          videoStorageProvider: uploadedVideo.provider,
          videoStorageKey: uploadedVideo.key,
        } : removeVideo ? {
          videoUrl: null,
          videoMimeType: null,
          videoStorageProvider: null,
          videoStorageKey: null,
        } : {}),
        startsAt,
        endsAt,
      };
      const collection = actorId ? await this.repository.update(collectionId, payload, actorId) : await this.repository.update(collectionId, payload);
      if (!collection) throw new AppError(404, "Collection not found", "COLLECTION_NOT_FOUND");

      if (newlyUploadedUrl && current.imageUrl && current.imageUrl !== newlyUploadedUrl) {
        await this.cleanup(current.imageUrl, "[Storage] Failed to delete replaced collection image:");
      }
      if (uploadedVideo || removeVideo) {
        await this.deleteOwnedVideo(current.videoStorageProvider, current.videoStorageKey, "[Storage] Failed to delete replaced or removed collection video:");
      }

      return input.products === undefined ? toCollectionDto(collection) : this.get(collectionId);
    } catch (error: unknown) {
      if (uploadedVideo) await this.cleanup(uploadedVideo.key, "[Storage] Failed to clean up newly uploaded collection video after update failure:", "video");
      if (newlyUploadedUrl) await this.cleanup(newlyUploadedUrl, "[Storage] Failed to clean up newly uploaded collection image after update failure:");
      this.map(error);
    }
  }

  async replaceProducts(collectionId: string, input: ReplaceCollectionProductsInput) {
    const result = await this.repository.replaceProducts(collectionId, input);
    if (result === "COLLECTION_NOT_FOUND") throw new AppError(404, "Collection not found", "COLLECTION_NOT_FOUND");
    if (result === "PRODUCT_NOT_FOUND") throw new AppError(404, "Product not found", "PRODUCT_NOT_FOUND");
    return this.get(collectionId);
  }

  async delete(collectionId: string): Promise<void> {
    const existing = await this.repository.findById(collectionId);
    if (!existing) throw new AppError(404, "Collection not found", "COLLECTION_NOT_FOUND");

    if (!await this.repository.delete(collectionId)) {
      throw new AppError(404, "Collection not found", "COLLECTION_NOT_FOUND");
    }

    if (existing.imageUrl) {
      await this.cleanup(existing.imageUrl, "[Storage] Failed to delete collection image on deletion:");
    }
    await this.deleteOwnedVideo(existing.videoStorageProvider, existing.videoStorageKey, "[Storage] Failed to delete collection video on deletion:");
  }
}
