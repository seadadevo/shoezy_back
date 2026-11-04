import fs from "node:fs";
import os from "node:os";
import path from "node:path";
import { randomUUID } from "node:crypto";
import type { RequestHandler } from "express";
import request from "supertest";
import { afterAll, beforeAll, beforeEach, describe, expect, it, vi } from "vitest";
import { createApp } from "../../src/app";
import { LocalVolumeMediaStorage } from "../../src/modules/products/media-storage";
import { BrandsService, type BrandsStore } from "../../src/modules/brands/brands.service";
import { BrandsRepositoryError } from "../../src/modules/brands/brands.repository";
import type { BrandRecord } from "../../src/modules/brands/brands.types";
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

describe("Brand Image Upload Architecture", () => {
  let tempDir: string;
  let baseUrl: string;
  let originalLocalPath: string | undefined;
  let originalBaseUrl: string | undefined;
  let originalDriver: string | undefined;

  const jpegBytes = Buffer.from([0xff, 0xd8, 0xff, 0xe0, 0x00, 0x10, 0x4a, 0x46, 0x49, 0x46]);
  const pngBytes = Buffer.from([137, 80, 78, 71, 13, 10, 26, 10, 0, 0, 0, 13]);
  const webpBytes = Buffer.from("RIFF\x1a\x00\x00\x00WEBPVP8 \x0e\x00\x00\x00");

  function createStore(): BrandsStore & { brands: Map<string, BrandRecord> } {
    const brands = new Map<string, BrandRecord>();
    return {
      brands,
      list: vi.fn(async () => ({ items: Array.from(brands.values()), total: brands.size })),
      findById: vi.fn(async (id: string) => brands.get(id) ?? null),
      create: vi.fn(async (input) => {
        const id = randomUUID();
        const rec: BrandRecord = {
          id,
          name: input.name,
          slug: input.slug,
          description: input.description ?? null,
          logoUrl: input.logoUrl ?? null,
          showcaseImageUrl: input.showcaseImageUrl ?? null,
          isActive: input.isActive ?? true,
          createdAt: new Date(),
          updatedAt: new Date(),
          _count: { products: 0 },
          translations: [],
        };
        brands.set(id, rec);
        return rec;
      }),
      update: vi.fn(async (id, input) => {
        const existing = brands.get(id);
        if (!existing) return "NOT_FOUND";
        const updated: BrandRecord = {
          ...existing,
          ...(input.name !== undefined ? { name: input.name } : {}),
          ...(input.slug !== undefined ? { slug: input.slug } : {}),
          ...(input.description !== undefined ? { description: input.description } : {}),
          ...(input.logoUrl !== undefined ? { logoUrl: input.logoUrl } : {}),
          ...(input.showcaseImageUrl !== undefined ? { showcaseImageUrl: input.showcaseImageUrl } : {}),
          ...(input.isActive !== undefined ? { isActive: input.isActive } : {}),
          updatedAt: new Date(),
        };
        brands.set(id, updated);
        return updated;
      }),
      deleteIfUnused: vi.fn(async (id: string) => {
        if (!brands.has(id)) return "NOT_FOUND";
        brands.delete(id);
        return "DELETED";
      }),
    };
  }

  beforeAll(() => {
    tempDir = fs.mkdtempSync(path.join(os.tmpdir(), "shoozy-brand-test-"));
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
    const service = new BrandsService(store, storage);

    const result = await service.create({
      name: "Classic JSON Brand",
      slug: "classic-json-brand",
      description: "No logo provided",
    });

    expect(result.name).toBe("Classic JSON Brand");
    expect(result.slug).toBe("classic-json-brand");
    expect(result.logoUrl).toBeNull();
    expect(store.create).toHaveBeenCalledWith(
      expect.objectContaining({
        name: "Classic JSON Brand",
        logoUrl: null,
      }),
    );
  });

  it("2. JSON update still works", async () => {
    const store = createStore();
    const storage = new LocalVolumeMediaStorage({ root: tempDir, baseUrl, client: null });
    const service = new BrandsService(store, storage);

    const created = await service.create({
      name: "Original Brand",
      logoUrl: "https://example.com/original-logo.jpg",
    });

    const updated = await service.update(created.id, {
      name: "Updated Brand Name",
    });

    expect(updated.name).toBe("Updated Brand Name");
    expect(updated.logoUrl).toBe("https://example.com/original-logo.jpg");
  });

  it("3. JSON manual image URL still works", async () => {
    const store = createStore();
    const storage = new LocalVolumeMediaStorage({ root: tempDir, baseUrl, client: null });
    const service = new BrandsService(store, storage);

    const result = await service.create({
      name: "Manual URL Brand",
      logoUrl: "https://example.com/manual-logo.png",
    });

    expect(result.name).toBe("Manual URL Brand");
    expect(result.logoUrl).toBe("https://example.com/manual-logo.png");
    expect(store.create).toHaveBeenCalledWith(
      expect.objectContaining({
        logoUrl: "https://example.com/manual-logo.png",
      }),
    );
  });

  it("4. multipart create with image works", async () => {
    const store = createStore();
    const storage = new LocalVolumeMediaStorage({ root: tempDir, baseUrl, client: null });
    const service = new BrandsService(store, storage);

    const result = await service.create(
      {
        name: "Nike Sports",
      },
      { buffer: jpegBytes, mimetype: "image/jpeg", size: jpegBytes.length } as Express.Multer.File,
    );

    expect(result.name).toBe("Nike Sports");
    expect(result.logoUrl).toMatch(new RegExp(`^${baseUrl}/brands/[a-f0-9-]+\\.jpg$`));
    const filename = path.basename(new URL(result.logoUrl!).pathname);
    const diskPath = path.join(tempDir, "brands", filename);
    expect(fs.existsSync(diskPath)).toBe(true);
    expect(fs.readFileSync(diskPath)).toEqual(jpegBytes);
  });

  it("5. multipart update with image works", async () => {
    const store = createStore();
    const storage = new LocalVolumeMediaStorage({ root: tempDir, baseUrl, client: null });
    const service = new BrandsService(store, storage);

    const created = await service.create({ name: "Initial Brand" });
    expect(created.logoUrl).toBeNull();

    const updated = await service.update(
      created.id,
      { name: "Updated Brand" },
      { buffer: pngBytes, mimetype: "image/png", size: pngBytes.length } as Express.Multer.File,
    );

    expect(updated.name).toBe("Updated Brand");
    expect(updated.logoUrl).toMatch(new RegExp(`^${baseUrl}/brands/[a-f0-9-]+\\.png$`));
    const filename = path.basename(new URL(updated.logoUrl!).pathname);
    const diskPath = path.join(tempDir, "brands", filename);
    expect(fs.existsSync(diskPath)).toBe(true);
    expect(fs.readFileSync(diskPath)).toEqual(pngBytes);
  });

  it("6. multipart data JSON is parsed correctly via HTTP route", async () => {
    const createSpy = vi.spyOn(BrandsService.prototype, "create").mockImplementation(async (input, file) => {
      expect(file).toBeDefined();
      expect(file?.mimetype).toBe("image/jpeg");
      expect(file?.originalname).toBe("logo.jpg");
      return {
        id: "11111111-1111-4111-8111-111111111111",
        name: input.name,
        slug: input.slug ?? "brand-route-test",
        description: input.description ?? null,
        logoUrl: `${baseUrl}/brands/mock-logo.jpg`,
        isActive: input.isActive ?? true,
        createdAt: new Date(),
        updatedAt: new Date(),
      } as never;
    });

    const app = createApp();
    const data = {
      name: "Adidas Originals",
      slug: "brand-route-test",
      description: "Iconic sportswear brand",
      isActive: true,
    };

    const res = await request(app)
      .post("/api/v1/admin/brands")
      .set("Authorization", "Bearer admin")
      .field("data", JSON.stringify(data))
      .attach("image", jpegBytes, { filename: "logo.jpg", contentType: "image/jpeg" });

    expect(res.status).toBe(201);
    expect(res.body.success).toBe(true);
    expect(res.body.data.name).toBe("Adidas Originals");
    expect(res.body.data.slug).toBe("brand-route-test");
    expect(res.body.data.logoUrl).toBe(`${baseUrl}/brands/mock-logo.jpg`);
    expect(createSpy).toHaveBeenCalledWith(
      expect.objectContaining({
        name: "Adidas Originals",
        slug: "brand-route-test",
      }),
      expect.objectContaining({
        originalname: "logo.jpg",
        mimetype: "image/jpeg",
      }),
    );
  });

  it("6b. multipart data JSON is parsed correctly on PATCH route", async () => {
    const updateSpy = vi.spyOn(BrandsService.prototype, "update").mockImplementation(async (_id, input, file) => {
      expect(file).toBeDefined();
      expect(file?.mimetype).toBe("image/png");
      return {
        id: "11111111-1111-4111-8111-111111111111",
        name: input.name ?? "Updated Brand",
        slug: "updated-brand",
        description: input.description ?? null,
        logoUrl: `${baseUrl}/brands/mock-updated.png`,
        isActive: true,
        createdAt: new Date().toISOString(),
        updatedAt: new Date().toISOString(),
      } as never;
    });

    const app = createApp();
    const data = {
      name: "Updated Brand Name",
      description: "Updated description",
    };

    const res = await request(app)
      .patch("/api/v1/admin/brands/11111111-1111-4111-8111-111111111111")
      .set("Authorization", "Bearer admin")
      .field("data", JSON.stringify(data))
      .attach("image", pngBytes, { filename: "logo.png", contentType: "image/png" });

    expect(res.status).toBe(200);
    expect(res.body.success).toBe(true);
    expect(res.body.data.name).toBe("Updated Brand Name");
    expect(res.body.data.logoUrl).toBe(`${baseUrl}/brands/mock-updated.png`);
    expect(updateSpy).toHaveBeenCalledWith(
      "11111111-1111-4111-8111-111111111111",
      expect.objectContaining({
        name: "Updated Brand Name",
      }),
      expect.objectContaining({
        originalname: "logo.png",
        mimetype: "image/png",
      }),
    );
  });

  it("7. missing data returns controlled 422", async () => {
    const app = createApp();
    const res = await request(app)
      .post("/api/v1/admin/brands")
      .set("Authorization", "Bearer admin")
      .attach("image", jpegBytes, { filename: "missing-data.jpg", contentType: "image/jpeg" });

    expect(res.status).toBe(422);
    expect(res.body.success).toBe(false);
    expect(res.body.error.code).toBe("BRAND_DATA_REQUIRED");
  });

  it("8. malformed data JSON returns controlled 422", async () => {
    const app = createApp();
    const res = await request(app)
      .post("/api/v1/admin/brands")
      .set("Authorization", "Bearer admin")
      .field("data", "{ not valid json")
      .attach("image", jpegBytes, { filename: "malformed.jpg", contentType: "image/jpeg" });

    expect(res.status).toBe(422);
    expect(res.body.success).toBe(false);
    expect(res.body.error.code).toBe("BRAND_DATA_INVALID");
  });

  it("9. invalid MIME rejected", async () => {
    const app = createApp();
    const res = await request(app)
      .post("/api/v1/admin/brands")
      .set("Authorization", "Bearer admin")
      .field("data", JSON.stringify({ name: "Invalid MIME Brand" }))
      .attach("image", Buffer.from("%PDF-1.4 test"), { filename: "document.pdf", contentType: "application/pdf" });

    expect(res.status).toBe(422);
    expect(res.body.success).toBe(false);
    expect(res.body.error.code).toBe("MEDIA_FILE_INVALID");
  });

  it("9b. corrupted image with fake MIME rejected by magic bytes check", async () => {
    const store = createStore();
    const storage = new LocalVolumeMediaStorage({ root: tempDir, baseUrl, client: null });
    const service = new BrandsService(store, storage);

    await expect(
      service.create(
        { name: "Fake Image Brand" },
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
      .post("/api/v1/admin/brands")
      .set("Authorization", "Bearer admin")
      .field("data", JSON.stringify({ name: "Too Large Brand" }))
      .attach("image", largeBuffer, { filename: "too-large.jpg", contentType: "image/jpeg" });

    expect(res.status).toBe(413);
    expect(res.body.success).toBe(false);
    expect(res.body.error.code).toBe("MEDIA_FILE_TOO_LARGE");
  });

  it("11. brand image stored under brands/", async () => {
    const storage = new LocalVolumeMediaStorage({ root: tempDir, baseUrl, client: null });
    const uploaded = await storage.upload(
      { buffer: webpBytes, mimetype: "image/webp" },
      { folder: "shoozy/brands" },
    );

    expect(uploaded.key.startsWith("brands/")).toBe(true);
    const fullPath = path.join(tempDir, uploaded.key);
    expect(fs.existsSync(fullPath)).toBe(true);
    expect(fs.readFileSync(fullPath)).toEqual(webpBytes);
  });

  it("12. public URL contains /uploads/brands/", async () => {
    const storage = new LocalVolumeMediaStorage({ root: tempDir, baseUrl, client: null });
    const uploaded = await storage.upload(
      { buffer: jpegBytes, mimetype: "image/jpeg" },
      { folder: "brands" },
    );

    expect(uploaded.url).toContain("/uploads/brands/");
    expect(uploaded.url).toMatch(/^https:\/\/.*\/uploads\/brands\/[a-f0-9-]+\.jpg$/);
  });

  it("13. replacing local image deletes old owned image", async () => {
    const store = createStore();
    const storage = new LocalVolumeMediaStorage({ root: tempDir, baseUrl, client: null });
    const service = new BrandsService(store, storage);

    // 1. Create with first image
    const initial = await service.create(
      { name: "Brand 1" },
      { buffer: jpegBytes, mimetype: "image/jpeg", size: jpegBytes.length } as Express.Multer.File,
    );
    const oldFilename = path.basename(new URL(initial.logoUrl!).pathname);
    const oldPath = path.join(tempDir, "brands", oldFilename);
    expect(fs.existsSync(oldPath)).toBe(true);

    // 2. Update with second image
    const updated = await service.update(
      initial.id,
      { name: "Brand 1 Updated" },
      { buffer: pngBytes, mimetype: "image/png", size: pngBytes.length } as Express.Multer.File,
    );

    const newFilename = path.basename(new URL(updated.logoUrl!).pathname);
    const newPath = path.join(tempDir, "brands", newFilename);

    expect(fs.existsSync(newPath)).toBe(true);
    // Old file must have been deleted
    expect(fs.existsSync(oldPath)).toBe(false);
  });

  it("14. DB failure cleans newly uploaded image on create and update", async () => {
    const store = createStore();
    const storage = new LocalVolumeMediaStorage({ root: tempDir, baseUrl, client: null });
    const service = new BrandsService(store, storage);

    // Make create throw DB error (e.g. duplicate slug)
    vi.mocked(store.create).mockRejectedValueOnce(new BrandsRepositoryError("DUPLICATE_SLUG"));

    const filesBefore = fs.existsSync(path.join(tempDir, "brands"))
      ? fs.readdirSync(path.join(tempDir, "brands"))
      : [];

    await expect(
      service.create(
        { name: "Slug Conflict Brand" },
        { buffer: jpegBytes, mimetype: "image/jpeg", size: jpegBytes.length } as Express.Multer.File,
      ),
    ).rejects.toMatchObject({
      statusCode: 409,
      code: "BRAND_SLUG_ALREADY_EXISTS",
    });

    const filesAfter = fs.readdirSync(path.join(tempDir, "brands"));
    expect(filesAfter).toEqual(filesBefore);

    // Test on update DB failure
    const existing = await service.create({ name: "Valid Brand Before Update Fail" });
    vi.mocked(store.update).mockRejectedValueOnce(new BrandsRepositoryError("DUPLICATE_SLUG"));

    await expect(
      service.update(
        existing.id,
        { name: "Will Fail Brand" },
        { buffer: pngBytes, mimetype: "image/png", size: pngBytes.length } as Express.Multer.File,
      ),
    ).rejects.toMatchObject({
      statusCode: 409,
      code: "BRAND_SLUG_ALREADY_EXISTS",
    });

    const filesAfterUpdateFail = fs.readdirSync(path.join(tempDir, "brands"));
    expect(filesAfterUpdateFail).toEqual(filesAfter);
  });

  it("15. external image URLs are never filesystem-deleted", async () => {
    const store = createStore();
    const storage = new LocalVolumeMediaStorage({ root: tempDir, baseUrl, client: null });
    const service = new BrandsService(store, storage);

    const canaryPath = path.resolve(process.cwd(), "package.json");
    expect(fs.existsSync(canaryPath)).toBe(true);

    const externalUrl = "https://images.unsplash.com/photo-1542291026-7eec264c27ff";
    const created = await service.create({
      name: "External Image Brand",
      logoUrl: externalUrl,
    });

    // Delete brand with external image: canary file and filesystem unaffected
    await service.delete(created.id);
    expect(fs.existsSync(canaryPath)).toBe(true);

    // Update brand with external image to new local image: external URL ignored, new image saved
    const created2 = await service.create({
      name: "External To Local Brand",
      logoUrl: "https://res.cloudinary.com/shoozy/image/upload/v1/demo.jpg",
    });

    const updated = await service.update(
      created2.id,
      { name: "Now Local Brand" },
      { buffer: jpegBytes, mimetype: "image/jpeg", size: jpegBytes.length } as Express.Multer.File,
    );

    expect(updated.logoUrl).toMatch(new RegExp(`^${baseUrl}/brands/[a-f0-9-]+\\.jpg$`));
    const newFilename = path.basename(new URL(updated.logoUrl!).pathname);
    expect(fs.existsSync(path.join(tempDir, "brands", newFilename))).toBe(true);
    expect(fs.existsSync(canaryPath)).toBe(true);
  });

  it("16. deleting brand safely deletes owned local image", async () => {
    const store = createStore();
    const storage = new LocalVolumeMediaStorage({ root: tempDir, baseUrl, client: null });
    const service = new BrandsService(store, storage);

    const created = await service.create(
      { name: "To Be Deleted Brand" },
      { buffer: webpBytes, mimetype: "image/webp", size: webpBytes.length } as Express.Multer.File,
    );

    const filename = path.basename(new URL(created.logoUrl!).pathname);
    const diskPath = path.join(tempDir, "brands", filename);
    expect(fs.existsSync(diskPath)).toBe(true);

    await service.delete(created.id);

    expect(fs.existsSync(diskPath)).toBe(false);
    expect(store.deleteIfUnused).toHaveBeenCalledWith(created.id);
  });

  it("17. static /uploads route serves uploaded brand files automatically, returns 404 for missing", async () => {
    const app = createApp();

    // Write a test image into tempDir/brands/brand-test.jpg
    const brandDir = path.join(tempDir, "brands");
    fs.mkdirSync(brandDir, { recursive: true });
    fs.writeFileSync(path.join(brandDir, "brand-test.jpg"), jpegBytes);

    const response = await request(app).get("/uploads/brands/brand-test.jpg");
    expect(response.status).toBe(200);
    expect(response.headers["content-type"]).toContain("image/jpeg");
    expect(response.headers["cross-origin-resource-policy"]).toBe("cross-origin");
    expect(response.body).toEqual(jpegBytes);

    // Missing file returns 404
    const notFoundResponse = await request(app).get("/uploads/brands/nonexistent-image.jpg");
    expect(notFoundResponse.status).toBe(404);
  });

  it("18. uploads, replaces, and removes the optional storefront showcase image", async () => {
    const store = createStore();
    const storage = new LocalVolumeMediaStorage({ root: tempDir, baseUrl, client: null });
    const service = new BrandsService(store, storage);

    const created = await service.create(
      { name: "Editorial Brand" },
      undefined,
      { buffer: jpegBytes, mimetype: "image/jpeg", size: jpegBytes.length } as Express.Multer.File,
    );
    expect(created.logoUrl).toBeNull();
    expect(created.showcaseImageUrl).toMatch(new RegExp(`^${baseUrl}/brands/[a-f0-9-]+\\.jpg$`));
    const firstPath = path.join(tempDir, "brands", path.basename(new URL(created.showcaseImageUrl!).pathname));
    expect(fs.existsSync(firstPath)).toBe(true);

    const replaced = await service.update(
      created.id,
      { name: "Editorial Brand" },
      undefined,
      { buffer: pngBytes, mimetype: "image/png", size: pngBytes.length } as Express.Multer.File,
    );
    const replacementPath = path.join(tempDir, "brands", path.basename(new URL(replaced.showcaseImageUrl!).pathname));
    expect(fs.existsSync(firstPath)).toBe(false);
    expect(fs.existsSync(replacementPath)).toBe(true);

    const preserved = await service.update(created.id, { name: "Editorial Brand Renamed" });
    expect(preserved.showcaseImageUrl).toBe(replaced.showcaseImageUrl);
    expect(fs.existsSync(replacementPath)).toBe(true);

    const removed = await service.update(created.id, { removeShowcaseImage: true });
    expect(removed.showcaseImageUrl).toBeNull();
    expect(fs.existsSync(replacementPath)).toBe(false);
  });

  it("rejects simultaneous showcase upload and removal", async () => {
    const store = createStore();
    const storage = new LocalVolumeMediaStorage({ root: tempDir, baseUrl, client: null });
    const service = new BrandsService(store, storage);
    const created = await service.create({ name: "Showcase Conflict" });

    await expect(service.update(
      created.id,
      { removeShowcaseImage: true },
      undefined,
      { buffer: pngBytes, mimetype: "image/png", size: pngBytes.length } as Express.Multer.File,
    )).rejects.toMatchObject({ statusCode: 422, code: "BRAND_SHOWCASE_IMAGE_CONFLICT" });
  });

  it("19. cleans a newly uploaded showcase image when the database update fails", async () => {
    const store = createStore();
    const storage = new LocalVolumeMediaStorage({ root: tempDir, baseUrl, client: null });
    const service = new BrandsService(store, storage);
    const created = await service.create({ name: "Showcase Failure" });
    const before = new Set(fs.readdirSync(path.join(tempDir, "brands")));
    vi.mocked(store.update).mockRejectedValueOnce(new BrandsRepositoryError("DUPLICATE_SLUG"));

    await expect(service.update(
      created.id,
      { name: "Duplicate Showcase Failure" },
      undefined,
      { buffer: webpBytes, mimetype: "image/webp", size: webpBytes.length } as Express.Multer.File,
    )).rejects.toMatchObject({ code: "BRAND_SLUG_ALREADY_EXISTS" });

    expect(new Set(fs.readdirSync(path.join(tempDir, "brands")))).toEqual(before);
  });

  it("20. deletes both owned logo and showcase media after deleting an unused brand", async () => {
    const store = createStore();
    const storage = new LocalVolumeMediaStorage({ root: tempDir, baseUrl, client: null });
    const service = new BrandsService(store, storage);
    const created = await service.create(
      { name: "Complete Brand Media" },
      { buffer: jpegBytes, mimetype: "image/jpeg", size: jpegBytes.length } as Express.Multer.File,
      { buffer: pngBytes, mimetype: "image/png", size: pngBytes.length } as Express.Multer.File,
    );
    const paths = [created.logoUrl, created.showcaseImageUrl].map((url) => path.join(tempDir, "brands", path.basename(new URL(url!).pathname)));
    expect(paths.every((filePath) => fs.existsSync(filePath))).toBe(true);

    await service.delete(created.id);

    expect(paths.every((filePath) => !fs.existsSync(filePath))).toBe(true);
  });

  it("21. accepts showcaseImage as the second multipart brand media field", async () => {
    const createSpy = vi.spyOn(BrandsService.prototype, "create").mockImplementation(async (input, logo, showcase) => {
      expect(logo).toBeUndefined();
      expect(showcase).toMatchObject({ originalname: "showcase.png", mimetype: "image/png" });
      return {
        id: "11111111-1111-4111-8111-111111111111",
        name: input.name,
        slug: "editorial-route-brand",
        description: null,
        logoUrl: null,
        showcaseImageUrl: `${baseUrl}/brands/mock-showcase.png`,
        productCount: 0,
        isActive: true,
        createdAt: new Date(),
        updatedAt: new Date(),
        translations: {},
      };
    });
    const app = createApp();
    const response = await request(app)
      .post("/api/v1/admin/brands")
      .set("Authorization", "Bearer admin")
      .field("data", JSON.stringify({ name: "Editorial Route Brand" }))
      .attach("showcaseImage", pngBytes, { filename: "showcase.png", contentType: "image/png" });

    expect(response.status).toBe(201);
    expect(response.body.data.showcaseImageUrl).toContain("/brands/mock-showcase.png");
    expect(createSpy).toHaveBeenCalledWith(
      expect.objectContaining({ name: "Editorial Route Brand" }),
      undefined,
      expect.objectContaining({ originalname: "showcase.png" }),
    );
  });
});
