import fs from "node:fs";
import os from "node:os";
import path from "node:path";
import { randomUUID } from "node:crypto";
import type { RequestHandler } from "express";
import request from "supertest";
import { afterAll, beforeAll, beforeEach, describe, expect, it, vi } from "vitest";
import { createApp } from "../../src/app";
import { LocalVolumeMediaStorage } from "../../src/modules/products/media-storage";
import { CategoriesService, type CategoriesStore } from "../../src/modules/categories/categories.service";
import { CategoriesRepositoryError } from "../../src/modules/categories/categories.repository";
import type { CategoryRecord } from "../../src/modules/categories/categories.types";
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

describe("Category Image Upload Architecture", () => {
  let tempDir: string;
  let baseUrl: string;
  let originalLocalPath: string | undefined;
  let originalBaseUrl: string | undefined;
  let originalDriver: string | undefined;

  const jpegBytes = Buffer.from([0xff, 0xd8, 0xff, 0xe0, 0x00, 0x10, 0x4a, 0x46, 0x49, 0x46]);
  const pngBytes = Buffer.from([137, 80, 78, 71, 13, 10, 26, 10, 0, 0, 0, 13]);
  const webpBytes = Buffer.from("RIFF\x1a\x00\x00\x00WEBPVP8 \x0e\x00\x00\x00");
  const mp4Bytes = Buffer.from([0, 0, 0, 20, 0x66, 0x74, 0x79, 0x70, 0x69, 0x73, 0x6f, 0x6d, 0, 0, 0, 0, 0x69, 0x73, 0x6f, 0x6d]);

  function createStore(): CategoriesStore & { categories: Map<string, CategoryRecord> } {
    const categories = new Map<string, CategoryRecord>();
    return {
      categories,
      list: vi.fn(async () => ({ items: Array.from(categories.values()), total: categories.size })),
      listAll: vi.fn(async () => Array.from(categories.values())),
      listParentLinks: vi.fn(async () => Array.from(categories.values()).map((c) => ({ id: c.id, parentId: c.parentId }))),
      findById: vi.fn(async (id: string) => categories.get(id) ?? null),
      create: vi.fn(async (input) => {
        const id = randomUUID();
        const rec: CategoryRecord = {
          id,
          parentId: input.parentId ?? null,
          name: input.name,
          slug: input.slug,
          description: input.description ?? null,
          imageUrl: input.imageUrl ?? null,
          videoUrl: input.videoUrl ?? null,
          videoMimeType: input.videoMimeType ?? null,
          videoStorageProvider: input.videoStorageProvider ?? null,
          videoStorageKey: input.videoStorageKey ?? null,
          sortOrder: input.sortOrder ?? 0,
          isActive: input.isActive ?? true,
          createdAt: new Date(),
          updatedAt: new Date(),
          _count: { productCategories: 0 },
          translations: [],
        };
        categories.set(id, rec);
        return rec;
      }),
      update: vi.fn(async (id, input) => {
        const existing = categories.get(id);
        if (!existing) return "NOT_FOUND";
        const updated: CategoryRecord = {
          ...existing,
          ...(input.parentId !== undefined ? { parentId: input.parentId } : {}),
          ...(input.name !== undefined ? { name: input.name } : {}),
          ...(input.slug !== undefined ? { slug: input.slug } : {}),
          ...(input.description !== undefined ? { description: input.description } : {}),
          ...(input.imageUrl !== undefined ? { imageUrl: input.imageUrl } : {}),
          ...(input.videoUrl !== undefined ? { videoUrl: input.videoUrl } : {}),
          ...(input.videoMimeType !== undefined ? { videoMimeType: input.videoMimeType } : {}),
          ...(input.videoStorageProvider !== undefined ? { videoStorageProvider: input.videoStorageProvider } : {}),
          ...(input.videoStorageKey !== undefined ? { videoStorageKey: input.videoStorageKey } : {}),
          ...(input.sortOrder !== undefined ? { sortOrder: input.sortOrder } : {}),
          ...(input.isActive !== undefined ? { isActive: input.isActive } : {}),
          updatedAt: new Date(),
        };
        categories.set(id, updated);
        return updated;
      }),
      deleteIfUnused: vi.fn(async (id: string) => {
        if (!categories.has(id)) return "NOT_FOUND";
        const hasChildren = Array.from(categories.values()).some((c) => c.parentId === id);
        if (hasChildren) return "HAS_CHILDREN";
        categories.delete(id);
        return "DELETED";
      }),
    };
  }

  beforeAll(() => {
    tempDir = fs.mkdtempSync(path.join(os.tmpdir(), "shoozy-category-test-"));
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

  it("1. JSON create still works", async () => {
    const store = createStore();
    const storage = new LocalVolumeMediaStorage({ root: tempDir, baseUrl, client: null });
    const service = new CategoriesService(store, storage);

    const result = await service.create({
      name: "Running Shoes",
      slug: "running-shoes",
      description: "Performance footwear",
    });

    expect(result.name).toBe("Running Shoes");
    expect(result.slug).toBe("running-shoes");
    expect(result.imageUrl).toBeNull();
    expect(store.create).toHaveBeenCalledWith(
      expect.objectContaining({
        name: "Running Shoes",
        imageUrl: null,
      }),
    );
  });

  it("2. JSON update still works", async () => {
    const store = createStore();
    const storage = new LocalVolumeMediaStorage({ root: tempDir, baseUrl, client: null });
    const service = new CategoriesService(store, storage);

    const created = await service.create({
      name: "Original Category",
      imageUrl: "https://example.com/original-cat.jpg",
    });

    const updated = await service.update(created.id, {
      name: "Updated Category Name",
    });

    expect(updated.name).toBe("Updated Category Name");
    expect(updated.imageUrl).toBe("https://example.com/original-cat.jpg");
  });

  it("3. JSON imageUrl still works", async () => {
    const store = createStore();
    const storage = new LocalVolumeMediaStorage({ root: tempDir, baseUrl, client: null });
    const service = new CategoriesService(store, storage);

    const result = await service.create({
      name: "Trail Shoes",
      imageUrl: "https://example.com/trail.png",
    });

    expect(result.name).toBe("Trail Shoes");
    expect(result.imageUrl).toBe("https://example.com/trail.png");
    expect(store.create).toHaveBeenCalledWith(
      expect.objectContaining({
        imageUrl: "https://example.com/trail.png",
      }),
    );
  });

  it("4. multipart create with image works", async () => {
    const store = createStore();
    const storage = new LocalVolumeMediaStorage({ root: tempDir, baseUrl, client: null });
    const service = new CategoriesService(store, storage);

    const result = await service.create(
      {
        name: "Sneakers",
      },
      { buffer: jpegBytes, mimetype: "image/jpeg", size: jpegBytes.length } as Express.Multer.File,
    );

    expect(result.name).toBe("Sneakers");
    expect(result.imageUrl).toMatch(new RegExp(`^${baseUrl}/categories/[a-f0-9-]+\\.jpg$`));
    const filename = path.basename(new URL(result.imageUrl!).pathname);
    const diskPath = path.join(tempDir, "categories", filename);
    expect(fs.existsSync(diskPath)).toBe(true);
    expect(fs.readFileSync(diskPath)).toEqual(jpegBytes);
  });

  it("5. multipart update with image works", async () => {
    const store = createStore();
    const storage = new LocalVolumeMediaStorage({ root: tempDir, baseUrl, client: null });
    const service = new CategoriesService(store, storage);

    const created = await service.create({ name: "Initial Category" });
    expect(created.imageUrl).toBeNull();

    const updated = await service.update(
      created.id,
      { name: "Updated Category" },
      { buffer: pngBytes, mimetype: "image/png", size: pngBytes.length } as Express.Multer.File,
    );

    expect(updated.name).toBe("Updated Category");
    expect(updated.imageUrl).toMatch(new RegExp(`^${baseUrl}/categories/[a-f0-9-]+\\.png$`));
    const filename = path.basename(new URL(updated.imageUrl!).pathname);
    const diskPath = path.join(tempDir, "categories", filename);
    expect(fs.existsSync(diskPath)).toBe(true);
    expect(fs.readFileSync(diskPath)).toEqual(pngBytes);
  });

  it("6. multipart data JSON is parsed correctly via HTTP route", async () => {
    const createSpy = vi.spyOn(CategoriesService.prototype, "create").mockImplementation(async (input, file) => {
      expect(file).toBeDefined();
      expect(file?.mimetype).toBe("image/jpeg");
      expect(file?.originalname).toBe("category.jpg");
      return {
        id: "11111111-1111-4111-8111-111111111111",
        parentId: null,
        name: input.name,
        slug: input.slug ?? "category-route-test",
        description: input.description ?? null,
        imageUrl: `${baseUrl}/categories/mock-cat.jpg`,
        sortOrder: 0,
        isActive: input.isActive ?? true,
        createdAt: new Date().toISOString(),
        updatedAt: new Date().toISOString(),
      } as never;
    });

    const app = createApp();
    const data = {
      name: "Lifestyle Footwear",
      slug: "category-route-test",
      description: "Everyday sneakers",
      isActive: true,
    };

    const res = await request(app)
      .post("/api/v1/admin/categories")
      .set("Authorization", "Bearer admin")
      .field("data", JSON.stringify(data))
      .attach("image", jpegBytes, { filename: "category.jpg", contentType: "image/jpeg" });

    expect(res.status).toBe(201);
    expect(res.body.success).toBe(true);
    expect(res.body.data.name).toBe("Lifestyle Footwear");
    expect(res.body.data.slug).toBe("category-route-test");
    expect(res.body.data.imageUrl).toBe(`${baseUrl}/categories/mock-cat.jpg`);
    expect(createSpy).toHaveBeenCalledWith(
      expect.objectContaining({
        name: "Lifestyle Footwear",
        slug: "category-route-test",
      }),
      expect.objectContaining({
        originalname: "category.jpg",
        mimetype: "image/jpeg",
      }),
    );
  });

  it("6b. multipart data JSON is parsed correctly on PATCH route", async () => {
    const updateSpy = vi.spyOn(CategoriesService.prototype, "update").mockImplementation(async (_id, input, file) => {
      expect(file).toBeDefined();
      expect(file?.mimetype).toBe("image/png");
      return {
        id: "11111111-1111-4111-8111-111111111111",
        parentId: null,
        name: input.name ?? "Updated Category",
        slug: "updated-category",
        description: input.description ?? null,
        imageUrl: `${baseUrl}/categories/mock-updated.png`,
        sortOrder: 0,
        isActive: true,
        createdAt: new Date().toISOString(),
        updatedAt: new Date().toISOString(),
      } as never;
    });

    const app = createApp();
    const data = {
      name: "Updated Category Name",
      description: "Updated description",
    };

    const res = await request(app)
      .patch("/api/v1/admin/categories/11111111-1111-4111-8111-111111111111")
      .set("Authorization", "Bearer admin")
      .field("data", JSON.stringify(data))
      .attach("image", pngBytes, { filename: "category.png", contentType: "image/png" });

    expect(res.status).toBe(200);
    expect(res.body.success).toBe(true);
    expect(res.body.data.name).toBe("Updated Category Name");
    expect(res.body.data.imageUrl).toBe(`${baseUrl}/categories/mock-updated.png`);
    expect(updateSpy).toHaveBeenCalledWith(
      "11111111-1111-4111-8111-111111111111",
      expect.objectContaining({
        name: "Updated Category Name",
      }),
      expect.objectContaining({
        originalname: "category.png",
        mimetype: "image/png",
      }),
    );
  });

  it("7. missing data returns controlled 422", async () => {
    const app = createApp();
    const res = await request(app)
      .post("/api/v1/admin/categories")
      .set("Authorization", "Bearer admin")
      .attach("image", jpegBytes, { filename: "missing-data.jpg", contentType: "image/jpeg" });

    expect(res.status).toBe(422);
    expect(res.body.success).toBe(false);
    expect(res.body.error.code).toBe("CATEGORY_DATA_REQUIRED");
  });

  it("8. malformed data JSON returns controlled 422", async () => {
    const app = createApp();
    const res = await request(app)
      .post("/api/v1/admin/categories")
      .set("Authorization", "Bearer admin")
      .field("data", "{ not valid json")
      .attach("image", jpegBytes, { filename: "malformed.jpg", contentType: "image/jpeg" });

    expect(res.status).toBe(422);
    expect(res.body.success).toBe(false);
    expect(res.body.error.code).toBe("CATEGORY_DATA_INVALID");
  });

  it("9. invalid MIME rejected", async () => {
    const app = createApp();
    const res = await request(app)
      .post("/api/v1/admin/categories")
      .set("Authorization", "Bearer admin")
      .field("data", JSON.stringify({ name: "Invalid MIME Category" }))
      .attach("image", Buffer.from("%PDF-1.4 test"), { filename: "document.pdf", contentType: "application/pdf" });

    expect(res.status).toBe(422);
    expect(res.body.success).toBe(false);
    expect(res.body.error.code).toBe("MEDIA_FILE_INVALID");
  });

  it("9b. corrupted image with fake MIME rejected by magic bytes check", async () => {
    const store = createStore();
    const storage = new LocalVolumeMediaStorage({ root: tempDir, baseUrl, client: null });
    const service = new CategoriesService(store, storage);

    await expect(
      service.create(
        { name: "Fake Image Category" },
        { buffer: Buffer.from("not a real jpeg"), mimetype: "image/jpeg", size: 15 } as Express.Multer.File,
      ),
    ).rejects.toMatchObject({
      statusCode: 422,
      code: "MEDIA_FILE_INVALID",
    });
  });

  it("10. >8MB rejected", async () => {
    const app = createApp();
    const largeBuffer = Buffer.alloc(8 * 1024 * 1024 + 1024);

    const res = await request(app)
      .post("/api/v1/admin/categories")
      .set("Authorization", "Bearer admin")
      .field("data", JSON.stringify({ name: "Too Large Category" }))
      .attach("image", largeBuffer, { filename: "too-large.jpg", contentType: "image/jpeg" });

    expect(res.status).toBe(413);
    expect(res.body.success).toBe(false);
    expect(res.body.error.code).toBe("MEDIA_FILE_TOO_LARGE");
  });

  it("11. category image stored under categories/", async () => {
    const storage = new LocalVolumeMediaStorage({ root: tempDir, baseUrl, client: null });
    const uploaded = await storage.upload(
      { buffer: webpBytes, mimetype: "image/webp" },
      { folder: "shoozy/categories" },
    );

    expect(uploaded.key.startsWith("categories/")).toBe(true);
    const fullPath = path.join(tempDir, uploaded.key);
    expect(fs.existsSync(fullPath)).toBe(true);
    expect(fs.readFileSync(fullPath)).toEqual(webpBytes);
  });

  it("12. public URL contains /uploads/categories/", async () => {
    const storage = new LocalVolumeMediaStorage({ root: tempDir, baseUrl, client: null });
    const uploaded = await storage.upload(
      { buffer: jpegBytes, mimetype: "image/jpeg" },
      { folder: "categories" },
    );

    expect(uploaded.url).toContain("/uploads/categories/");
    expect(uploaded.url).toMatch(/^https:\/\/.*\/uploads\/categories\/[a-f0-9-]+\.jpg$/);
  });

  it("13. replacing local image deletes old owned image", async () => {
    const store = createStore();
    const storage = new LocalVolumeMediaStorage({ root: tempDir, baseUrl, client: null });
    const service = new CategoriesService(store, storage);

    // 1. Create with first image
    const initial = await service.create(
      { name: "Category 1" },
      { buffer: jpegBytes, mimetype: "image/jpeg", size: jpegBytes.length } as Express.Multer.File,
    );
    const oldFilename = path.basename(new URL(initial.imageUrl!).pathname);
    const oldPath = path.join(tempDir, "categories", oldFilename);
    expect(fs.existsSync(oldPath)).toBe(true);

    // 2. Update with second image
    const updated = await service.update(
      initial.id,
      { name: "Category 1 Updated" },
      { buffer: pngBytes, mimetype: "image/png", size: pngBytes.length } as Express.Multer.File,
    );

    const newFilename = path.basename(new URL(updated.imageUrl!).pathname);
    const newPath = path.join(tempDir, "categories", newFilename);

    expect(fs.existsSync(newPath)).toBe(true);
    // Old file must have been deleted
    expect(fs.existsSync(oldPath)).toBe(false);
  });

  it("14. DB failure cleans newly uploaded image on create and update", async () => {
    const store = createStore();
    const storage = new LocalVolumeMediaStorage({ root: tempDir, baseUrl, client: null });
    const service = new CategoriesService(store, storage);

    // Make create throw DB error (e.g. duplicate slug)
    vi.mocked(store.create).mockRejectedValueOnce(new CategoriesRepositoryError("DUPLICATE_SLUG"));

    const filesBefore = fs.existsSync(path.join(tempDir, "categories"))
      ? fs.readdirSync(path.join(tempDir, "categories"))
      : [];

    await expect(
      service.create(
        { name: "Slug Conflict Category" },
        { buffer: jpegBytes, mimetype: "image/jpeg", size: jpegBytes.length } as Express.Multer.File,
      ),
    ).rejects.toMatchObject({
      statusCode: 409,
      code: "CATEGORY_SLUG_ALREADY_EXISTS",
    });

    const filesAfter = fs.readdirSync(path.join(tempDir, "categories"));
    expect(filesAfter).toEqual(filesBefore);

    // Test on update DB failure
    const existing = await service.create({ name: "Valid Category Before Update Fail" });
    vi.mocked(store.update).mockRejectedValueOnce(new CategoriesRepositoryError("DUPLICATE_SLUG"));

    await expect(
      service.update(
        existing.id,
        { name: "Will Fail Category" },
        { buffer: pngBytes, mimetype: "image/png", size: pngBytes.length } as Express.Multer.File,
      ),
    ).rejects.toMatchObject({
      statusCode: 409,
      code: "CATEGORY_SLUG_ALREADY_EXISTS",
    });

    const filesAfterUpdateFail = fs.readdirSync(path.join(tempDir, "categories"));
    expect(filesAfterUpdateFail).toEqual(filesAfter);
  });

  it("15. external image URLs are never filesystem-deleted", async () => {
    const store = createStore();
    const storage = new LocalVolumeMediaStorage({ root: tempDir, baseUrl, client: null });
    const service = new CategoriesService(store, storage);

    const canaryPath = path.resolve(process.cwd(), "package.json");
    expect(fs.existsSync(canaryPath)).toBe(true);

    const externalUrl = "https://images.unsplash.com/photo-1542291026-7eec264c27ff";
    const created = await service.create({
      name: "External Image Category",
      imageUrl: externalUrl,
    });

    // Delete category with external image: canary file and filesystem unaffected
    await service.delete(created.id);
    expect(fs.existsSync(canaryPath)).toBe(true);

    // Update category with external image to new local image: external URL ignored, new image saved
    const created2 = await service.create({
      name: "External To Local Category",
      imageUrl: "https://res.cloudinary.com/shoozy/image/upload/v1/demo.jpg",
    });

    const updated = await service.update(
      created2.id,
      { name: "Now Local Category" },
      { buffer: jpegBytes, mimetype: "image/jpeg", size: jpegBytes.length } as Express.Multer.File,
    );

    expect(updated.imageUrl).toMatch(new RegExp(`^${baseUrl}/categories/[a-f0-9-]+\\.jpg$`));
    const newFilename = path.basename(new URL(updated.imageUrl!).pathname);
    expect(fs.existsSync(path.join(tempDir, "categories", newFilename))).toBe(true);
    expect(fs.existsSync(canaryPath)).toBe(true);
  });

  it("16. hierarchy behavior remains unchanged (root, child, and cycle checks)", async () => {
    const store = createStore();
    const storage = new LocalVolumeMediaStorage({ root: tempDir, baseUrl, client: null });
    const service = new CategoriesService(store, storage);

    // 1. Root category
    const root = await service.create({ name: "Men" });
    expect(root.parentId).toBeNull();

    // 2. Child category
    const child = await service.create({ name: "Shoes", parentId: root.id });
    expect(child.parentId).toBe(root.id);

    // 3. Invalid parentId throws 404
    await expect(
      service.create({ name: "Orphan", parentId: "99999999-9999-4999-8999-999999999999" }),
    ).rejects.toMatchObject({
      statusCode: 404,
      code: "CATEGORY_PARENT_NOT_FOUND",
    });

    // 4. Cannot delete category with children
    await expect(service.delete(root.id)).rejects.toMatchObject({
      statusCode: 409,
      code: "CATEGORY_HAS_CHILDREN",
    });

    // 5. Deleting leaf category succeeds and deletes local image
    const leaf = await service.create(
      { name: "Boots", parentId: root.id },
      { buffer: webpBytes, mimetype: "image/webp", size: webpBytes.length } as Express.Multer.File,
    );
    const leafFilename = path.basename(new URL(leaf.imageUrl!).pathname);
    const leafPath = path.join(tempDir, "categories", leafFilename);
    expect(fs.existsSync(leafPath)).toBe(true);

    await service.delete(leaf.id);
    expect(fs.existsSync(leafPath)).toBe(false);
  });

  it("17. static /uploads route serves uploaded category files automatically, returns 404 for missing", async () => {
    const app = createApp();

    // Write a test image into tempDir/categories/cat-test.jpg
    const catDir = path.join(tempDir, "categories");
    fs.mkdirSync(catDir, { recursive: true });
    fs.writeFileSync(path.join(catDir, "cat-test.jpg"), jpegBytes);

    const response = await request(app).get("/uploads/categories/cat-test.jpg");
    expect(response.status).toBe(200);
    expect(response.headers["content-type"]).toContain("image/jpeg");
    expect(response.headers["cross-origin-resource-policy"]).toBe("cross-origin");
    expect(response.body).toEqual(jpegBytes);

    // Missing file returns 404
    const notFoundResponse = await request(app).get("/uploads/categories/nonexistent-image.jpg");
    expect(notFoundResponse.status).toBe(404);
  });

  it("18. creates a category with an owned MP4 while preserving the image fallback", async () => {
    const store = createStore();
    const service = new CategoriesService(store, new LocalVolumeMediaStorage({ root: tempDir, baseUrl, client: null }));
    const result = await service.create(
      { name: "Animated Sneakers" },
      { buffer: jpegBytes, mimetype: "image/jpeg", size: jpegBytes.length } as Express.Multer.File,
      { buffer: mp4Bytes, mimetype: "video/mp4", size: mp4Bytes.length } as Express.Multer.File,
    );

    expect(result.imageUrl).toMatch(/\/categories\/.+\.jpg$/);
    expect(result.videoUrl).toMatch(/\/categories\/.+\.mp4$/);
    expect(result.videoMimeType).toBe("video/mp4");
    const persisted = store.categories.get(result.id)!;
    expect(persisted).toMatchObject({ videoMimeType: "video/mp4", videoStorageProvider: "LOCAL" });
    expect(persisted.videoStorageKey).toMatch(/^categories\/.+\.mp4$/);
    expect(result).not.toHaveProperty("videoStorageKey");
    expect(result).not.toHaveProperty("videoStorageProvider");
  });

  it("19. rejects invalid and oversized category videos", async () => {
    const service = new CategoriesService(createStore(), new LocalVolumeMediaStorage({ root: tempDir, baseUrl, client: null }));
    await expect(service.create({ name: "Bad Video" }, undefined, {
      buffer: jpegBytes, mimetype: "video/mp4", size: jpegBytes.length,
    } as Express.Multer.File)).rejects.toMatchObject({ code: "MEDIA_FILE_INVALID" });
    await expect(service.create({ name: "Too Large" }, undefined, {
      buffer: mp4Bytes, mimetype: "video/mp4", size: 50 * 1024 * 1024 + 1,
    } as Express.Multer.File)).rejects.toMatchObject({ statusCode: 413, code: "MEDIA_VIDEO_TOO_LARGE" });
  });

  it("20. replaces, removes, and deletes owned category videos only after persistence succeeds", async () => {
    const store = createStore();
    const service = new CategoriesService(store, new LocalVolumeMediaStorage({ root: tempDir, baseUrl, client: null }));
    const created = await service.create({ name: "Motion" }, undefined, {
      buffer: mp4Bytes, mimetype: "video/mp4", size: mp4Bytes.length,
    } as Express.Multer.File);
    const oldPath = path.join(tempDir, store.categories.get(created.id)!.videoStorageKey!);
    expect(fs.existsSync(oldPath)).toBe(true);

    const replaced = await service.update(created.id, { name: "Motion Two" }, undefined, {
      buffer: mp4Bytes, mimetype: "video/mp4", size: mp4Bytes.length,
    } as Express.Multer.File);
    const newPath = path.join(tempDir, store.categories.get(created.id)!.videoStorageKey!);
    expect(replaced.videoUrl).not.toBe(created.videoUrl);
    expect(fs.existsSync(oldPath)).toBe(false);
    expect(fs.existsSync(newPath)).toBe(true);

    const removed = await service.update(created.id, { removeVideo: true });
    expect(removed).toMatchObject({ videoUrl: null, videoMimeType: null });
    expect(store.categories.get(created.id)).toMatchObject({
      videoUrl: null, videoMimeType: null, videoStorageProvider: null, videoStorageKey: null,
    });
    expect(fs.existsSync(newPath)).toBe(false);

    const deletable = await service.create({ name: "Delete Motion" }, undefined, {
      buffer: mp4Bytes, mimetype: "video/mp4", size: mp4Bytes.length,
    } as Express.Multer.File);
    const deletePath = path.join(tempDir, store.categories.get(deletable.id)!.videoStorageKey!);
    await service.delete(deletable.id);
    expect(fs.existsSync(deletePath)).toBe(false);
  });

  it("21. cleans a newly uploaded category video when the database update fails", async () => {
    const store = createStore();
    const service = new CategoriesService(store, new LocalVolumeMediaStorage({ root: tempDir, baseUrl, client: null }));
    const created = await service.create({ name: "Stable Motion" }, undefined, {
      buffer: mp4Bytes, mimetype: "video/mp4", size: mp4Bytes.length,
    } as Express.Multer.File);
    const oldKey = store.categories.get(created.id)!.videoStorageKey!;
    vi.mocked(store.update).mockRejectedValueOnce(new Error("database unavailable"));
    const before = fs.readdirSync(path.join(tempDir, "categories")).sort();

    await expect(service.update(created.id, { name: "Failed" }, undefined, {
      buffer: mp4Bytes, mimetype: "video/mp4", size: mp4Bytes.length,
    } as Express.Multer.File)).rejects.toThrow("database unavailable");

    expect(fs.readdirSync(path.join(tempDir, "categories")).sort()).toEqual(before);
    expect(fs.existsSync(path.join(tempDir, oldKey))).toBe(true);
    expect(store.categories.get(created.id)!.videoStorageKey).toBe(oldKey);
  });

  it("22. accepts image and video together through the existing multipart route", async () => {
    const createSpy = vi.spyOn(CategoriesService.prototype, "create").mockImplementation(async (input, image, video) => ({
      id: randomUUID(), parentId: null, name: input.name, slug: "route-video", description: null,
      imageUrl: image ? `${baseUrl}/categories/route.jpg` : null,
      videoUrl: video ? `${baseUrl}/categories/route.mp4` : null, videoMimeType: video ? "video/mp4" : null,
      sortOrder: 0, isActive: true, createdAt: new Date(), updatedAt: new Date(), productCount: 0, translations: {},
    }));
    const response = await request(createApp())
      .post("/api/v1/admin/categories")
      .set("Authorization", "Bearer admin")
      .field("data", JSON.stringify({ name: "Route Video" }))
      .attach("image", jpegBytes, { filename: "route.jpg", contentType: "image/jpeg" })
      .attach("video", mp4Bytes, { filename: "route.mp4", contentType: "video/mp4" });

    expect(response.status).toBe(201);
    expect(response.body.data).toMatchObject({ videoMimeType: "video/mp4" });
    expect(createSpy).toHaveBeenCalledWith(expect.any(Object), expect.objectContaining({ fieldname: "image" }), expect.objectContaining({ fieldname: "video" }));
  });
});
