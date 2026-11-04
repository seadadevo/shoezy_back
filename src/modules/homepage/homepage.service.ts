import type { PrismaClient } from "@prisma/client";
import { prisma } from "../../config/database";
import { AppError } from "../../common/errors/app-error";
import {
  type CatalogLocale,
  localizedField,
  translationsByLocale,
} from "../../common/localization/catalog-localization";
import { createMediaStorage, type MediaResourceType, type MediaStorage, type UploadedMedia } from "../products/media-storage";
import { MAX_IMAGE_BYTES, MAX_VIDEO_BYTES, imageMime, isSupportedVideoBuffer } from "../products/product-media-upload.service";
import { needsTranscoding, transcodeToWebMp4 } from "../../common/utils/transcode-video";
import {
  HomepageRepository,
  HomepageRepositoryError,
  type HomepageStore,
  type PersistedBannerCreateInput,
  type PersistedBannerUpdateInput,
} from "./homepage.repository";
import type {
  BannerTranslationsInput,
  HomepageBannerAdminDto,
  HomepageBannerPlacement,
  HomepageBannerPublicDto,
  HomepageBannerRecord,
  HomepageBannerTranslationFields,
} from "./homepage.types";
import type {
  CreateHomepageBannerInput,
  ListAdminBannersQuery,
  UpdateHomepageBannerInput,
} from "./homepage.validation";

export interface HomepageUploadedFiles {
  desktopImage?: Express.Multer.File[];
  mobileImage?: Express.Multer.File[];
  desktopVideo?: Express.Multer.File[];
  mobileVideo?: Express.Multer.File[];
}

interface PendingUpload {
  keyOrUrl: string;
  resourceType: MediaResourceType;
}

export class HomepageService {
  constructor(
    private readonly repository: HomepageStore = new HomepageRepository(),
    private readonly storage: MediaStorage = createMediaStorage(),
    private readonly client: PrismaClient = prisma,
  ) {}

  private mapRepositoryError(error: unknown): never {
    if (error instanceof HomepageRepositoryError && error.code === "INVALID_DATE_RANGE") {
      throw new AppError(422, "End date must be after start date", "HOMEPAGE_BANNER_DATE_RANGE_INVALID");
    }
    throw error;
  }

  private validateImage(file: Express.Multer.File): "image/jpeg" | "image/png" | "image/webp" {
    if (file.size > MAX_IMAGE_BYTES) {
      throw new AppError(413, "Image exceeds 8 MB", "MEDIA_FILE_TOO_LARGE");
    }
    const detected = imageMime(file.buffer);
    if (!detected || detected !== file.mimetype) {
      throw new AppError(422, "Only valid JPEG, PNG, and WebP images are accepted", "MEDIA_FILE_INVALID");
    }
    return detected;
  }

  private async uploadImage(file: Express.Multer.File): Promise<string> {
    const mimetype = this.validateImage(file);
    if (!this.storage.isConfigured()) {
      throw new AppError(503, "Image storage is not configured", "MEDIA_STORAGE_NOT_CONFIGURED");
    }
    const uploaded = await this.storage.upload({ buffer: file.buffer, mimetype }, { folder: "shoozy/homepage", resourceType: "image" });
    return uploaded.url;
  }

  private async uploadVideo(file: Express.Multer.File): Promise<UploadedMedia> {
    if (file.size > MAX_VIDEO_BYTES) {
      throw new AppError(413, "Video exceeds 50 MB", "MEDIA_VIDEO_TOO_LARGE");
    }
    const mime = file.mimetype.toLowerCase();
    const isAllowedMime = mime === "video/mp4" || mime === "video/quicktime";
    if (!isAllowedMime || !isSupportedVideoBuffer(file.buffer, mime)) {
      throw new AppError(422, "Only valid MP4 and MOV videos are accepted", "MEDIA_FILE_INVALID");
    }
    if (!this.storage.isConfigured()) {
      throw new AppError(503, "Media storage is not configured", "MEDIA_STORAGE_NOT_CONFIGURED");
    }
    // Transcode MOV -> web-compatible MP4 before storage
    let uploadBuffer = file.buffer;
    let uploadMimetype = mime;
    if (needsTranscoding(mime)) {
      console.info("[Media] Transcoding banner MOV video to web-compatible MP4...");
      const transcoded = await transcodeToWebMp4(file.buffer, mime);
      uploadBuffer = transcoded.buffer;
      uploadMimetype = transcoded.mimetype;
    }
    return this.storage.upload(
      { buffer: uploadBuffer, mimetype: uploadMimetype },
      { folder: "shoozy/homepage", resourceType: "video" },
    );
  }

