import { describe, expect, it, vi } from "vitest";
import { AppError } from "../../src/common/errors/app-error";
import {
  ProductMediaUploadService,
  MAX_IMAGE_BYTES,
  imageMime,
  isMp4Buffer,
  detectMediaMime,
} from "../../src/modules/products/product-media-upload.service";
import type { ProductMediaRepository } from "../../src/modules/products/product-media.repository";
import type { ProductMediaService } from "../../src/modules/products/product-media.service";
import type { MediaStorage } from "../../src/modules/products/media-storage";
import type { ProductVideoRecord } from "../../src/modules/products/product-media.types";

const productId = "11111111-1111-4111-8111-111111111111";
const variantId = "22222222-2222-4222-8222-222222222222";
const png = Buffer.from([137, 80, 78, 71, 13, 10, 26, 10, 0, 0]);
const file = { buffer: png, mimetype: "image/png", size: png.length };
function setup() {
  const repository = { validateUploadTarget: vi.fn(async () => "OK" as const) };
  const media = { create: vi.fn(async () => ({ id: "media-id", url: "https://res.cloudinary.com/test/image/upload/x.png" })) };
  const storage = { isConfigured: vi.fn(() => true), upload: vi.fn(async () => ({ provider: "CLOUDINARY" as const, key: "shoozy/products/x", url: "https://res.cloudinary.com/test/image/upload/x.png" })), delete: vi.fn(async () => undefined) };
  const service = new ProductMediaUploadService(repository as unknown as ProductMediaRepository, media as unknown as ProductMediaService, storage satisfies MediaStorage);
  return { repository, media, storage, service };
}
describe("product image upload", () => {
  it("detects JPEG, PNG, and WebP by bytes", () => {
    expect(imageMime(png)).toBe("image/png");
    expect(imageMime(Buffer.from([0xff, 0xd8, 0xff]))).toBe("image/jpeg");
    expect(imageMime(Buffer.from("RIFFxxxxWEBP"))).toBe("image/webp");
    expect(imageMime(Buffer.from("not an image"))).toBeNull();
  });
  it("rejects forged MIME types and oversized files before storage", async () => {
    const { service, storage } = setup();
    await expect(service.upload(productId, {}, { ...file, mimetype: "image/jpeg" })).rejects.toMatchObject({ code: "MEDIA_FILE_INVALID" });
    await expect(service.upload(productId, {}, { ...file, size: MAX_IMAGE_BYTES + 1 })).rejects.toMatchObject({ code: "MEDIA_FILE_TOO_LARGE" });
    expect(storage.upload).not.toHaveBeenCalled();
  });
  it.each([["PRODUCT_NOT_FOUND", "PRODUCT_NOT_FOUND"], ["VARIANT_NOT_FOUND", "PRODUCT_VARIANT_NOT_FOUND"]] as const)("rejects %s before upload", async (target, code) => {
    const { service, repository, storage } = setup();
    repository.validateUploadTarget.mockResolvedValue(target as "OK");
    await expect(service.upload(productId, { variantId }, file)).rejects.toMatchObject({ code });
    expect(storage.upload).not.toHaveBeenCalled();
  });
  it("returns a controlled error when Cloudinary is not configured", async () => {
    const { service, storage } = setup(); storage.isConfigured.mockReturnValue(false);
    await expect(service.upload(productId, {}, file)).rejects.toMatchObject({ code: "MEDIA_STORAGE_NOT_CONFIGURED" });
  });
  it("stores provider metadata alongside normal ProductMedia fields", async () => {
    const { service, media, storage } = setup();
    await expect(service.upload(productId, { variantId, altText: "Runner", isPrimary: true }, file)).resolves.toMatchObject({ id: "media-id" });
    expect(storage.upload).toHaveBeenCalledOnce();
    expect(media.create).toHaveBeenCalledWith(productId, expect.objectContaining({ variantId, type: "IMAGE", isPrimary: true, storageProvider: "CLOUDINARY", storageKey: "shoozy/products/x" }));
  });
  it("removes the uploaded asset if media persistence hits a primary conflict", async () => {
    const { service, media, storage } = setup();
    media.create.mockRejectedValue(new AppError(409, "Primary conflict", "PRODUCT_MEDIA_PRIMARY_CONFLICT"));
    await expect(service.upload(productId, { isPrimary: true }, file)).rejects.toMatchObject({ code: "PRODUCT_MEDIA_PRIMARY_CONFLICT" });
    expect(storage.delete).toHaveBeenCalledWith("shoozy/products/x", { resourceType: "image" });
  });
});

