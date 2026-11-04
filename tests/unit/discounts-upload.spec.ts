import fs from "node:fs";
import os from "node:os";
import path from "node:path";
import { randomUUID } from "node:crypto";
import type { RequestHandler } from "express";
import request from "supertest";
import { afterAll, beforeAll, beforeEach, describe, expect, it, vi } from "vitest";
import { createApp } from "../../src/app";
import { AuditLogService } from "../../src/modules/admin-audit/audit-log.service";
import { DiscountsService, type DiscountsStore } from "../../src/modules/discounts/discounts.service";
import type { DiscountWriteFields } from "../../src/modules/discounts/discounts.repository";
import type { DiscountRecord } from "../../src/modules/discounts/discounts.types";
import { LocalVolumeMediaStorage } from "../../src/modules/products/media-storage";

vi.mock("../../src/common/middlewares/auth.middleware", async () => {
  const { AppError } = await import("../../src/common/errors/app-error.js");
  const { ALL_PERMISSION_CODES } = await import("../../src/common/auth/rbac.constants.js");
  const requireAuth: RequestHandler = (request, _response, next) => {
    if (request.headers.authorization !== "Bearer admin") {
      return next(new AppError(401, "Authentication required", "AUTH_UNAUTHORIZED"));
    }
    request.auth = {
      userId: "11111111-1111-4111-8111-111111111111",
      sessionId: "22222222-2222-4222-8222-222222222222",
      roleCodes: ["ADMIN"],
      permissions: [...ALL_PERMISSION_CODES],
    };
    next();
  };
  return { requireAuth, createRequireAuth: vi.fn() };
});

const jpegBytes = Buffer.from([0xff, 0xd8, 0xff, 0xe0, 0x00, 0x10, 0x4a, 0x46, 0x49, 0x46]);
const pngBytes = Buffer.from([137, 80, 78, 71, 13, 10, 26, 10, 0, 0, 0, 13]);

const baseCreate = {
  name: "Storefront sale",
  type: "PERCENTAGE" as const,
  scope: "ORDER" as const,
  priority: 100,
  value: "1000",
  startsAt: "2026-09-01T00:00:00.000Z",
  targets: [],
};

function recordFromFields(id: string, fields: DiscountWriteFields, existing?: DiscountRecord): DiscountRecord {
  return {
    id,
    name: fields.name ?? existing?.name ?? "Storefront sale",
    description: fields.description === undefined ? existing?.description ?? null : fields.description,
    imageUrl: fields.imageUrl === undefined ? existing?.imageUrl ?? null : fields.imageUrl,
    imageStorageProvider: fields.imageStorageProvider === undefined ? existing?.imageStorageProvider ?? null : fields.imageStorageProvider,
    imageStorageKey: fields.imageStorageKey === undefined ? existing?.imageStorageKey ?? null : fields.imageStorageKey,
    showOnStorefront: fields.showOnStorefront ?? existing?.showOnStorefront ?? false,
    sortOrder: fields.sortOrder ?? existing?.sortOrder ?? 0,
    ctaUrl: fields.ctaUrl === undefined ? existing?.ctaUrl ?? null : fields.ctaUrl,
    code: fields.code === undefined ? existing?.code ?? null : fields.code,
    type: fields.type ?? existing?.type ?? "PERCENTAGE",
    scope: fields.scope ?? existing?.scope ?? "ORDER",
    priority: fields.priority ?? existing?.priority ?? 100,
    value: fields.value ?? existing?.value ?? 1000n,
    currency: fields.currency === undefined ? existing?.currency ?? null : fields.currency,
    minOrderMinor: fields.minOrderMinor === undefined ? existing?.minOrderMinor ?? null : fields.minOrderMinor,
    maxDiscountMinor: fields.maxDiscountMinor === undefined ? existing?.maxDiscountMinor ?? null : fields.maxDiscountMinor,
    usageLimit: fields.usageLimit === undefined ? existing?.usageLimit ?? null : fields.usageLimit,
    perCustomerLimit: fields.perCustomerLimit === undefined ? existing?.perCustomerLimit ?? null : fields.perCustomerLimit,
    startsAt: fields.startsAt ?? existing?.startsAt ?? new Date(baseCreate.startsAt),
    endsAt: fields.endsAt === undefined ? existing?.endsAt ?? null : fields.endsAt,
    isActive: fields.isActive ?? existing?.isActive ?? true,
    combinable: fields.combinable ?? existing?.combinable ?? false,
    archivedAt: existing?.archivedAt ?? null,
    createdAt: existing?.createdAt ?? new Date(),
    updatedAt: new Date(),
    translations: existing?.translations ?? [],
    targets: existing?.targets ?? [],
    _count: existing?._count ?? { redemptions: 0 },
  };
}