  private async cleanup(upload: PendingUpload, message: string): Promise<void> {
    try {
      await this.storage.delete(upload.keyOrUrl, { resourceType: upload.resourceType });
    } catch (error: unknown) {
      console.error(message, { keyOrUrl: upload.keyOrUrl, error });
    }
  }

  private async cleanupAll(uploads: PendingUpload[], message: string): Promise<void> {
    for (const upload of [...uploads].reverse()) await this.cleanup(upload, message);
  }

  private async deleteOwnedVideo(provider: string | null, key: string | null, message: string): Promise<void> {
    if (key && (provider === "LOCAL" || provider === "CLOUDINARY")) {
      await this.cleanup({ keyOrUrl: key, resourceType: "video" }, message);
    }
  }

  private async assertPromotion(promotionId?: string | null): Promise<void> {
    if (!promotionId) return;
    const promotion = await this.client.discount.findUnique({
      where: { id: promotionId },
      select: { id: true },
    });
    if (!promotion) {
      throw new AppError(404, "Promotion not found", "PROMOTION_NOT_FOUND");
    }
  }

  private validateDates(startsAt?: Date | null, endsAt?: Date | null): void {
    if (startsAt && endsAt && endsAt.getTime() <= startsAt.getTime()) {
      throw new AppError(422, "End date must be after start date", "HOMEPAGE_BANNER_DATE_RANGE_INVALID");
    }
  }

  toAdminDto(record: HomepageBannerRecord): HomepageBannerAdminDto {
    const rawTranslations = Array.isArray(record.translations)
      ? translationsByLocale(record.translations)
      : ((record.translations as unknown as Record<string, unknown>) ?? {});
    const translations: {
      en?: HomepageBannerTranslationFields;
      ar?: HomepageBannerTranslationFields;
    } = {};

    if (rawTranslations.en) {
      const en = rawTranslations.en as Record<string, unknown>;
      translations.en = {
        title: String(en.title ?? ""),
        subtitle: en.subtitle ? String(en.subtitle) : null,
        description: en.description ? String(en.description) : null,
        ctaLabel: en.ctaLabel ? String(en.ctaLabel) : null,
      };
    }
    if (rawTranslations.ar) {
      const ar = rawTranslations.ar as Record<string, unknown>;
      translations.ar = {
        title: String(ar.title ?? ""),
        subtitle: ar.subtitle ? String(ar.subtitle) : null,
        description: ar.description ? String(ar.description) : null,
        ctaLabel: ar.ctaLabel ? String(ar.ctaLabel) : null,
      };
    }

    return {
      id: record.id,
      placement: record.placement,
      ctaUrl: record.ctaUrl,
      desktopImageUrl: record.desktopImageUrl,
      mobileImageUrl: record.mobileImageUrl,
      desktopVideoUrl: record.desktopVideoUrl,
      desktopVideoMimeType: record.desktopVideoMimeType,
      mobileVideoUrl: record.mobileVideoUrl,
      mobileVideoMimeType: record.mobileVideoMimeType,
      backgroundColor: record.backgroundColor ?? null,
      textColor: record.textColor ?? null,
      sortOrder: record.sortOrder,
      isActive: record.isActive,
      startsAt: record.startsAt ? record.startsAt.toISOString() : null,
      endsAt: record.endsAt ? record.endsAt.toISOString() : null,
      promotionId: record.promotionId,
      createdAt: record.createdAt.toISOString(),
      updatedAt: record.updatedAt.toISOString(),
      translations,
      promotion: record.promotion
        ? {
            id: record.promotion.id,
            name: record.promotion.name,
            code: record.promotion.code,
            isActive: record.promotion.isActive,
          }
        : null,
    };
  }

