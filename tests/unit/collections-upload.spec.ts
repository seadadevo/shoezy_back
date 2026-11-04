import fs from "node:fs";
import os from "node:os";
import path from "node:path";
import { randomUUID } from "node:crypto";
import type { RequestHandler } from "express";
import request from "supertest";
import { afterAll, beforeAll, beforeEach, describe, expect, it, vi } from "vitest";
import { createApp } from "../../src/app";
import { LocalVolumeMediaStorage } from "../../src/modules/products/media-storage";
import { CollectionsService, type CollectionsStore } from "../../src/modules/collections/collections.service";
import { CollectionsRepositoryError } from "../../src/modules/collections/collections.repository";
import type { CollectionRecord } from "../../src/modules/collections/collections.types";
import { AuditLogService } from "../../src/modules/admin-audit/audit-log.service";

vi.mock("../../src/common/middlewares/auth.middleware", async () => {
  const { AppError } = await import("../../src/common/errors/app-error.js");
  const { ALL_PERMISSION_CODES, CUSTOMER_PERMISSION_CODES } = await import(
    "../../src/common/auth/rbac.constants.js"
  );
  const requireAuth: RequestHandler = (req, _res, next) => {
    if (!req.headers.authorization) {
      return next(new AppError(401, "Authentication required", "AUTH_UNAUTHORIZED"));
    }
    const admin = req.headers.authorization === "Bearer admin";
    req.auth = {
      userId: "11111111-1111-4111-8111-111111111111",
      sessionId: "22222222-2222-4222-8222-222222222222",
      roleCodes: [admin ? "ADMIN" : "CUSTOMER"],
      permissions: [...(admin ? ALL_PERMISSION_CODES : CUSTOMER_PERMISSION_CODES)],
    };
    next();
  };
  return { requireAuth, createRequireAuth: vi.fn() };
});

