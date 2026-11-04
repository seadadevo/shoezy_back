import { AppError } from "../../common/errors/app-error";
import { normalizeSlug } from "../../common/utils/slug";
import { toCategoryDto, toCategoryTree } from "./categories.dto";
import { CategoriesRepository, CategoriesRepositoryError } from "./categories.repository";
import type { CreateCategoryInput, ListCategoriesQuery, UpdateCategoryInput } from "./categories.validation";
import { createMediaStorage, type MediaStorage, type UploadedMedia } from "../products/media-storage";
import { MAX_IMAGE_BYTES, MAX_VIDEO_BYTES, imageMime, isMp4Buffer } from "../products/product-media-upload.service";

export type CategoryUploadFile = Express.Multer.File | { buffer: Buffer; mimetype: string; size: number; originalname?: string };

export interface CategoriesStore {
  list: CategoriesRepository["list"];
  listAll: CategoriesRepository["listAll"];
  listParentLinks: CategoriesRepository["listParentLinks"];
  findById: CategoriesRepository["findById"];
  create: CategoriesRepository["create"];
  update: CategoriesRepository["update"];
  deleteIfUnused: CategoriesRepository["deleteIfUnused"];
}
function categorySlug(value: string) {
  const slug = normalizeSlug(value);
  if (!slug || slug.length > 180) throw new AppError(422, "Category slug is invalid", "CATEGORY_SLUG_INVALID");
  return slug;
}
export class CategoriesService {
  constructor(
    private readonly repository: CategoriesStore = new CategoriesRepository(),
    private readonly storage: MediaStorage = createMediaStorage(),
  ) {}

  private validateImage(file: CategoryUploadFile): "image/jpeg" | "image/png" | "image/webp" {
    if (file.size > MAX_IMAGE_BYTES) {
      throw new AppError(413, "Image exceeds 8 MB", "MEDIA_FILE_TOO_LARGE");
    }
    const detected = imageMime(file.buffer);
    if (!detected || detected !== file.mimetype) {
      throw new AppError(422, "Only valid JPEG, PNG, and WebP images are accepted", "MEDIA_FILE_INVALID");
    }
    return detected;
  }

  private async uploadImage(file: CategoryUploadFile): Promise<string> {
    const mimetype = this.validateImage(file);
    if (!this.storage.isConfigured()) {
      throw new AppError(503, "Image storage is not configured", "MEDIA_STORAGE_NOT_CONFIGURED");
    }
    const uploaded = await this.storage.upload(
      { buffer: file.buffer, mimetype },
      { folder: "shoozy/categories" },
    );
    return uploaded.url;
  }