  toPublicDto(record: HomepageBannerRecord, locale: CatalogLocale): HomepageBannerPublicDto {
    const title = localizedField(record.translations, locale, "title", "");
    const subtitle = localizedField(record.translations, locale, "subtitle", null);
    const description = localizedField(record.translations, locale, "description", null);
    const ctaLabel = localizedField(record.translations, locale, "ctaLabel", null);

    return {
      id: record.id,
      placement: record.placement,
      title,
      subtitle,
      description,
      ctaLabel,
      ctaUrl: record.ctaUrl,
      desktopImageUrl: record.desktopImageUrl,
      mobileImageUrl: record.mobileImageUrl,
      desktopVideoUrl: record.desktopVideoUrl,
      desktopVideoMimeType: record.desktopVideoMimeType,
      mobileVideoUrl: record.mobileVideoUrl,
      mobileVideoMimeType: record.mobileVideoMimeType,
      backgroundColor: record.backgroundColor ?? null,
      textColor: record.textColor ?? null,
      isActive: record.isActive,
      sortOrder: record.sortOrder,
      startsAt: record.startsAt ? record.startsAt.toISOString() : null,
      endsAt: record.endsAt ? record.endsAt.toISOString() : null,
      promotionId: record.promotionId,
      promotion: record.promotion
        ? {
            id: record.promotion.id,
            name: record.promotion.name,
            code: record.promotion.code,
          }
        : null,
    };
  }

  async listPublic(placement?: HomepageBannerPlacement, locale: CatalogLocale = "en"): Promise<HomepageBannerPublicDto[]> {
    const records = await this.repository.listPublic(placement, new Date());
    return records.map((record) => this.toPublicDto(record, locale));
  }

  async listAdmin(query: ListAdminBannersQuery) {
    const result = await this.repository.listAdmin(query);
    return {
      items: result.items.map((item) => this.toAdminDto(item)),
      pagination: {
        page: query.page,
        limit: query.limit,
        total: result.total,
        totalPages: Math.ceil(result.total / query.limit),
      },
    };
  }

  async getAdmin(id: string): Promise<HomepageBannerAdminDto> {
    const record = await this.repository.findById(id);
    if (!record) throw new AppError(404, "Homepage banner not found", "HOMEPAGE_BANNER_NOT_FOUND");
    return this.toAdminDto(record);
  }

  async create(input: CreateHomepageBannerInput, files?: HomepageUploadedFiles): Promise<HomepageBannerAdminDto> {
    await this.assertPromotion(input.promotionId);

    const startsAt = input.startsAt ? new Date(input.startsAt) : null;
    const endsAt = input.endsAt ? new Date(input.endsAt) : null;
    this.validateDates(startsAt, endsAt);

    let desktopImageUrl = input.desktopImageUrl ?? null;
    let mobileImageUrl = input.mobileImageUrl ?? null;
    let desktopVideo: UploadedMedia | null = null;
    let mobileVideo: UploadedMedia | null = null;
    const newUploads: PendingUpload[] = [];

    try {
      if (files?.desktopImage?.[0]) {
        desktopImageUrl = await this.uploadImage(files.desktopImage[0]);
        newUploads.push({ keyOrUrl: desktopImageUrl, resourceType: "image" });
      }
      if (files?.mobileImage?.[0]) {
        mobileImageUrl = await this.uploadImage(files.mobileImage[0]);
        newUploads.push({ keyOrUrl: mobileImageUrl, resourceType: "image" });
      }
      if (files?.desktopVideo?.[0]) {
        desktopVideo = await this.uploadVideo(files.desktopVideo[0]);
        newUploads.push({ keyOrUrl: desktopVideo.key, resourceType: "video" });
      }
      if (files?.mobileVideo?.[0]) {
        mobileVideo = await this.uploadVideo(files.mobileVideo[0]);
        newUploads.push({ keyOrUrl: mobileVideo.key, resourceType: "video" });
      }

      const repoInput: PersistedBannerCreateInput = {
        placement: input.placement,
        ctaUrl: input.ctaUrl ?? null,
        desktopImageUrl,
        mobileImageUrl,
        desktopVideoUrl: desktopVideo?.url ?? null,
        desktopVideoMimeType: desktopVideo ? (files?.desktopVideo?.[0]?.mimetype?.toLowerCase() === "video/quicktime" ? "video/quicktime" : "video/mp4") : null,
        desktopVideoStorageProvider: desktopVideo?.provider ?? null,
        desktopVideoStorageKey: desktopVideo?.key ?? null,
        mobileVideoUrl: mobileVideo?.url ?? null,
        mobileVideoMimeType: mobileVideo ? (files?.mobileVideo?.[0]?.mimetype?.toLowerCase() === "video/quicktime" ? "video/quicktime" : "video/mp4") : null,
        mobileVideoStorageProvider: mobileVideo?.provider ?? null,
        mobileVideoStorageKey: mobileVideo?.key ?? null,
        backgroundColor: input.backgroundColor ?? null,
        textColor: input.textColor ?? null,
        sortOrder: input.sortOrder ?? 0,
        isActive: input.isActive ?? true,
        startsAt,
        endsAt,
        promotionId: input.promotionId ?? null,
        translations: input.translations as BannerTranslationsInput,
      };
      const created = await this.repository.create(repoInput);
      return this.toAdminDto(created);
    } catch (error: unknown) {
      await this.cleanupAll(newUploads, "[Storage] Failed to clean up newly uploaded banner media after create failure:");
      this.mapRepositoryError(error);
    }
  }