describe("Collection Image Upload Architecture", () => {
  let tempDir: string;
  let baseUrl: string;
  let originalLocalPath: string | undefined;
  let originalBaseUrl: string | undefined;
  let originalDriver: string | undefined;

  const jpegBytes = Buffer.from([0xff, 0xd8, 0xff, 0xe0, 0x00, 0x10, 0x4a, 0x46, 0x49, 0x46]);
  const pngBytes = Buffer.from([137, 80, 78, 71, 13, 10, 26, 10, 0, 0, 0, 13]);
  const webpBytes = Buffer.from("RIFF\x1a\x00\x00\x00WEBPVP8 \x0e\x00\x00\x00");
  const mp4Bytes = Buffer.from([0, 0, 0, 20, 0x66, 0x74, 0x79, 0x70, 0x69, 0x73, 0x6f, 0x6d, 0, 0, 0, 0, 0x69, 0x73, 0x6f, 0x6d]);

  function createStore(): CollectionsStore & { collections: Map<string, CollectionRecord> } {
    const collections = new Map<string, CollectionRecord>();
    return {
      collections,
      list: vi.fn(async () => ({ items: Array.from(collections.values()), total: collections.size })),
      findById: vi.fn(async (id: string) => {
        const c = collections.get(id);
        return c ? { ...c, collectionProducts: [] } : null;
      }),
      create: vi.fn(async (input) => {
        const id = randomUUID();
        const rec: CollectionRecord = {
          id,
          name: input.name,
          slug: input.slug,
          description: input.description ?? null,
          imageUrl: input.imageUrl ?? null,
          videoUrl: input.videoUrl ?? null,
          videoMimeType: input.videoMimeType ?? null,
          videoStorageProvider: input.videoStorageProvider ?? null,
          videoStorageKey: input.videoStorageKey ?? null,
          isActive: input.isActive ?? true,
          startsAt: input.startsAt ?? null,
          endsAt: input.endsAt ?? null,
          createdAt: new Date(),
          updatedAt: new Date(),
          _count: { collectionProducts: 0 },
          translations: [],
        };
        collections.set(id, rec);
        return rec;
      }),
      update: vi.fn(async (id, input) => {
        const existing = collections.get(id);
        if (!existing) return null;
        const updated: CollectionRecord = {
          ...existing,
          ...(input.name !== undefined ? { name: input.name } : {}),
          ...(input.slug !== undefined ? { slug: input.slug } : {}),
          ...(input.description !== undefined ? { description: input.description } : {}),
          ...(input.imageUrl !== undefined ? { imageUrl: input.imageUrl } : {}),
          ...(input.videoUrl !== undefined ? { videoUrl: input.videoUrl } : {}),
          ...(input.videoMimeType !== undefined ? { videoMimeType: input.videoMimeType } : {}),
          ...(input.videoStorageProvider !== undefined ? { videoStorageProvider: input.videoStorageProvider } : {}),
          ...(input.videoStorageKey !== undefined ? { videoStorageKey: input.videoStorageKey } : {}),
          ...(input.isActive !== undefined ? { isActive: input.isActive } : {}),
          ...(input.startsAt !== undefined ? { startsAt: input.startsAt } : {}),
          ...(input.endsAt !== undefined ? { endsAt: input.endsAt } : {}),
          updatedAt: new Date(),
        };
        collections.set(id, updated);
        return updated;
      }),
      replaceProducts: vi.fn(async (id: string) => (collections.has(id) ? ("UPDATED" as const) : ("COLLECTION_NOT_FOUND" as const))),
      delete: vi.fn(async (id: string) => collections.delete(id)),
    };
  }

  beforeAll(() => {
    tempDir = fs.mkdtempSync(path.join(os.tmpdir(), "shoozy-collection-test-"));
    baseUrl = "https://shoozybackend-production-bede.up.railway.app/uploads";

    originalLocalPath = process.env.UPLOAD_LOCAL_PATH;
    originalBaseUrl = process.env.UPLOAD_BASE_URL;
    originalDriver = process.env.UPLOAD_STORAGE_DRIVER;

    process.env.UPLOAD_LOCAL_PATH = tempDir;
    process.env.UPLOAD_BASE_URL = baseUrl;
    process.env.UPLOAD_STORAGE_DRIVER = "local";
  });

  afterAll(() => {
    if (originalLocalPath !== undefined) process.env.UPLOAD_LOCAL_PATH = originalLocalPath;
    else delete process.env.UPLOAD_LOCAL_PATH;

    if (originalBaseUrl !== undefined) process.env.UPLOAD_BASE_URL = originalBaseUrl;
    else delete process.env.UPLOAD_BASE_URL;

    if (originalDriver !== undefined) process.env.UPLOAD_STORAGE_DRIVER = originalDriver;
    else delete process.env.UPLOAD_STORAGE_DRIVER;

    try {
      fs.rmSync(tempDir, { recursive: true, force: true });
    } catch {
      // Cleanup ignored in temp
    }
  });
  beforeEach(() => {
    vi.restoreAllMocks();
    vi.spyOn(AuditLogService.prototype, "record").mockResolvedValue({} as never);
  });

  it("1. JSON create without image still works", async () => {
    const store = createStore();
    const storage = new LocalVolumeMediaStorage({ root: tempDir, baseUrl, client: null });
    const service = new CollectionsService(store, storage);

    const result = await service.create({
      name: "Classic JSON Collection",
      slug: "classic-json-collection",
      description: "No image provided",
    });

    expect(result.name).toBe("Classic JSON Collection");
    expect(result.slug).toBe("classic-json-collection");
    expect(result.imageUrl).toBeNull();
    expect(store.create).toHaveBeenCalledWith(
      expect.objectContaining({
        name: "Classic JSON Collection",
        imageUrl: null,
      }),
    );
  });

  it("1b. JSON create with imageUrl still works", async () => {
    const store = createStore();
    const storage = new LocalVolumeMediaStorage({ root: tempDir, baseUrl, client: null });
    const service = new CollectionsService(store, storage);

    const result = await service.create({
      name: "External Image Collection",
      imageUrl: "https://example.com/external.jpg",
    });

    expect(result.name).toBe("External Image Collection");
    expect(result.imageUrl).toBe("https://example.com/external.jpg");
    expect(store.create).toHaveBeenCalledWith(
      expect.objectContaining({
        imageUrl: "https://example.com/external.jpg",
      }),
    );
  });

  it("2. JSON update still works", async () => {
    const store = createStore();
    const storage = new LocalVolumeMediaStorage({ root: tempDir, baseUrl, client: null });
    const service = new CollectionsService(store, storage);

    const created = await service.create({
      name: "Original Name",
      imageUrl: "https://example.com/original.jpg",
    });

    const updated = await service.update(created.id, {
      name: "Updated Name",
    });

    expect(updated.name).toBe("Updated Name");
    expect(updated.imageUrl).toBe("https://example.com/original.jpg");
  });

  it("3. multipart create with image works", async () => {
    const store = createStore();
    const storage = new LocalVolumeMediaStorage({ root: tempDir, baseUrl, client: null });
    const service = new CollectionsService(store, storage);

    const result = await service.create(
      {
        name: "Summer Drops",
      },
      undefined,
      { buffer: jpegBytes, mimetype: "image/jpeg", size: jpegBytes.length } as Express.Multer.File,
    );

    expect(result.name).toBe("Summer Drops");
    expect(result.imageUrl).toMatch(new RegExp(`^${baseUrl}/collections/[a-f0-9-]+\\.jpg$`));
    const filename = path.basename(new URL(result.imageUrl!).pathname);
    const diskPath = path.join(tempDir, "collections", filename);
    expect(fs.existsSync(diskPath)).toBe(true);
    expect(fs.readFileSync(diskPath)).toEqual(jpegBytes);
  });

  it("4. multipart update with image works", async () => {
    const store = createStore();
    const storage = new LocalVolumeMediaStorage({ root: tempDir, baseUrl, client: null });
    const service = new CollectionsService(store, storage);

    const created = await service.create({ name: "Initial Collection" });
    expect(created.imageUrl).toBeNull();

    const updated = await service.update(
      created.id,
      { name: "Updated Collection" },
      undefined,
      { buffer: pngBytes, mimetype: "image/png", size: pngBytes.length } as Express.Multer.File,
    );

    expect(updated.name).toBe("Updated Collection");
    expect(updated.imageUrl).toMatch(new RegExp(`^${baseUrl}/collections/[a-f0-9-]+\\.png$`));
    const filename = path.basename(new URL(updated.imageUrl!).pathname);
    const diskPath = path.join(tempDir, "collections", filename);
    expect(fs.existsSync(diskPath)).toBe(true);
    expect(fs.readFileSync(diskPath)).toEqual(pngBytes);
  });

  it("5. multipart data JSON is parsed correctly via HTTP route", async () => {
    const createSpy = vi.spyOn(CollectionsService.prototype, "create").mockImplementation(async (input, _actorId, file) => {
      expect(file).toBeDefined();
      expect(file?.mimetype).toBe("image/jpeg");
      expect(file?.originalname).toBe("weekend.jpg");
      return {
        id: "11111111-1111-4111-8111-111111111111",
        name: input.name,
        slug: input.slug ?? "demo-weekend-picks",
        description: input.description ?? null,
        imageUrl: `${baseUrl}/collections/mock-uploaded.jpg`,
        isActive: input.isActive ?? true,
        startsAt: null,
        endsAt: null,
        createdAt: new Date().toISOString(),
        updatedAt: new Date().toISOString(),
      } as never;
    });

    const app = createApp();
    const data = {
      name: "Weekend Picks",
      slug: "demo-weekend-picks",
      description: "Curated weekend picks",
      isActive: true,
    };

    const res = await request(app)
      .post("/api/v1/admin/collections")
      .set("Authorization", "Bearer admin")
      .field("data", JSON.stringify(data))
      .attach("image", jpegBytes, { filename: "weekend.jpg", contentType: "image/jpeg" });

    expect(res.status).toBe(201);
    expect(res.body.success).toBe(true);
    expect(res.body.data.name).toBe("Weekend Picks");
    expect(res.body.data.slug).toBe("demo-weekend-picks");
    expect(res.body.data.description).toBe("Curated weekend picks");
    expect(res.body.data.imageUrl).toBe(`${baseUrl}/collections/mock-uploaded.jpg`);
    expect(createSpy).toHaveBeenCalledWith(
      expect.objectContaining({
        name: "Weekend Picks",
        slug: "demo-weekend-picks",
        description: "Curated weekend picks",
        isActive: true,
      }),
      undefined,
      expect.objectContaining({
        originalname: "weekend.jpg",
        mimetype: "image/jpeg",
      }),
    );
  });

  it("5b. multipart data JSON is parsed correctly on PATCH route", async () => {
    const updateSpy = vi.spyOn(CollectionsService.prototype, "update").mockImplementation(async (_id, input, _actorId, file) => {
      expect(file).toBeDefined();
      expect(file?.mimetype).toBe("image/png");
      return {
        id: "11111111-1111-4111-8111-111111111111",
        name: input.name ?? "Updated Picks",
        slug: "demo-weekend-picks",
        description: "Updated description",
        imageUrl: `${baseUrl}/collections/mock-updated.png`,
        isActive: true,
        startsAt: null,
        endsAt: null,
        createdAt: new Date().toISOString(),
        updatedAt: new Date().toISOString(),
      } as never;
    });

    const app = createApp();
    const data = {
      name: "Updated Picks",
      description: "Updated description",
    };

    const res = await request(app)
      .patch("/api/v1/admin/collections/11111111-1111-4111-8111-111111111111")
      .set("Authorization", "Bearer admin")
      .field("data", JSON.stringify(data))
      .attach("image", pngBytes, { filename: "updated.png", contentType: "image/png" });

    expect(res.status).toBe(200);
    expect(res.body.success).toBe(true);
    expect(res.body.data.name).toBe("Updated Picks");
    expect(res.body.data.imageUrl).toBe(`${baseUrl}/collections/mock-updated.png`);
    expect(updateSpy).toHaveBeenCalledWith(
      "11111111-1111-4111-8111-111111111111",
      expect.objectContaining({
        name: "Updated Picks",
        description: "Updated description",
      }),
      undefined,
      expect.objectContaining({
        originalname: "updated.png",
        mimetype: "image/png",
      }),
    );
  });

  it("6. missing data returns controlled 422", async () => {
    const app = createApp();
    const res = await request(app)
      .post("/api/v1/admin/collections")
      .set("Authorization", "Bearer admin")
      .attach("image", jpegBytes, { filename: "missing-data.jpg", contentType: "image/jpeg" });

    expect(res.status).toBe(422);
    expect(res.body.success).toBe(false);
    expect(res.body.error.code).toBe("COLLECTION_DATA_REQUIRED");
  });

  it("7. malformed data JSON returns controlled 422", async () => {
    const app = createApp();
    const res = await request(app)
      .post("/api/v1/admin/collections")
      .set("Authorization", "Bearer admin")
      .field("data", "{ invalid json")
      .attach("image", jpegBytes, { filename: "malformed.jpg", contentType: "image/jpeg" });

    expect(res.status).toBe(422);
    expect(res.body.success).toBe(false);
    expect(res.body.error.code).toBe("COLLECTION_DATA_INVALID");
  });

  it("8. invalid MIME rejected", async () => {
    const app = createApp();
    const res = await request(app)
      .post("/api/v1/admin/collections")
      .set("Authorization", "Bearer admin")
      .field("data", JSON.stringify({ name: "Invalid MIME" }))
      .attach("image", Buffer.from("%PDF-1.4 test"), { filename: "document.pdf", contentType: "application/pdf" });

    expect(res.status).toBe(422);
    expect(res.body.success).toBe(false);
    expect(res.body.error.code).toBe("MEDIA_FILE_INVALID");
  });

  it("8b. corrupted image with fake MIME rejected by magic bytes check", async () => {
    const store = createStore();
    const storage = new LocalVolumeMediaStorage({ root: tempDir, baseUrl, client: null });
    const service = new CollectionsService(store, storage);

    await expect(
      service.create(
        { name: "Fake Image" },
        undefined,
        { buffer: Buffer.from("not a real jpeg"), mimetype: "image/jpeg", size: 15 } as Express.Multer.File,
      ),
    ).rejects.toMatchObject({
      statusCode: 422,
      code: "MEDIA_FILE_INVALID",
    });
  });

  it("9. >8MB rejected", async () => {
    const app = createApp();
    const largeBuffer = Buffer.alloc(8 * 1024 * 1024 + 1024);

    const res = await request(app)
      .post("/api/v1/admin/collections")
      .set("Authorization", "Bearer admin")
      .field("data", JSON.stringify({ name: "Too Large" }))
      .attach("image", largeBuffer, { filename: "too-large.jpg", contentType: "image/jpeg" });

    expect(res.status).toBe(413);
    expect(res.body.success).toBe(false);
    expect(res.body.error.code).toBe("MEDIA_FILE_TOO_LARGE");
  });

  it("10. collection image stored under collections/", async () => {
    const storage = new LocalVolumeMediaStorage({ root: tempDir, baseUrl, client: null });
    const uploaded = await storage.upload(
      { buffer: webpBytes, mimetype: "image/webp" },
      { folder: "shoozy/collections" },
    );

    expect(uploaded.key.startsWith("collections/")).toBe(true);
    const fullPath = path.join(tempDir, uploaded.key);
    expect(fs.existsSync(fullPath)).toBe(true);
    expect(fs.readFileSync(fullPath)).toEqual(webpBytes);
  });

  it("11. public URL contains /uploads/collections/", async () => {
    const storage = new LocalVolumeMediaStorage({ root: tempDir, baseUrl, client: null });
    const uploaded = await storage.upload(
      { buffer: jpegBytes, mimetype: "image/jpeg" },
      { folder: "collections" },
    );

    expect(uploaded.url).toContain("/uploads/collections/");
    expect(uploaded.url).toMatch(/^https:\/\/.*\/uploads\/collections\/[a-f0-9-]+\.jpg$/);
  });

  it("12. replacing local image deletes old owned image", async () => {
    const store = createStore();
    const storage = new LocalVolumeMediaStorage({ root: tempDir, baseUrl, client: null });
    const service = new CollectionsService(store, storage);

    // 1. Create with first image
    const initial = await service.create(
      { name: "Drop 1" },
      undefined,
      { buffer: jpegBytes, mimetype: "image/jpeg", size: jpegBytes.length } as Express.Multer.File,
    );
    const oldFilename = path.basename(new URL(initial.imageUrl!).pathname);
    const oldPath = path.join(tempDir, "collections", oldFilename);
    expect(fs.existsSync(oldPath)).toBe(true);

    // 2. Update with second image
    const updated = await service.update(
      initial.id,
      { name: "Drop 1 Updated" },
      undefined,
      { buffer: pngBytes, mimetype: "image/png", size: pngBytes.length } as Express.Multer.File,
    );

    const newFilename = path.basename(new URL(updated.imageUrl!).pathname);
    const newPath = path.join(tempDir, "collections", newFilename);

    expect(fs.existsSync(newPath)).toBe(true);
    // Old file must have been deleted
    expect(fs.existsSync(oldPath)).toBe(false);
  });

  it("13. DB failure cleans newly uploaded image on create and update", async () => {
    const store = createStore();
    const storage = new LocalVolumeMediaStorage({ root: tempDir, baseUrl, client: null });
    const service = new CollectionsService(store, storage);

    // Make create throw DB error (e.g. duplicate slug)
    vi.mocked(store.create).mockRejectedValueOnce(new CollectionsRepositoryError("DUPLICATE_SLUG"));

    const filesBefore = fs.existsSync(path.join(tempDir, "collections"))
      ? fs.readdirSync(path.join(tempDir, "collections"))
      : [];

    await expect(
      service.create(
        { name: "Slug Conflict" },
        undefined,
        { buffer: jpegBytes, mimetype: "image/jpeg", size: jpegBytes.length } as Express.Multer.File,
      ),
    ).rejects.toMatchObject({
      statusCode: 409,
      code: "COLLECTION_SLUG_ALREADY_EXISTS",
    });

    const filesAfter = fs.readdirSync(path.join(tempDir, "collections"));
    expect(filesAfter).toEqual(filesBefore);

    // Test on update DB failure
    const existing = await service.create({ name: "Valid Before Update Fail" });
    vi.mocked(store.update).mockRejectedValueOnce(new CollectionsRepositoryError("INVALID_DATE_RANGE"));

    await expect(
      service.update(
        existing.id,
        { name: "Will Fail" },
        undefined,
        { buffer: pngBytes, mimetype: "image/png", size: pngBytes.length } as Express.Multer.File,
      ),
    ).rejects.toMatchObject({
      statusCode: 400,
      code: "COLLECTION_DATE_RANGE_INVALID",
    });

    const filesAfterUpdateFail = fs.readdirSync(path.join(tempDir, "collections"));
    expect(filesAfterUpdateFail).toEqual(filesAfter);
  });

  it("14. deleting collection safely deletes owned local image", async () => {
    const store = createStore();
    const storage = new LocalVolumeMediaStorage({ root: tempDir, baseUrl, client: null });
    const service = new CollectionsService(store, storage);

    const created = await service.create(
      { name: "To Be Deleted" },
      undefined,
      { buffer: webpBytes, mimetype: "image/webp", size: webpBytes.length } as Express.Multer.File,
    );

    const filename = path.basename(new URL(created.imageUrl!).pathname);
    const diskPath = path.join(tempDir, "collections", filename);
    expect(fs.existsSync(diskPath)).toBe(true);

    await service.delete(created.id);

    expect(fs.existsSync(diskPath)).toBe(false);
    expect(store.delete).toHaveBeenCalledWith(created.id);
  });

  it("15. external image URLs are never filesystem-deleted", async () => {
    const store = createStore();
    const storage = new LocalVolumeMediaStorage({ root: tempDir, baseUrl, client: null });
    const service = new CollectionsService(store, storage);

    // Package.json serves as our Canary file
    const canaryPath = path.resolve(process.cwd(), "package.json");
    expect(fs.existsSync(canaryPath)).toBe(true);

    const externalUrl = "https://images.unsplash.com/photo-1542291026-7eec264c27ff";
    const created = await service.create({
      name: "External Image Item",
      imageUrl: externalUrl,
    });

    // Delete collection with external image: canary file and filesystem unaffected
    await service.delete(created.id);
    expect(fs.existsSync(canaryPath)).toBe(true);

    // Update collection with external image to new local image: external URL ignored, new image saved
    const created2 = await service.create({
      name: "External To Local",
      imageUrl: "https://res.cloudinary.com/shoozy/image/upload/v1/demo.jpg",
    });

    const updated = await service.update(
      created2.id,
      { name: "Now Local" },
      undefined,
      { buffer: jpegBytes, mimetype: "image/jpeg", size: jpegBytes.length } as Express.Multer.File,
    );

    expect(updated.imageUrl).toMatch(new RegExp(`^${baseUrl}/collections/[a-f0-9-]+\\.jpg$`));
    const newFilename = path.basename(new URL(updated.imageUrl!).pathname);
    expect(fs.existsSync(path.join(tempDir, "collections", newFilename))).toBe(true);
    expect(fs.existsSync(canaryPath)).toBe(true);
  });

  it("16. static /uploads route serves uploaded collection files automatically", async () => {
    const app = createApp();

    // Write a test image into tempDir/collections/static-test.jpg
    const colDir = path.join(tempDir, "collections");
    fs.mkdirSync(colDir, { recursive: true });
    fs.writeFileSync(path.join(colDir, "static-test.jpg"), jpegBytes);

    const response = await request(app).get("/uploads/collections/static-test.jpg");
    expect(response.status).toBe(200);
    expect(response.headers["content-type"]).toContain("image/jpeg");
    expect(response.headers["cross-origin-resource-policy"]).toBe("cross-origin");
    expect(response.body).toEqual(jpegBytes);
  });

  it("17. creates a collection with an owned MP4 while preserving the image fallback", async () => {
    const store = createStore();
    const service = new CollectionsService(store, new LocalVolumeMediaStorage({ root: tempDir, baseUrl, client: null }));
    const result = await service.create(
      { name: "Animated Drop" },
      undefined,
      { buffer: jpegBytes, mimetype: "image/jpeg", size: jpegBytes.length } as Express.Multer.File,
      { buffer: mp4Bytes, mimetype: "video/mp4", size: mp4Bytes.length } as Express.Multer.File,
    );

    expect(result.imageUrl).toMatch(/\/collections\/.+\.jpg$/);
    expect(result.videoUrl).toMatch(/\/collections\/.+\.mp4$/);
    expect(result.videoMimeType).toBe("video/mp4");
    const persisted = store.collections.get(result.id)!;
    expect(persisted).toMatchObject({ videoMimeType: "video/mp4", videoStorageProvider: "LOCAL" });
    expect(persisted.videoStorageKey).toMatch(/^collections\/.+\.mp4$/);
    expect(result).not.toHaveProperty("videoStorageKey");
    expect(result).not.toHaveProperty("videoStorageProvider");
  });

  it("18. rejects invalid and oversized collection videos", async () => {
    const service = new CollectionsService(createStore(), new LocalVolumeMediaStorage({ root: tempDir, baseUrl, client: null }));
    await expect(service.create({ name: "Bad Video" }, undefined, undefined, {
      buffer: jpegBytes, mimetype: "video/mp4", size: jpegBytes.length,
    } as Express.Multer.File)).rejects.toMatchObject({ code: "MEDIA_FILE_INVALID" });
    await expect(service.create({ name: "Too Large" }, undefined, undefined, {
      buffer: mp4Bytes, mimetype: "video/mp4", size: 50 * 1024 * 1024 + 1,
    } as Express.Multer.File)).rejects.toMatchObject({ statusCode: 413, code: "MEDIA_VIDEO_TOO_LARGE" });
  });

  it("19. replaces, removes, and deletes owned collection videos only after persistence succeeds", async () => {
    const store = createStore();
    const service = new CollectionsService(store, new LocalVolumeMediaStorage({ root: tempDir, baseUrl, client: null }));
    const created = await service.create({ name: "Motion" }, undefined, undefined, {
      buffer: mp4Bytes, mimetype: "video/mp4", size: mp4Bytes.length,
    } as Express.Multer.File);
    const oldPath = path.join(tempDir, store.collections.get(created.id)!.videoStorageKey!);
    expect(fs.existsSync(oldPath)).toBe(true);

    const replaced = await service.update(created.id, { name: "Motion Two" }, undefined, undefined, {
      buffer: mp4Bytes, mimetype: "video/mp4", size: mp4Bytes.length,
    } as Express.Multer.File);
    const newPath = path.join(tempDir, store.collections.get(created.id)!.videoStorageKey!);
    expect(replaced.videoUrl).not.toBe(created.videoUrl);
    expect(fs.existsSync(oldPath)).toBe(false);
    expect(fs.existsSync(newPath)).toBe(true);

    const removed = await service.update(created.id, { removeVideo: true });
    expect(removed).toMatchObject({ videoUrl: null, videoMimeType: null });
    expect(store.collections.get(created.id)).toMatchObject({
      videoUrl: null, videoMimeType: null, videoStorageProvider: null, videoStorageKey: null,
    });
    expect(fs.existsSync(newPath)).toBe(false);

    const deletable = await service.create({ name: "Delete Motion" }, undefined, undefined, {
      buffer: mp4Bytes, mimetype: "video/mp4", size: mp4Bytes.length,
    } as Express.Multer.File);
    const deletePath = path.join(tempDir, store.collections.get(deletable.id)!.videoStorageKey!);
    await service.delete(deletable.id);
    expect(fs.existsSync(deletePath)).toBe(false);
  });

  it("20. cleans a newly uploaded collection video when the database update fails", async () => {
    const store = createStore();
    const service = new CollectionsService(store, new LocalVolumeMediaStorage({ root: tempDir, baseUrl, client: null }));
    const created = await service.create({ name: "Stable Motion" }, undefined, undefined, {
      buffer: mp4Bytes, mimetype: "video/mp4", size: mp4Bytes.length,
    } as Express.Multer.File);
    const oldKey = store.collections.get(created.id)!.videoStorageKey!;
    vi.mocked(store.update).mockRejectedValueOnce(new Error("database unavailable"));
    const before = fs.readdirSync(path.join(tempDir, "collections")).sort();

    await expect(service.update(created.id, { name: "Failed" }, undefined, undefined, {
      buffer: mp4Bytes, mimetype: "video/mp4", size: mp4Bytes.length,
    } as Express.Multer.File)).rejects.toThrow("database unavailable");

    expect(fs.readdirSync(path.join(tempDir, "collections")).sort()).toEqual(before);
    expect(fs.existsSync(path.join(tempDir, oldKey))).toBe(true);
    expect(store.collections.get(created.id)!.videoStorageKey).toBe(oldKey);
  });

  it("21. accepts image and video together through the existing multipart route", async () => {
    const createSpy = vi.spyOn(CollectionsService.prototype, "create").mockImplementation(async (input, _actorId, image, video) => ({
      id: randomUUID(), name: input.name, slug: "route-video", description: null,
      imageUrl: image ? `${baseUrl}/collections/route.jpg` : null,
      videoUrl: video ? `${baseUrl}/collections/route.mp4` : null, videoMimeType: video ? "video/mp4" : null,
      isActive: true, startsAt: null, endsAt: null, createdAt: new Date(), updatedAt: new Date(), productCount: 0, translations: {},
    }));
    const response = await request(createApp())
      .post("/api/v1/admin/collections")
      .set("Authorization", "Bearer admin")
      .field("data", JSON.stringify({ name: "Route Video" }))
      .attach("image", jpegBytes, { filename: "route.jpg", contentType: "image/jpeg" })
      .attach("video", mp4Bytes, { filename: "route.mp4", contentType: "video/mp4" });

    expect(response.status).toBe(201);
    expect(response.body.data).toMatchObject({ videoMimeType: "video/mp4" });
    expect(createSpy).toHaveBeenCalledWith(expect.any(Object), undefined, expect.objectContaining({ fieldname: "image" }), expect.objectContaining({ fieldname: "video" }));
  });
});