function createStore(): DiscountsStore & { promotions: Map<string, DiscountRecord> } {
  const promotions = new Map<string, DiscountRecord>();
  return {
    promotions,
    list: vi.fn(async () => ({ items: [...promotions.values()], total: promotions.size })),
    findById: vi.fn(async (id) => promotions.get(id) ?? null),
    create: vi.fn(async (fields, targets, validate) => {
      validate({ ...fields, targets } as Parameters<typeof validate>[0]);
      const id = randomUUID();
      const record = recordFromFields(id, fields);
      promotions.set(id, record);
      return record;
    }),
    update: vi.fn(async (id, fields, targets, validate) => {
      const existing = promotions.get(id);
      if (!existing) return "NOT_FOUND" as const;
      validate({ ...existing, ...fields, targets: targets ?? [] } as Parameters<typeof validate>[0]);
      const updated = recordFromFields(id, fields, existing);
      promotions.set(id, updated);
      return updated;
    }),
    delete: vi.fn(async (id) => {
      if (!promotions.has(id)) return "NOT_FOUND" as const;
      promotions.delete(id);
      return "DELETED" as const;
    }),
    setActive: vi.fn(async (id, isActive) => {
      const existing = promotions.get(id);
      return existing ? recordFromFields(id, { isActive }, existing) : "NOT_FOUND" as const;
    }),
    archive: vi.fn(async (id, archivedAt) => {
      const existing = promotions.get(id);
      return existing ? { ...existing, archivedAt, isActive: false } : "NOT_FOUND" as const;
    }),
    statistics: vi.fn(async (id) => promotions.has(id)
      ? { usageCount: 0, associatedOrders: 0, totalDiscountGrantedMinor: 0n, revenueMinor: 0n }
      : "NOT_FOUND" as const),
  };
}

