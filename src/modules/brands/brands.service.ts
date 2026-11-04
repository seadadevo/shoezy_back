import { AppError } from "../../common/errors/app-error";
import { normalizeSlug } from "../../common/utils/slug";
import { toBrandDto } from "./brands.dto";
import { BrandsRepository, BrandsRepositoryError } from "./brands.repository";
import type { CreateBrandInput, ListBrandsQuery, UpdateBrandInput } from "./brands.validation";
import { createMediaStorage, type MediaStorage } from "../products/media-storage";
import { MAX_IMAGE_BYTES, imageMime } from "../products/product-media-upload.service";

export type BrandUploadFile = Express.Multer.File | { buffer: Buffer; mimetype: string; size: number; originalname?: string };

export interface BrandsStore {
  list: BrandsRepository["list"];
  findById: BrandsRepository["findById"];
  create: BrandsRepository["create"];
  update: BrandsRepository["update"];
  deleteIfUnused: BrandsRepository["deleteIfUnused"];
}

function slugFor(value: string): string {
  const slug = normalizeSlug(value);
  if (!slug) throw new AppError(422, "Slug must contain usable characters", "BRAND_SLUG_INVALID");
  if (slug.length > 180) throw new AppError(422, "Normalized slug is too long", "BRAND_SLUG_INVALID");
  return slug;
}

export class BrandsService {
  constructor(
    private readonly repository: BrandsStore = new BrandsRepository(),
    private readonly storage: MediaStorage = createMediaStorage(),
  ) {}

  private validateFile(file: BrandUploadFile): "image/jpeg" | "image/png" | "image/webp" {
    if (file.size > MAX_IMAGE_BYTES) {
      throw new AppError(413, "Image exceeds 8 MB", "MEDIA_FILE_TOO_LARGE");
    }
    const detected = imageMime(file.buffer);
    if (!detected || detected !== file.mimetype) {
      throw new AppError(422, "Only valid JPEG, PNG, and WebP images are accepted", "MEDIA_FILE_INVALID");
    }
    return detected;
  }

  private async uploadImage(file: BrandUploadFile): Promise<string> {
    const mimetype = this.validateFile(file);
    if (!this.storage.isConfigured()) {
      throw new AppError(503, "Image storage is not configured", "MEDIA_STORAGE_NOT_CONFIGURED");
    }
    const uploaded = await this.storage.upload(
      { buffer: file.buffer, mimetype },
      { folder: "shoozy/brands" },
    );
    return uploaded.url;
  }

  private mapError(error: unknown): never {
    if (error instanceof BrandsRepositoryError) {
      throw new AppError(409, "A brand already uses this slug", "BRAND_SLUG_ALREADY_EXISTS");
    }
    throw error;
  }

  private async deleteMedia(url: string, context: string): Promise<void> {
    try {
      await this.storage.delete(url);
    } catch (error) {
      console.error(`[Storage] Failed to ${context}:`, { url, error });
    }
  }

  private async cleanupUploads(urls: string[], context: string): Promise<void> {
    await Promise.all([...new Set(urls)].map((url) => this.deleteMedia(url, context)));
  }

  async list(query: ListBrandsQuery) {
    const result = await this.repository.list(query);
    return {
      items: result.items.map(toBrandDto),
      pagination: {
        page: query.page,
        limit: query.limit,
        total: result.total,
        totalPages: Math.ceil(result.total / query.limit),
      },
    };
  }

  async get(brandId: string) {
    const brand = await this.repository.findById(brandId);
    if (!brand) throw new AppError(404, "Brand not found", "BRAND_NOT_FOUND");
    return toBrandDto(brand);
  }

