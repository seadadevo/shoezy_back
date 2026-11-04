import { AppError } from "../../common/errors/app-error";
import { createMediaStorage, type MediaStorage } from "./media-storage";
import { ProductMediaService } from "./product-media.service";
import { ProductMediaRepository } from "./product-media.repository";
import type { UploadProductMediaInput } from "./product-media-upload.validation";
import { needsTranscoding, transcodeToWebMp4 } from "../../common/utils/transcode-video";

export const MAX_IMAGE_BYTES = 8 * 1024 * 1024;
export const MAX_VIDEO_BYTES = 50 * 1024 * 1024;

export function imageMime(buffer: Buffer): "image/jpeg" | "image/png" | "image/webp" | null {
  if (buffer.length >= 3 && buffer[0] === 0xff && buffer[1] === 0xd8 && buffer[2] === 0xff) return "image/jpeg";
  if (buffer.length >= 8 && buffer.subarray(0, 8).equals(Buffer.from([137, 80, 78, 71, 13, 10, 26, 10]))) return "image/png";
  if (buffer.length >= 12 && buffer.toString("ascii", 0, 4) === "RIFF" && buffer.toString("ascii", 8, 12) === "WEBP") return "image/webp";
  return null;
}


export function isMovBuffer(buffer: Buffer): boolean {
  if (buffer.length < 8) return false;
  if (buffer.length >= 12 && buffer.toString("ascii", 4, 8) === "ftyp") {
    const boxLength = buffer.readUInt32BE(0);
    if (boxLength >= 8) {
      const majorBrand = buffer.toString("ascii", 8, 12);
      if (majorBrand === "qt  ") return true;
      const scanLimit = Math.min(boxLength, buffer.length);
      for (let offset = 16; offset + 4 <= scanLimit; offset += 4) {
        if (buffer.toString("ascii", offset, offset + 4) === "qt  ") return true;
      }
    }
  }
  const atomType = buffer.toString("ascii", 4, 8);
  return ["moov", "mdat", "wide", "free", "skip"].includes(atomType);
}

export function isSupportedVideoBuffer(buffer: Buffer, mimetype?: string): boolean {
  const mime = mimetype?.toLowerCase();
  if (mime === "video/quicktime") {
    return isMovBuffer(buffer) || isMp4Buffer(buffer);
  }
  if (mime === "video/mp4") {
    return isMp4Buffer(buffer);
  }
  return isMp4Buffer(buffer) || isMovBuffer(buffer);
}

export function isMp4Buffer(buffer: Buffer): boolean {
  if (buffer.length < 12) return false;
  if (buffer.toString("ascii", 4, 8) !== "ftyp") return false;
  const boxLength = buffer.readUInt32BE(0);
  if (boxLength < 8) return false;
  const majorBrand = buffer.toString("ascii", 8, 12);
  const mp4Brands = new Set([
    "isom", "iso2", "mp41", "mp42", "avc1", "M4V ", "qt  ", "dash"
  ]);
  if (mp4Brands.has(majorBrand)) return true;
  const scanLimit = Math.min(boxLength, buffer.length);
  for (let offset = 16; offset + 4 <= scanLimit; offset += 4) {
    const brand = buffer.toString("ascii", offset, offset + 4);
    if (mp4Brands.has(brand)) return true;
  }
  return false;
}

export function detectMediaMime(buffer: Buffer): { type: "IMAGE" | "VIDEO"; mimetype: string } | null {
  const image = imageMime(buffer);
  if (image) return { type: "IMAGE", mimetype: image };
  if (isMp4Buffer(buffer)) return { type: "VIDEO", mimetype: "video/mp4" };
  // Also accept MOV buffers — they will be transcoded to mp4 before storage
  if (isMovBuffer(buffer)) return { type: "VIDEO", mimetype: "video/quicktime" };
  return null;
}

export class ProductMediaUploadService {
  constructor(
    private readonly repository = new ProductMediaRepository(),
    private readonly media = new ProductMediaService(repository),
    private readonly storage: MediaStorage = createMediaStorage(),
  ) {}