describe("product video upload", () => {
  const mp4Header = Buffer.from([
    0x00, 0x00, 0x00, 0x18,
    0x66, 0x74, 0x79, 0x70, // 'ftyp'
    0x69, 0x73, 0x6f, 0x6d, // 'isom'
    0x00, 0x00, 0x02, 0x00,
    0x69, 0x73, 0x6f, 0x6d, // 'isom'
    0x6d, 0x70, 0x34, 0x31, // 'mp41'
  ]);
  const videoFile = { buffer: mp4Header, mimetype: "video/mp4", size: mp4Header.length };

  function setupVideo() {
    const repository = { validateUploadTarget: vi.fn(async () => "OK" as const) };
    const media = {
      create: vi.fn(async () => ({
        id: "video-media-id",
        url: "https://shoozybackend-production-bede.up.railway.app/uploads/products/videos/test.mp4",
        type: "VIDEO",
        mediaType: "VIDEO",
        isPrimary: false,
      })),
      update: vi.fn(async () => ({
        id: "video-media-id",
        url: "https://shoozybackend-production-bede.up.railway.app/uploads/products/videos/test-new.mp4",
        type: "VIDEO",
        mediaType: "VIDEO",
        isPrimary: false,
      })),
      findVideo: vi.fn(async (_id: string): Promise<ProductVideoRecord | null> => null),
    };
    const storage = {
      isConfigured: vi.fn(() => true),
      upload: vi.fn(async () => ({
        provider: "LOCAL" as const,
        key: "products/videos/test.mp4",
        url: "https://shoozybackend-production-bede.up.railway.app/uploads/products/videos/test.mp4",
      })),
      delete: vi.fn(async () => undefined),
    };
    const service = new ProductMediaUploadService(
      repository as unknown as ProductMediaRepository,
      media as unknown as ProductMediaService,
      storage satisfies MediaStorage,
    );
    return { repository, media, storage, service };
  }

  it("detects valid MP4 header magic bytes and rejects arbitrary binaries", () => {
    expect(isMp4Buffer(mp4Header)).toBe(true);
    expect(isMp4Buffer(Buffer.from("not an mp4 file at all"))).toBe(false);
    expect(detectMediaMime(mp4Header)).toEqual({ type: "VIDEO", mimetype: "video/mp4" });
    expect(detectMediaMime(Buffer.from("RIFFxxxxWEBP"))).toEqual({ type: "IMAGE", mimetype: "image/webp" });
  });

  it("successfully uploads MP4 into products/videos folder with mediaType VIDEO and isPrimary false", async () => {
    const { service, storage, media } = setupVideo();
    const result = await service.upload(productId, { altText: "Product showcase video" }, videoFile);

    expect(result).toMatchObject({
      id: "video-media-id",
      type: "VIDEO",
      mediaType: "VIDEO",
      isPrimary: false,
    });
    expect(storage.upload).toHaveBeenCalledWith(
      expect.objectContaining({ mimetype: "video/mp4" }),
      { folder: "products/videos", resourceType: "video" },
    );
    expect(media.create).toHaveBeenCalledWith(productId, expect.objectContaining({
      type: "VIDEO",
      mediaType: "VIDEO",
      mimeType: "video/mp4",
      isPrimary: false,
      storageKey: "products/videos/test.mp4",
      storageProvider: "LOCAL",
    }));
  });

  it("rejects oversized video > 50 MB with MEDIA_VIDEO_TOO_LARGE", async () => {
    const { service, storage } = setupVideo();
    const oversizedVideo = { ...videoFile, size: 50 * 1024 * 1024 + 1 };
    await expect(service.upload(productId, {}, oversizedVideo)).rejects.toMatchObject({
      code: "MEDIA_VIDEO_TOO_LARGE",
      statusCode: 413,
    });
    expect(storage.upload).not.toHaveBeenCalled();
  });

  it("rejects forged or fake video MIME types", async () => {
    const { service, storage } = setupVideo();
    const fakeMp4 = { buffer: Buffer.from("just plain text"), mimetype: "video/mp4", size: 15 };
    await expect(service.upload(productId, {}, fakeMp4)).rejects.toMatchObject({
      code: "MEDIA_FILE_INVALID",
      statusCode: 422,
    });
    expect(storage.upload).not.toHaveBeenCalled();
  });

  it("rejects declared mediaType mismatch (declared VIDEO with image file)", async () => {
    const { service, storage } = setupVideo();
    await expect(service.upload(productId, { mediaType: "VIDEO" }, file)).rejects.toMatchObject({
      code: "MEDIA_TYPE_MISMATCH",
      statusCode: 422,
    });
    expect(storage.upload).not.toHaveBeenCalled();
  });

  it("rejects setting video isPrimary = true with MEDIA_VIDEO_CANNOT_BE_PRIMARY", async () => {
    const { service, storage } = setupVideo();
    await expect(service.upload(productId, { isPrimary: true }, videoFile)).rejects.toMatchObject({
      code: "MEDIA_VIDEO_CANNOT_BE_PRIMARY",
      statusCode: 422,
    });
    expect(storage.upload).not.toHaveBeenCalled();
  });

  function mockVideo(overrides: Partial<ProductVideoRecord> = {}): ProductVideoRecord {
    return {
      id: "existing-video-id",
      productId,
      variantId: null,
      type: "VIDEO",
      mediaType: "VIDEO",
      mimeType: "video/mp4",
      url: "https://shoozybackend-production-bede.up.railway.app/uploads/products/videos/test.mp4",
      altText: "Existing video",
      position: 0,
      isPrimary: false,
      createdAt: new Date(),
      storageProvider: "LOCAL",
      storageKey: "products/videos/old-uuid.mp4",
      ...overrides,
    };
  }

  it("rejects second video upload when product already has a video without replace flag", async () => {
    const { service, media, storage } = setupVideo();
    media.findVideo.mockResolvedValue(mockVideo({ id: "existing-video-id" }));

    await expect(service.upload(productId, {}, videoFile)).rejects.toMatchObject({
      code: "MEDIA_VIDEO_LIMIT_EXCEEDED",
      statusCode: 409,
    });
    expect(storage.upload).not.toHaveBeenCalled();
  });

  it("replaces existing video cleanly when replaceVideo is true, deleting old file after DB success", async () => {
    const { service, media, storage } = setupVideo();
    media.findVideo.mockResolvedValue(mockVideo({
      id: "existing-video-id",
      storageKey: "products/videos/old-uuid.mp4",
      storageProvider: "LOCAL",
    }));

    const result = await service.upload(productId, { replaceVideo: true }, videoFile);
    expect(result).toMatchObject({ id: "video-media-id" });
    expect(media.update).toHaveBeenCalledWith(
      productId,
      "existing-video-id",
      expect.objectContaining({
        type: "VIDEO",
        mediaType: "VIDEO",
        url: "https://shoozybackend-production-bede.up.railway.app/uploads/products/videos/test.mp4",
        storageProvider: "LOCAL",
        storageKey: "products/videos/test.mp4",
        mimeType: "video/mp4",
        isPrimary: false,
      }),
    );
    expect(storage.delete).toHaveBeenCalledWith("products/videos/old-uuid.mp4", { resourceType: "video" });
  });

  it("safely cleans up new video and preserves old video if DB update fails during replacement", async () => {
    const { service, media, storage } = setupVideo();
    media.findVideo.mockResolvedValue(mockVideo({
      id: "existing-video-id",
      storageKey: "products/videos/old-uuid.mp4",
      storageProvider: "LOCAL",
    }));
    media.update.mockRejectedValue(new Error("Database connection dropped"));

    await expect(service.upload(productId, { replaceVideo: true }, videoFile)).rejects.toThrow(
      "Database connection dropped",
    );
    // Deleted new file
    expect(storage.delete).toHaveBeenCalledWith("products/videos/test.mp4", { resourceType: "video" });
    // Did NOT delete old file
    expect(storage.delete).not.toHaveBeenCalledWith("products/videos/old-uuid.mp4", { resourceType: "video" });
  });

  it("cleans up uploaded video from storage if DB creation fails", async () => {
    const { service, media, storage } = setupVideo();
    media.create.mockRejectedValue(new Error("Database write failure"));

    await expect(service.upload(productId, {}, videoFile)).rejects.toThrow("Database write failure");
    expect(storage.delete).toHaveBeenCalledWith("products/videos/test.mp4", { resourceType: "video" });
  });
});