  async create(input: CreateBrandInput, file?: BrandUploadFile, showcaseFile?: BrandUploadFile) {
    let logoUrl = input.logoUrl ?? null;
    let showcaseImageUrl = input.showcaseImageUrl ?? null;
    const newlyUploadedUrls: string[] = [];

    try {
      if (file) {
        logoUrl = await this.uploadImage(file);
        newlyUploadedUrls.push(logoUrl);
      }
      if (showcaseFile) {
        showcaseImageUrl = await this.uploadImage(showcaseFile);
        newlyUploadedUrls.push(showcaseImageUrl);
      }
      const brand = await this.repository.create({
        ...input,
        ...(logoUrl !== undefined ? { logoUrl } : {}),
        ...(showcaseImageUrl !== undefined ? { showcaseImageUrl } : {}),
        slug: slugFor(input.slug ?? input.name),
      });
      return toBrandDto(brand);
    } catch (error: unknown) {
      await this.cleanupUploads(newlyUploadedUrls, "clean up newly uploaded brand image after DB creation failure");
      this.mapError(error);
    }
  }

  async update(brandId: string, input: UpdateBrandInput, file?: BrandUploadFile, showcaseFile?: BrandUploadFile) {
    const current = await this.repository.findById(brandId);
    if (!current) throw new AppError(404, "Brand not found", "BRAND_NOT_FOUND");
    if (input.removeShowcaseImage && (showcaseFile || input.showcaseImageUrl !== undefined)) {
      throw new AppError(422, "Showcase image cannot be uploaded or set and removed in the same request", "BRAND_SHOWCASE_IMAGE_CONFLICT");
    }

    let logoUrl = input.logoUrl;
    let showcaseImageUrl = input.showcaseImageUrl;
    const newlyUploadedUrls: string[] = [];

    try {
      if (file) {
        logoUrl = await this.uploadImage(file);
        newlyUploadedUrls.push(logoUrl);
      }
      if (showcaseFile) {
        showcaseImageUrl = await this.uploadImage(showcaseFile);
        newlyUploadedUrls.push(showcaseImageUrl);
      }
      const { removeShowcaseImage, ...brandInput } = input;
      const brand = await this.repository.update(brandId, {
        ...brandInput,
        ...(input.slug !== undefined ? { slug: slugFor(input.slug) } : {}),
        ...(logoUrl !== undefined ? { logoUrl } : {}),
        ...(showcaseImageUrl !== undefined ? { showcaseImageUrl } : removeShowcaseImage ? { showcaseImageUrl: null } : {}),
      });
      if (brand === "NOT_FOUND") throw new AppError(404, "Brand not found", "BRAND_NOT_FOUND");
      if (brand === "WOULD_INVALIDATE_PRODUCT") throw new AppError(409, "Active products depend on this brand", "PRODUCT_WOULD_BECOME_INVALID");

      if (file && current.logoUrl && current.logoUrl !== logoUrl) {
        await this.deleteMedia(current.logoUrl, "delete replaced brand logo");
      }
      if ((showcaseImageUrl !== undefined || removeShowcaseImage) && current.showcaseImageUrl && current.showcaseImageUrl !== showcaseImageUrl) {
        await this.deleteMedia(current.showcaseImageUrl, "delete replaced brand showcase image");
      }

      return toBrandDto(brand);
    } catch (error: unknown) {
      await this.cleanupUploads(newlyUploadedUrls, "clean up newly uploaded brand image after DB update failure");
      this.mapError(error);
    }
  }

  async delete(brandId: string): Promise<void> {
    const existing = await this.repository.findById(brandId);
    if (!existing) throw new AppError(404, "Brand not found", "BRAND_NOT_FOUND");

    const result = await this.repository.deleteIfUnused(brandId);
    if (result === "NOT_FOUND") throw new AppError(404, "Brand not found", "BRAND_NOT_FOUND");
    if (result === "IN_USE") throw new AppError(409, "Brand is in use", "BRAND_IN_USE");

    await this.cleanupUploads(
      [existing.logoUrl, existing.showcaseImageUrl].filter((url): url is string => Boolean(url)),
      "delete brand image on deletion",
    );
  }
}