  async upload(
    productId: string,
    input: UploadProductMediaInput,
    file?: { buffer: Buffer; mimetype: string; size: number },
  ) {
    if (!file) throw new AppError(422, "A media file is required", "MEDIA_FILE_REQUIRED");

    const detected = detectMediaMime(file.buffer);
    if (!detected) {
      throw new AppError(422, "Only valid JPEG, PNG, WebP images or MP4/MOV videos are accepted", "MEDIA_FILE_INVALID");
    }

    // Accept both declared mp4 and quicktime for video uploads
    const declaredMime = file.mimetype.toLowerCase();
    const isVideoMime = declaredMime === "video/mp4" || declaredMime === "video/quicktime";
    const isImageMime = detected.type === "IMAGE";
    if (!isImageMime && !isVideoMime) {
      throw new AppError(422, "Only valid JPEG, PNG, WebP images or MP4/MOV videos are accepted", "MEDIA_FILE_INVALID");
    }
    if (isImageMime && detected.mimetype !== declaredMime) {
      throw new AppError(422, "Only valid JPEG, PNG, WebP images or MP4/MOV videos are accepted", "MEDIA_FILE_INVALID");
    }

    const mediaType = input.mediaType ?? detected.type;
    if (mediaType !== detected.type) {
      throw new AppError(
        422,
        `Declared mediaType '${input.mediaType}' does not match uploaded file type '${detected.type}'`,
        "MEDIA_TYPE_MISMATCH",
      );
    }

    if (mediaType === "IMAGE") {
      if (file.size > MAX_IMAGE_BYTES) throw new AppError(413, "Image exceeds 8 MB", "MEDIA_FILE_TOO_LARGE");
    } else {
      if (file.size > MAX_VIDEO_BYTES) throw new AppError(413, "Video exceeds 50 MB", "MEDIA_VIDEO_TOO_LARGE");
      if (input.isPrimary === true) {
        throw new AppError(422, "Video media cannot be used as the product primary cover", "MEDIA_VIDEO_CANNOT_BE_PRIMARY");
      }
    }

    const target = await this.repository.validateUploadTarget(productId, input.variantId);
    if (target === "PRODUCT_NOT_FOUND") throw new AppError(404, "Product not found", "PRODUCT_NOT_FOUND");
    if (target === "VARIANT_NOT_FOUND") throw new AppError(404, "Product variant not found", "PRODUCT_VARIANT_NOT_FOUND");

    if (!this.storage.isConfigured()) throw new AppError(503, "Media storage is not configured", "MEDIA_STORAGE_NOT_CONFIGURED");

    // Transcode MOV → web-compatible MP4 before storage
    let uploadBuffer = file.buffer;
    let uploadMimetype = detected.mimetype;
    if (mediaType === "VIDEO" && needsTranscoding(detected.mimetype)) {
      console.info("[Media] Transcoding MOV video to web-compatible MP4...");
      const transcoded = await transcodeToWebMp4(file.buffer, detected.mimetype);
      uploadBuffer = transcoded.buffer;
      uploadMimetype = transcoded.mimetype;
    }

    if (mediaType === "VIDEO") {
      const existingVideo = await this.media.findVideo(productId);
      if (existingVideo && !input.replaceVideo) {
        throw new AppError(409, "Product already has a video", "MEDIA_VIDEO_LIMIT_EXCEEDED");
      }
      if (existingVideo && input.replaceVideo) {
        // Safe replacement sequence:
        // 1. Upload new video
        const uploaded = await this.storage.upload(
          { buffer: uploadBuffer, mimetype: uploadMimetype },
          { folder: "products/videos", resourceType: "video" },
        );
        // 2. Update DB reference
        try {
          const updated = await this.media.update(productId, existingVideo.id, {
            type: "VIDEO",
            mediaType: "VIDEO",
            url: uploaded.url,
            storageProvider: uploaded.provider,
            storageKey: uploaded.key,
            mimeType: "video/mp4",
            altText: input.altText,
            position: input.position,
            isPrimary: false,
          });
          // 3. After DB success: delete previous owned local video
          if (
            existingVideo.storageKey &&
            (existingVideo.storageProvider === "LOCAL" || existingVideo.storageProvider === "CLOUDINARY")
          ) {
            await this.storage.delete(existingVideo.storageKey, { resourceType: "video" }).catch(() => {});
          }
          return updated;
        } catch (error: unknown) {
          // 4. If DB update fails: delete new video and preserve old video
          await this.storage.delete(uploaded.key, { resourceType: "video" }).catch(() => {});
          throw error;
        }
      }
    }

    const folder = mediaType === "VIDEO" ? "products/videos" : "products";
    const uploaded = await this.storage.upload(
      { buffer: uploadBuffer, mimetype: uploadMimetype },
      { folder, resourceType: mediaType === "VIDEO" ? "video" : "image" },
    );

    try {
      return await this.media.create(productId, {
        type: mediaType,
        mediaType,
        mimeType: uploadMimetype,
        url: uploaded.url,
        variantId: input.variantId,
        altText: input.altText,
        position: input.position,
        isPrimary: mediaType === "VIDEO" ? false : input.isPrimary,
        storageProvider: uploaded.provider,
        storageKey: uploaded.key,
      });
    } catch (error: unknown) {
      try {
        await this.storage.delete(uploaded.key, { resourceType: mediaType === "VIDEO" ? "video" : "image" });
      } catch {
        console.error("Uploaded media cleanup failed", { storageProvider: uploaded.provider, storageKey: uploaded.key });
      }
      throw error;
    }
  }
}