  private async uploadVideo(file: CategoryUploadFile): Promise<UploadedMedia> {
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
      { folder: "shoozy/categories", resourceType: "video" },
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

  private mapError(error: unknown): never {
    if (error instanceof CategoriesRepositoryError) throw new AppError(409, "A category already uses this slug", "CATEGORY_SLUG_ALREADY_EXISTS");
    throw error;
  }
  private async assertParent(categoryId: string | null, parentId: string | null | undefined) {
    if (!parentId) return;
    if (parentId === categoryId) throw new AppError(400, "Category cannot be its own parent", "CATEGORY_PARENT_INVALID");
    const links = await this.repository.listParentLinks();
    const parents = new Map(links.map((link) => [link.id, link.parentId]));
    if (!parents.has(parentId)) throw new AppError(404, "Parent category not found", "CATEGORY_PARENT_NOT_FOUND");
    const visited = new Set<string>();
    let cursor: string | null | undefined = parentId;
    while (cursor) {
      if (cursor === categoryId) throw new AppError(400, "Category parent would create a cycle", "CATEGORY_CYCLE");
      if (visited.has(cursor)) throw new AppError(400, "Category tree is already cyclic", "CATEGORY_TREE_INVALID");
      visited.add(cursor);
      cursor = parents.get(cursor);
    }
  }
  async list(query: ListCategoriesQuery) {
    const result = await this.repository.list(query);
    return { items: result.items.map(toCategoryDto), pagination: { page: query.page, limit: query.limit, total: result.total, totalPages: Math.ceil(result.total / query.limit) } };
  }
  async tree() { return toCategoryTree(await this.repository.listAll()); }
  async get(categoryId: string) {
    const category = await this.repository.findById(categoryId);
    if (!category) throw new AppError(404, "Category not found", "CATEGORY_NOT_FOUND");
    return toCategoryDto(category);
  }
  async create(input: CreateCategoryInput, file?: CategoryUploadFile, videoFile?: CategoryUploadFile) {
    await this.assertParent(null, input.parentId);

    let imageUrl = input.imageUrl ?? null;
    let newlyUploadedUrl: string | null = null;
    let uploadedVideo: UploadedMedia | null = null;

    try {
      if (file) {
        imageUrl = await this.uploadImage(file);
        newlyUploadedUrl = imageUrl;
      }
      if (videoFile) uploadedVideo = await this.uploadVideo(videoFile);

      return toCategoryDto(
        await this.repository.create({
          ...input,
          ...(imageUrl !== undefined ? { imageUrl } : {}),
          ...(uploadedVideo ? {
            videoUrl: uploadedVideo.url,
            videoMimeType: "video/mp4",
            videoStorageProvider: uploadedVideo.provider,
            videoStorageKey: uploadedVideo.key,
          } : {}),
          slug: categorySlug(input.slug ?? input.name),
        }),
      );
    } catch (error: unknown) {
      if (uploadedVideo) await this.cleanup(uploadedVideo.key, "[Storage] Failed to clean up newly uploaded category video after create failure:", "video");
      if (newlyUploadedUrl) await this.cleanup(newlyUploadedUrl, "[Storage] Failed to clean up newly uploaded category image after create failure:");
      this.mapError(error);
    }
  }
  async update(categoryId: string, input: UpdateCategoryInput, file?: CategoryUploadFile, videoFile?: CategoryUploadFile) {
    const current = await this.repository.findById(categoryId);
    if (!current) throw new AppError(404, "Category not found", "CATEGORY_NOT_FOUND");
    if (input.removeVideo && videoFile) {
      throw new AppError(422, "Video cannot be uploaded and removed in the same request", "CATEGORY_VIDEO_CONFLICT");
    }

    let imageUrl = input.imageUrl;
    let newlyUploadedUrl: string | null = null;
    let uploadedVideo: UploadedMedia | null = null;

    try {
      if (file) {
        imageUrl = await this.uploadImage(file);
        newlyUploadedUrl = imageUrl;
      }
      if (videoFile) uploadedVideo = await this.uploadVideo(videoFile);
      const { removeVideo, ...categoryInput } = input;
      const category = await this.repository.update(categoryId, {
        ...categoryInput,
        ...(input.slug !== undefined ? { slug: categorySlug(input.slug) } : {}),
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
      });
      if (category === "NOT_FOUND") throw new AppError(404, "Category not found", "CATEGORY_NOT_FOUND");
      if (category === "PARENT_NOT_FOUND") throw new AppError(404, "Parent category not found", "CATEGORY_PARENT_NOT_FOUND");
      if (category === "SELF_PARENT") throw new AppError(400, "Category cannot be its own parent", "CATEGORY_PARENT_INVALID");
      if (category === "CYCLE") throw new AppError(400, "Category parent would create a cycle", "CATEGORY_CYCLE");
      if (category === "TREE_INVALID") throw new AppError(400, "Category tree is already cyclic", "CATEGORY_TREE_INVALID");
      if (category === "WOULD_INVALIDATE_PRODUCT") throw new AppError(409, "Active products depend on this category", "PRODUCT_WOULD_BECOME_INVALID");

      if (newlyUploadedUrl && current.imageUrl && current.imageUrl !== newlyUploadedUrl) {
        await this.cleanup(current.imageUrl, "[Storage] Failed to delete replaced category image:");
      }
      if (uploadedVideo || removeVideo) {
        await this.deleteOwnedVideo(current.videoStorageProvider, current.videoStorageKey, "[Storage] Failed to delete replaced or removed category video:");
      }

      return toCategoryDto(category);
    } catch (error: unknown) {
      if (uploadedVideo) await this.cleanup(uploadedVideo.key, "[Storage] Failed to clean up newly uploaded category video after update failure:", "video");
      if (newlyUploadedUrl) await this.cleanup(newlyUploadedUrl, "[Storage] Failed to clean up newly uploaded category image after update failure:");
      this.mapError(error);
    }
  }
  async delete(categoryId: string): Promise<void> {
    const existing = await this.repository.findById(categoryId);
    if (!existing) throw new AppError(404, "Category not found", "CATEGORY_NOT_FOUND");

    const result = await this.repository.deleteIfUnused(categoryId);
    if (result === "NOT_FOUND") throw new AppError(404, "Category not found", "CATEGORY_NOT_FOUND");
    if (result === "HAS_CHILDREN") throw new AppError(409, "Category has children", "CATEGORY_HAS_CHILDREN");
    if (result === "IN_USE") throw new AppError(409, "Category is in use", "CATEGORY_IN_USE");

    if (existing.imageUrl) {
      await this.cleanup(existing.imageUrl, "[Storage] Failed to delete category image on deletion:");
    }
    await this.deleteOwnedVideo(existing.videoStorageProvider, existing.videoStorageKey, "[Storage] Failed to delete category video on deletion:");
  }
}
