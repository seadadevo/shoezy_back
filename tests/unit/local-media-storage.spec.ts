import fs from "node:fs";
import os from "node:os";
import path from "node:path";
import request from "supertest";
import { afterAll, beforeAll, describe, expect, it, vi } from "vitest";
import { createApp } from "../../src/app";
import {
  CloudinaryMediaStorage,
  LocalVolumeMediaStorage,
  createMediaStorage,
  initMediaStorage,
} from "../../src/modules/products/media-storage";
import { ProductMediaUploadService } from "../../src/modules/products/product-media-upload.service";
import type { ProductMediaRepository } from "../../src/modules/products/product-media.repository";
import type { ProductMediaService } from "../../src/modules/products/product-media.service";
import { HomepageService } from "../../src/modules/homepage/homepage.service";
import type { HomepageStore } from "../../src/modules/homepage/homepage.repository";
import type { PrismaClient } from "@prisma/client";

describe("LocalVolumeMediaStorage and Local Media Architecture", () => {
  let tempDir: string;
  const baseUrl = "https://shoozybackend-production-bede.up.railway.app/uploads";

  const jpegBytes = Buffer.from([0xff, 0xd8, 0xff, 0xe0, 0x00, 0x10, 0x4a, 0x46, 0x49, 0x46]);
  const pngBytes = Buffer.from([137, 80, 78, 71, 13, 10, 26, 10, 0, 0, 0, 13]);
  const webpBytes = Buffer.from("RIFF\x1a\x00\x00\x00WEBPVP8 \x0e\x00\x00\x00");

  beforeAll(() => {
    tempDir = fs.mkdtempSync(path.join(os.tmpdir(), "shoozy-test-uploads-"));
  });

  afterAll(() => {
    try {
      fs.rmSync(tempDir, { recursive: true, force: true });
    } catch {
      // Ignore cleanup error in temp
    }
  });

  it("1. writes a JPEG file to disk with .jpg extension", async () => {
    const storage = new LocalVolumeMediaStorage({ root: tempDir, baseUrl, client: null });
    const result = await storage.upload({ buffer: jpegBytes, mimetype: "image/jpeg" });

    expect(result.provider).toBe("LOCAL");
    expect(result.key).toMatch(/^products\/[a-f0-9-]+\.jpg$/);
    expect(result.url).toBe(`${baseUrl}/${result.key}`);

    const filePath = path.join(tempDir, result.key);
    expect(fs.existsSync(filePath)).toBe(true);
    expect(fs.readFileSync(filePath)).toEqual(jpegBytes);
  });

  it("2. writes a PNG file to disk with .png extension", async () => {
    const storage = new LocalVolumeMediaStorage({ root: tempDir, baseUrl, client: null });
    const result = await storage.upload({ buffer: pngBytes, mimetype: "image/png" });

    expect(result.provider).toBe("LOCAL");
    expect(result.key).toMatch(/^products\/[a-f0-9-]+\.png$/);
    const filePath = path.join(tempDir, result.key);
    expect(fs.existsSync(filePath)).toBe(true);
    expect(fs.readFileSync(filePath)).toEqual(pngBytes);
  });

  it("3. writes a WEBP file to disk with .webp extension", async () => {
    const storage = new LocalVolumeMediaStorage({ root: tempDir, baseUrl, client: null });
    const result = await storage.upload({ buffer: webpBytes, mimetype: "image/webp" });

    expect(result.provider).toBe("LOCAL");
    expect(result.key).toMatch(/^products\/[a-f0-9-]+\.webp$/);
    const filePath = path.join(tempDir, result.key);
    expect(fs.existsSync(filePath)).toBe(true);
    expect(fs.readFileSync(filePath)).toEqual(webpBytes);
  });

  it("4. generates collision-safe and unique filenames", async () => {
    const storage = new LocalVolumeMediaStorage({ root: tempDir, baseUrl, client: null });
    const upload1 = await storage.upload({ buffer: pngBytes, mimetype: "image/png" });
    const upload2 = await storage.upload({ buffer: pngBytes, mimetype: "image/png" });

    expect(upload1.key).not.toBe(upload2.key);
    expect(upload1.url).not.toBe(upload2.url);
  });

  it("5. uses correct directory depending on options folder", async () => {
    const storage = new LocalVolumeMediaStorage({ root: tempDir, baseUrl, client: null });

    const prodUpload = await storage.upload(
      { buffer: jpegBytes, mimetype: "image/jpeg" },
      { folder: "shoozy/products" },
    );
    expect(prodUpload.key.startsWith("products/")).toBe(true);

    const homeUpload = await storage.upload(
      { buffer: jpegBytes, mimetype: "image/jpeg" },
      { folder: "shoozy/homepage" },
    );
    expect(homeUpload.key.startsWith("homepage/")).toBe(true);
  });

  it("6. builds public URL safely and normalizes trailing slashes", async () => {
    const storage = new LocalVolumeMediaStorage({
      root: tempDir,
      baseUrl: `${baseUrl}///`,
      client: null,
    });
    const result = await storage.upload({ buffer: jpegBytes, mimetype: "image/jpeg" });

    expect(result.url.startsWith(`${baseUrl}/products/`)).toBe(true);
    expect(result.url).not.toContain("///");
  });

  it("7. rejects invalid MIME types with 422 MEDIA_FILE_INVALID", async () => {
    const storage = new LocalVolumeMediaStorage({ root: tempDir, baseUrl, client: null });

    await expect(
      storage.upload({ buffer: Buffer.from("test"), mimetype: "application/pdf" }),
    ).rejects.toMatchObject({
      statusCode: 422,
      code: "MEDIA_FILE_INVALID",
    });

    await expect(
      storage.upload({ buffer: Buffer.from("test"), mimetype: "image/gif" }),
    ).rejects.toMatchObject({
      statusCode: 422,
      code: "MEDIA_FILE_INVALID",
    });
  });

  it("8. delete removes an owned local file", async () => {
    const storage = new LocalVolumeMediaStorage({ root: tempDir, baseUrl, client: null });
    const uploaded = await storage.upload({ buffer: jpegBytes, mimetype: "image/jpeg" });

    const filePath = path.join(tempDir, uploaded.key);
    expect(fs.existsSync(filePath)).toBe(true);

    await storage.delete(uploaded.key);
    expect(fs.existsSync(filePath)).toBe(false);
  });

  it("8b. delete also supports public URL of owned local file", async () => {
    const storage = new LocalVolumeMediaStorage({ root: tempDir, baseUrl, client: null });
    const uploaded = await storage.upload({ buffer: jpegBytes, mimetype: "image/jpeg" });

    const filePath = path.join(tempDir, uploaded.key);
    expect(fs.existsSync(filePath)).toBe(true);

    await storage.delete(uploaded.url);
    expect(fs.existsSync(filePath)).toBe(false);
  });

  it("9. delete refuses unsafe/outside paths without error or deleting outside files", async () => {
    const storage = new LocalVolumeMediaStorage({ root: tempDir, baseUrl, client: null });

    // Path traversal attempt
    await expect(storage.delete("../../package.json")).resolves.not.toThrow();
    expect(fs.existsSync(path.resolve(process.cwd(), "package.json"))).toBe(true);

    // External Cloudinary URL attempt
    await expect(
      storage.delete("https://res.cloudinary.com/shoozy/image/upload/v1/desktop.jpg"),
    ).resolves.not.toThrow();
  });

  it("10. Cloudinary driver remains selectable via UPLOAD_STORAGE_DRIVER=cloudinary", () => {
    const storage = createMediaStorage("cloudinary");
    expect(storage).toBeInstanceOf(CloudinaryMediaStorage);
  });

  it("10b. Cloudinary uses the video resource API for MP4 upload and deletion", async () => {
    const storage = new CloudinaryMediaStorage();
    (storage as unknown as { config: () => { cloud: string; key: string; secret: string } }).config = () => ({
      cloud: "demo",
      key: "key",
      secret: "secret",
    });
    const fetchMock = vi.fn()
      .mockResolvedValueOnce({ ok: true, json: async () => ({ secure_url: "https://res.cloudinary.com/demo/video/upload/v1/hero.mp4", public_id: "shoozy/homepage/hero" }) } as Response)
      .mockResolvedValueOnce({ ok: true } as Response);
    vi.stubGlobal("fetch", fetchMock);

    try {
      await storage.upload({ buffer: Buffer.from("mp4"), mimetype: "video/mp4" }, { folder: "shoozy/homepage", resourceType: "video" });
      await storage.delete("shoozy/homepage/hero", { resourceType: "video" });
      expect(fetchMock.mock.calls[0]?.[0]).toBe("https://api.cloudinary.com/v1_1/demo/video/upload");
      expect(fetchMock.mock.calls[1]?.[0]).toBe("https://api.cloudinary.com/v1_1/demo/video/destroy");
    } finally {
      vi.unstubAllGlobals();
    }
  });

  it("11. local driver does not require Cloudinary credentials", () => {
    const originalEnv = { ...process.env };
    delete process.env.CLOUDINARY_CLOUD_NAME;
    delete process.env.CLOUDINARY_API_KEY;
    delete process.env.CLOUDINARY_API_SECRET;
    process.env.UPLOAD_STORAGE_DRIVER = "local";
    process.env.UPLOAD_BASE_URL = baseUrl;

    try {
      const storage = createMediaStorage("local", { root: tempDir, baseUrl, client: null });
      expect(storage).toBeInstanceOf(LocalVolumeMediaStorage);
      expect(storage.isConfigured()).toBe(true);
    } finally {
      process.env = originalEnv;
    }
  });

  it("12. Homepage desktop and mobile uploads use homepage directory", async () => {
    const storage = new LocalVolumeMediaStorage({ root: tempDir, baseUrl, client: null });
    const store: HomepageStore = {
      listAdmin: vi.fn(),
      findById: vi.fn(),
      create: vi.fn(async (input) => ({
        id: "banner-1",
        ...input,
        createdAt: new Date(),
        updatedAt: new Date(),
        translations: [],
        promotion: null,
      })),
      update: vi.fn(),
      delete: vi.fn(),
      toggleActive: vi.fn(),
      listPublic: vi.fn(),
    };

    const service = new HomepageService(store, storage, null as unknown as PrismaClient);

    const banner = await service.create(
      {
        placement: "HERO_SLIDER",
        sortOrder: 1,
        isActive: true,
        translations: { en: { title: "Test" } },
      },
      {
        desktopImage: [{ buffer: jpegBytes, mimetype: "image/jpeg", size: jpegBytes.length } as Express.Multer.File],
        mobileImage: [{ buffer: webpBytes, mimetype: "image/webp", size: webpBytes.length } as Express.Multer.File],
      },
    );

    expect(banner.desktopImageUrl).toMatch(/^https:\/\/.*\/uploads\/homepage\/[a-f0-9-]+\.jpg$/);
    expect(banner.mobileImageUrl).toMatch(/^https:\/\/.*\/uploads\/homepage\/[a-f0-9-]+\.webp$/);
  });

  it("12b. Homepage MP4 uploads use the same local homepage directory", async () => {
    const storage = new LocalVolumeMediaStorage({ root: tempDir, baseUrl, client: null });
    const store: HomepageStore = {
      listAdmin: vi.fn(), findById: vi.fn(), update: vi.fn(), delete: vi.fn(), toggleActive: vi.fn(), listPublic: vi.fn(),
      create: vi.fn(async (input) => ({ id: "banner-video", ...input, createdAt: new Date(), updatedAt: new Date(), translations: [], promotion: null })),
    };
    const mp4 = Buffer.from([0, 0, 0, 20, 0x66, 0x74, 0x79, 0x70, 0x69, 0x73, 0x6f, 0x6d, 0, 0, 0, 0, 0x69, 0x73, 0x6f, 0x6d]);
    const banner = await new HomepageService(store, storage, null as unknown as PrismaClient).create({
      placement: "HERO_SLIDER", sortOrder: 0, isActive: true, translations: { en: { title: "Video" } },
    }, { desktopVideo: [{ buffer: mp4, mimetype: "video/mp4", size: mp4.length } as Express.Multer.File] });

    expect(banner.desktopVideoUrl).toMatch(/^https:\/\/.*\/uploads\/homepage\/[a-f0-9-]+\.mp4$/);
    expect(fs.existsSync(path.join(tempDir, new URL(banner.desktopVideoUrl!).pathname.split("/uploads/")[1]!))).toBe(true);
  });

  it("13. Product uploads use products directory", async () => {
    const storage = new LocalVolumeMediaStorage({ root: tempDir, baseUrl, client: null });
    const repo = {
      validateUploadTarget: vi.fn(async () => "OK" as const),
    };
    const media = {
      create: vi.fn(async (_productId, input) => ({
        id: "media-1",
        url: input.url,
      })),
    };

    const service = new ProductMediaUploadService(
      repo as unknown as ProductMediaRepository,
      media as unknown as ProductMediaService,
      storage,
    );

    const uploaded = await service.upload(
      "11111111-1111-4111-8111-111111111111",
      {},
      { buffer: pngBytes, mimetype: "image/png", size: pngBytes.length },
    );

    expect(uploaded.url).toMatch(/^https:\/\/.*\/uploads\/products\/[a-f0-9-]+\.png$/);
    expect(media.create).toHaveBeenCalledWith(
      "11111111-1111-4111-8111-111111111111",
      expect.objectContaining({
        storageProvider: "LOCAL",
        storageKey: expect.stringMatching(/^products\/[a-f0-9-]+\.png$/),
      }),
    );
  });

  it("14. serves uploaded files statically via GET /uploads with proper headers and 404 for missing", async () => {
    // Override upload root for app to point to tempDir
    const originalLocalPath = process.env.UPLOAD_LOCAL_PATH;
    process.env.UPLOAD_LOCAL_PATH = tempDir;

    try {
      const app = createApp();

      // Write test image into tempDir/products/sample.jpg
      const prodDir = path.join(tempDir, "products");
      fs.mkdirSync(prodDir, { recursive: true });
      fs.writeFileSync(path.join(prodDir, "sample.jpg"), jpegBytes);

      // GET /uploads/products/sample.jpg
      const response = await request(app).get("/uploads/products/sample.jpg");
      expect(response.status).toBe(200);
      expect(response.headers["content-type"]).toContain("image/jpeg");
      expect(response.headers["cross-origin-resource-policy"]).toBe("cross-origin");
      expect(response.body).toEqual(jpegBytes);

      // GET missing file returns 404
      const missing = await request(app).get("/uploads/products/does-not-exist.jpg");
      expect(missing.status).toBe(404);
    } finally {
      if (originalLocalPath !== undefined) {
        process.env.UPLOAD_LOCAL_PATH = originalLocalPath;
      } else {
        delete process.env.UPLOAD_LOCAL_PATH;
      }
    }
  });

  it("15. writes an MP4 file to disk under products/videos/ with .mp4 extension and correct URL", async () => {
    const storage = new LocalVolumeMediaStorage({ root: tempDir, baseUrl, client: null });
    const mp4Bytes = Buffer.from([
      0x00, 0x00, 0x00, 0x18, 0x66, 0x74, 0x79, 0x70, 0x69, 0x73, 0x6f, 0x6d, 0x00, 0x00, 0x02, 0x00,
    ]);
    const result = await storage.upload({ buffer: mp4Bytes, mimetype: "video/mp4" });

    expect(result.provider).toBe("LOCAL");
    expect(result.key).toMatch(/^products\/videos\/[a-f0-9-]+\.mp4$/);
    expect(result.url).toBe(`${baseUrl}/${result.key}`);

    const filePath = path.join(tempDir, ...result.key.split("/"));
    expect(fs.existsSync(filePath)).toBe(true);
    expect(fs.readFileSync(filePath)).toEqual(mp4Bytes);

    // Deleting video removes owned local file
    await storage.delete(result.key);
    expect(fs.existsSync(filePath)).toBe(false);
  });

  it("16. initMediaStorage creates products/videos directory when driver is local", async () => {
    const initTempDir = fs.mkdtempSync(path.join(os.tmpdir(), "shoozy-init-storage-"));
    const originalLocalPath = process.env.UPLOAD_LOCAL_PATH;
    const originalDriver = process.env.UPLOAD_STORAGE_DRIVER;
    const originalBaseUrl = process.env.UPLOAD_BASE_URL;

    process.env.UPLOAD_LOCAL_PATH = initTempDir;
    process.env.UPLOAD_STORAGE_DRIVER = "local";
    process.env.UPLOAD_BASE_URL = baseUrl;

    try {
      await initMediaStorage();

      expect(fs.existsSync(path.join(initTempDir, "products", "videos"))).toBe(true);
      expect(fs.existsSync(path.join(initTempDir, "products"))).toBe(true);
      expect(fs.existsSync(path.join(initTempDir, "homepage"))).toBe(true);
      expect(fs.existsSync(path.join(initTempDir, "collections"))).toBe(true);
      expect(fs.existsSync(path.join(initTempDir, "brands"))).toBe(true);
      expect(fs.existsSync(path.join(initTempDir, "categories"))).toBe(true);
    } finally {
      if (originalLocalPath !== undefined) process.env.UPLOAD_LOCAL_PATH = originalLocalPath;
      else delete process.env.UPLOAD_LOCAL_PATH;
      if (originalDriver !== undefined) process.env.UPLOAD_STORAGE_DRIVER = originalDriver;
      else delete process.env.UPLOAD_STORAGE_DRIVER;
      if (originalBaseUrl !== undefined) process.env.UPLOAD_BASE_URL = originalBaseUrl;
      else delete process.env.UPLOAD_BASE_URL;
      fs.rmSync(initTempDir, { recursive: true, force: true });
    }
  });

  it("17. supports HTTP Range requests for MP4 video streaming returning 206 Partial Content", async () => {
    const originalLocalPath = process.env.UPLOAD_LOCAL_PATH;
    process.env.UPLOAD_LOCAL_PATH = tempDir;

    try {
      const app = createApp();

      // Create a 2048-byte simulated MP4 file in products/videos/
      const videoDir = path.join(tempDir, "products", "videos");
      fs.mkdirSync(videoDir, { recursive: true });
      const videoBuffer = Buffer.alloc(2048);
      for (let i = 0; i < videoBuffer.length; i++) {
        videoBuffer[i] = i % 256;
      }
      fs.writeFileSync(path.join(videoDir, "stream-test.mp4"), videoBuffer);

      // GET without Range returns 200 with Accept-Ranges
      const fullResponse = await request(app).get("/uploads/products/videos/stream-test.mp4");
      expect(fullResponse.status).toBe(200);
      expect(fullResponse.headers["content-type"]).toContain("video/mp4");
      expect(fullResponse.headers["accept-ranges"]).toBe("bytes");
      expect(fullResponse.headers["cross-origin-resource-policy"]).toBe("cross-origin");
      expect(fullResponse.body.length).toBe(2048);

      // GET with Range: bytes=0-1023 returns 206 Partial Content
      const rangeResponse = await request(app)
        .get("/uploads/products/videos/stream-test.mp4")
        .set("Range", "bytes=0-1023");

      expect(rangeResponse.status).toBe(206);
      expect(rangeResponse.headers["content-type"]).toContain("video/mp4");
      expect(rangeResponse.headers["accept-ranges"]).toBe("bytes");
      expect(rangeResponse.headers["content-range"]).toBe("bytes 0-1023/2048");
      expect(rangeResponse.headers["content-length"]).toBe("1024");
      expect(rangeResponse.headers["cross-origin-resource-policy"]).toBe("cross-origin");
      expect(rangeResponse.body).toEqual(videoBuffer.subarray(0, 1024));

      // GET missing video returns 404
      const missingResponse = await request(app).get("/uploads/products/videos/nonexistent.mp4");
      expect(missingResponse.status).toBe(404);
    } finally {
      if (originalLocalPath !== undefined) {
        process.env.UPLOAD_LOCAL_PATH = originalLocalPath;
      } else {
        delete process.env.UPLOAD_LOCAL_PATH;
      }
    }
  });
});