describe("promotion image upload lifecycle", () => {
  let tempDir: string;
  const baseUrl = "https://example.test/uploads";

  beforeAll(() => {
    tempDir = fs.mkdtempSync(path.join(os.tmpdir(), "shoozy-promotion-test-"));
  });

  afterAll(() => {
    fs.rmSync(tempDir, { recursive: true, force: true });
  });

  beforeEach(() => {
    vi.restoreAllMocks();
    vi.spyOn(AuditLogService.prototype, "record").mockResolvedValue({} as never);
  });

  it("keeps JSON admin create compatible without requiring an image", async () => {
    const store = createStore();
    const service = new DiscountsService(store, new LocalVolumeMediaStorage({ root: tempDir, baseUrl, client: null }));
    const result = await service.create(baseCreate);

    expect(result.imageUrl).toBeNull();
    expect(store.create).toHaveBeenCalledWith(expect.objectContaining({ name: baseCreate.name }), [], expect.any(Function));
  });

  it("stores multipart create images under promotions/ with owned storage metadata", async () => {
    const store = createStore();
    const service = new DiscountsService(store, new LocalVolumeMediaStorage({ root: tempDir, baseUrl, client: null }));
    const result = await service.create(
      { ...baseCreate, showOnStorefront: true, sortOrder: 4 },
      { buffer: jpegBytes, mimetype: "image/jpeg", size: jpegBytes.length } as Express.Multer.File,
    );

    expect(result.imageUrl).toMatch(/^https:\/\/example\.test\/uploads\/promotions\/[a-f0-9-]+\.jpg$/);
    const stored = store.promotions.get(result.id)!;
    expect(stored.imageStorageProvider).toBe("LOCAL");
    expect(stored.imageStorageKey).toMatch(/^promotions\/[a-f0-9-]+\.jpg$/);
    expect(fs.existsSync(path.join(tempDir, stored.imageStorageKey!))).toBe(true);
  });

  it("adds an image later and safely replaces the prior owned image", async () => {
    const store = createStore();
    const service = new DiscountsService(store, new LocalVolumeMediaStorage({ root: tempDir, baseUrl, client: null }));
    const created = await service.create(baseCreate);
    const first = await service.update(
      created.id,
      { showOnStorefront: true },
      { buffer: jpegBytes, mimetype: "image/jpeg", size: jpegBytes.length } as Express.Multer.File,
    );
    const oldKey = store.promotions.get(first.id)!.imageStorageKey!;
    expect(fs.existsSync(path.join(tempDir, oldKey))).toBe(true);

    const replaced = await service.update(
      created.id,
      { sortOrder: 1 },
      { buffer: pngBytes, mimetype: "image/png", size: pngBytes.length } as Express.Multer.File,
    );
    const newKey = store.promotions.get(replaced.id)!.imageStorageKey!;
    expect(newKey).not.toBe(oldKey);
    expect(fs.existsSync(path.join(tempDir, oldKey))).toBe(false);
    expect(fs.existsSync(path.join(tempDir, newKey))).toBe(true);
  });

  it("removes a newly uploaded image when the DB create or update fails", async () => {
    const store = createStore();
    const service = new DiscountsService(store, new LocalVolumeMediaStorage({ root: tempDir, baseUrl, client: null }));
    const promotionDir = path.join(tempDir, "promotions");
    const files = () => fs.existsSync(promotionDir) ? fs.readdirSync(promotionDir).sort() : [];
    const beforeCreate = files();
    vi.mocked(store.create).mockRejectedValueOnce(new Error("DB unavailable"));
    await expect(service.create(baseCreate, { buffer: jpegBytes, mimetype: "image/jpeg", size: jpegBytes.length } as Express.Multer.File)).rejects.toThrow("DB unavailable");
    expect(files()).toEqual(beforeCreate);

    const created = await service.create(baseCreate);
    const beforeUpdate = files();
    vi.mocked(store.update).mockRejectedValueOnce(new Error("DB unavailable"));
    await expect(service.update(created.id, { sortOrder: 2 }, { buffer: pngBytes, mimetype: "image/png", size: pngBytes.length } as Express.Multer.File)).rejects.toThrow("DB unavailable");
    expect(files()).toEqual(beforeUpdate);
    expect(store.promotions.get(created.id)?.imageUrl).toBeNull();
  });

  it("never filesystem-deletes an external image URL", async () => {
    const store = createStore();
    const service = new DiscountsService(store, new LocalVolumeMediaStorage({ root: tempDir, baseUrl, client: null }));
    const canary = path.join(tempDir, "external-url-canary.txt");
    fs.writeFileSync(canary, "keep");
    const created = await service.create({ ...baseCreate, imageUrl: "https://cdn.example.com/promotion.jpg" });

    await service.update(created.id, { imageUrl: "https://cdn.example.com/replacement.jpg" });
    await service.delete(created.id);
    expect(fs.readFileSync(canary, "utf8")).toBe("keep");
  });

  it("deletes the owned local image only after successful promotion deletion", async () => {
    const store = createStore();
    const service = new DiscountsService(store, new LocalVolumeMediaStorage({ root: tempDir, baseUrl, client: null }));
    const created = await service.create(baseCreate, { buffer: jpegBytes, mimetype: "image/jpeg", size: jpegBytes.length } as Express.Multer.File);
    const key = store.promotions.get(created.id)!.imageStorageKey!;

    await service.delete(created.id);
    expect(fs.existsSync(path.join(tempDir, key))).toBe(false);
  });

  it("rejects a declared image whose magic bytes do not match", async () => {
    const service = new DiscountsService(createStore(), new LocalVolumeMediaStorage({ root: tempDir, baseUrl, client: null }));
    await expect(service.create(
      baseCreate,
      { buffer: pngBytes, mimetype: "image/jpeg", size: pngBytes.length } as Express.Multer.File,
    )).rejects.toMatchObject({ statusCode: 422, code: "MEDIA_FILE_INVALID" });
  });

  it("rejects promotion images larger than 8 MB", async () => {
    const service = new DiscountsService(createStore(), new LocalVolumeMediaStorage({ root: tempDir, baseUrl, client: null }));
    await expect(service.create(
      baseCreate,
      { buffer: jpegBytes, mimetype: "image/jpeg", size: 8 * 1024 * 1024 + 1 } as Express.Multer.File,
    )).rejects.toMatchObject({ statusCode: 413, code: "MEDIA_FILE_TOO_LARGE" });
  });

  it("parses multipart create and update data before validation while preserving JSON create", async () => {
    const createSpy = vi.spyOn(DiscountsService.prototype, "create").mockResolvedValue({ id: randomUUID() } as never);
    const updateSpy = vi.spyOn(DiscountsService.prototype, "update").mockResolvedValue({ id: randomUUID() } as never);
    const app = createApp();

    const jsonResponse = await request(app)
      .post("/api/v1/admin/discounts")
      .set("Authorization", "Bearer admin")
      .send(baseCreate);
    expect(jsonResponse.status).toBe(201);
    expect(createSpy).toHaveBeenCalledWith(expect.objectContaining({ name: baseCreate.name }), undefined);

    const multipartResponse = await request(app)
      .post("/api/v1/admin/discounts")
      .set("Authorization", "Bearer admin")
      .field("data", JSON.stringify({ ...baseCreate, showOnStorefront: true }))
      .attach("image", jpegBytes, { filename: "offer.jpg", contentType: "image/jpeg" });
    expect(multipartResponse.status).toBe(201);
    expect(createSpy).toHaveBeenLastCalledWith(expect.objectContaining({ showOnStorefront: true }), expect.objectContaining({ mimetype: "image/jpeg" }));

    const multipartUpdate = await request(app)
      .patch("/api/v1/admin/discounts/33333333-3333-4333-8333-333333333333")
      .set("Authorization", "Bearer admin")
      .field("data", JSON.stringify({ sortOrder: 2 }))
      .attach("image", pngBytes, { filename: "offer.png", contentType: "image/png" });
    expect(multipartUpdate.status).toBe(200);
    expect(updateSpy).toHaveBeenCalledWith(
      "33333333-3333-4333-8333-333333333333",
      expect.objectContaining({ sortOrder: 2 }),
      expect.objectContaining({ mimetype: "image/png" }),
    );
  });
});