  async update(id: string, input: UpdateHomepageBannerInput, files?: HomepageUploadedFiles): Promise<HomepageBannerAdminDto> {
    const existing = await this.repository.findById(id);
    if (!existing) throw new AppError(404, "Homepage banner not found", "HOMEPAGE_BANNER_NOT_FOUND");
    if (input.removeDesktopVideo && files?.desktopVideo?.[0]) {
      throw new AppError(422, "Desktop video cannot be uploaded and removed in the same request", "HOMEPAGE_DESKTOP_VIDEO_CONFLICT");
    }
    if (input.removeMobileVideo && files?.mobileVideo?.[0]) {
      throw new AppError(422, "Mobile video cannot be uploaded and removed in the same request", "HOMEPAGE_MOBILE_VIDEO_CONFLICT");
    }

    if (input.promotionId !== undefined) {
      await this.assertPromotion(input.promotionId);
    }

    const startsAt = input.startsAt !== undefined ? (input.startsAt ? new Date(input.startsAt) : null) : existing.startsAt;
    const endsAt = input.endsAt !== undefined ? (input.endsAt ? new Date(input.endsAt) : null) : existing.endsAt;
    this.validateDates(startsAt, endsAt);

    let desktopImageUrl = input.desktopImageUrl;
    let mobileImageUrl = input.mobileImageUrl;
    let desktopVideo: UploadedMedia | null = null;
    let mobileVideo: UploadedMedia | null = null;
    const newUploads: PendingUpload[] = [];

    try {
      if (files?.desktopImage?.[0]) {
        desktopImageUrl = await this.uploadImage(files.desktopImage[0]);
        newUploads.push({ keyOrUrl: desktopImageUrl, resourceType: "image" });
      }
      if (files?.mobileImage?.[0]) {
        mobileImageUrl = await this.uploadImage(files.mobileImage[0]);
        newUploads.push({ keyOrUrl: mobileImageUrl, resourceType: "image" });
      }
      if (files?.desktopVideo?.[0]) {
        desktopVideo = await this.uploadVideo(files.desktopVideo[0]);
        newUploads.push({ keyOrUrl: desktopVideo.key, resourceType: "video" });
      }
      if (files?.mobileVideo?.[0]) {
        mobileVideo = await this.uploadVideo(files.mobileVideo[0]);
        newUploads.push({ keyOrUrl: mobileVideo.key, resourceType: "video" });
      }

      const repoInput: PersistedBannerUpdateInput = {
        ...(input.placement ? { placement: input.placement } : {}),
        ...(input.backgroundColor !== undefined ? { backgroundColor: input.backgroundColor } : {}),
        ...(input.textColor !== undefined ? { textColor: input.textColor } : {}),
        ...(input.ctaUrl !== undefined ? { ctaUrl: input.ctaUrl } : {}),
        ...(desktopImageUrl !== undefined ? { desktopImageUrl } : {}),
        ...(mobileImageUrl !== undefined ? { mobileImageUrl } : {}),
        ...(desktopVideo ? {
          desktopVideoUrl: desktopVideo.url,
          desktopVideoMimeType: files?.desktopVideo?.[0]?.mimetype?.toLowerCase() === "video/quicktime" ? "video/quicktime" : "video/mp4",
          desktopVideoStorageProvider: desktopVideo.provider,
          desktopVideoStorageKey: desktopVideo.key,
        } : input.removeDesktopVideo ? {
          desktopVideoUrl: null,
          desktopVideoMimeType: null,
          desktopVideoStorageProvider: null,
          desktopVideoStorageKey: null,
        } : {}),
        ...(mobileVideo ? {
          mobileVideoUrl: mobileVideo.url,
          mobileVideoMimeType: files?.mobileVideo?.[0]?.mimetype?.toLowerCase() === "video/quicktime" ? "video/quicktime" : "video/mp4",
          mobileVideoStorageProvider: mobileVideo.provider,
          mobileVideoStorageKey: mobileVideo.key,
        } : input.removeMobileVideo ? {
          mobileVideoUrl: null,
          mobileVideoMimeType: null,
          mobileVideoStorageProvider: null,
          mobileVideoStorageKey: null,
        } : {}),
        ...(input.sortOrder !== undefined ? { sortOrder: input.sortOrder } : {}),
        ...(input.isActive !== undefined ? { isActive: input.isActive } : {}),
        ...(input.startsAt !== undefined ? { startsAt: input.startsAt ? new Date(input.startsAt) : null } : {}),
        ...(input.endsAt !== undefined ? { endsAt: input.endsAt ? new Date(input.endsAt) : null } : {}),
        ...(input.promotionId !== undefined ? { promotionId: input.promotionId } : {}),
        ...(input.translations ? { translations: input.translations as BannerTranslationsInput } : {}),
      };
      const updated = await this.repository.update(id, repoInput);
      if (!updated) throw new AppError(404, "Homepage banner not found", "HOMEPAGE_BANNER_NOT_FOUND");

      // On successful update, clean up replaced images if new files were uploaded
      if (files?.desktopImage?.[0] && existing.desktopImageUrl && existing.desktopImageUrl !== desktopImageUrl) {
        try {
          await this.storage.delete(existing.desktopImageUrl);
        } catch (err) {
          console.error("[Storage] Failed to delete replaced desktop banner image:", { url: existing.desktopImageUrl, error: err });
        }
      }
      if (files?.mobileImage?.[0] && existing.mobileImageUrl && existing.mobileImageUrl !== mobileImageUrl) {
        try {
          await this.storage.delete(existing.mobileImageUrl);
        } catch (err) {
          console.error("[Storage] Failed to delete replaced mobile banner image:", { url: existing.mobileImageUrl, error: err });
        }
      }
      if (desktopVideo || input.removeDesktopVideo) {
        await this.deleteOwnedVideo(existing.desktopVideoStorageProvider, existing.desktopVideoStorageKey, "[Storage] Failed to delete replaced or removed desktop banner video:");
      }
      if (mobileVideo || input.removeMobileVideo) {
        await this.deleteOwnedVideo(existing.mobileVideoStorageProvider, existing.mobileVideoStorageKey, "[Storage] Failed to delete replaced or removed mobile banner video:");
      }

      return this.toAdminDto(updated);
    } catch (error: unknown) {
      await this.cleanupAll(newUploads, "[Storage] Failed to clean up newly uploaded banner media after update failure:");
      this.mapRepositoryError(error);
    }
  }

  async delete(id: string): Promise<void> {
    const existing = await this.repository.findById(id);
    if (!existing) throw new AppError(404, "Homepage banner not found", "HOMEPAGE_BANNER_NOT_FOUND");
    await this.repository.delete(id);

    if (existing.desktopImageUrl) {
      try {
        await this.storage.delete(existing.desktopImageUrl);
      } catch (err) {
        console.error("[Storage] Failed to delete banner desktop image on deletion:", { url: existing.desktopImageUrl, error: err });
      }
    }
    if (existing.mobileImageUrl) {
      try {
        await this.storage.delete(existing.mobileImageUrl);
      } catch (err) {
        console.error("[Storage] Failed to delete banner mobile image on deletion:", { url: existing.mobileImageUrl, error: err });
      }
    }
    await this.deleteOwnedVideo(existing.desktopVideoStorageProvider, existing.desktopVideoStorageKey, "[Storage] Failed to delete banner desktop video on deletion:");
    await this.deleteOwnedVideo(existing.mobileVideoStorageProvider, existing.mobileVideoStorageKey, "[Storage] Failed to delete banner mobile video on deletion:");
  }

  async toggleActive(id: string, isActive: boolean): Promise<HomepageBannerAdminDto> {
    const updated = await this.repository.toggleActive(id, isActive);
    if (!updated) throw new AppError(404, "Homepage banner not found", "HOMEPAGE_BANNER_NOT_FOUND");
    return this.toAdminDto(updated);
  }
}
