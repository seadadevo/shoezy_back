import type { RequestHandler } from "express";
import request from "supertest";
import { beforeEach, describe, expect, it, vi } from "vitest";
import { createApp } from "../../src/app";
import { ProductEditorService } from "../../src/modules/products/product-editor.service";
import { ProductsService } from "../../src/modules/products/products.service";
import { AuditLogService } from "../../src/modules/admin-audit/audit-log.service";

vi.mock("../../src/common/middlewares/auth.middleware", async () => {
  const { AppError } = await import("../../src/common/errors/app-error.js");
  const { ALL_PERMISSION_CODES } = await import("../../src/common/auth/rbac.constants.js");
  const requireAuth: RequestHandler = (r, _s, n) => {
    if (!r.headers.authorization) return n(new AppError(401, "Authentication required", "AUTH_UNAUTHORIZED"));
    r.auth = { userId: "11111111-1111-4111-8111-111111111111", sessionId: "22222222-2222-4222-8222-222222222222", roleCodes: ["ADMIN"], permissions: [...ALL_PERMISSION_CODES] };
    n();
  };
  return { requireAuth, createRequireAuth: vi.fn() };
});

const app = createApp();
const url = "/api/v1/admin/products";
const productId = "33333333-3333-4333-8333-333333333333";
const brandId = "44444444-4444-4444-8444-444444444444";
const png = Buffer.from([137, 80, 78, 71, 13, 10, 26, 10, 0]);
const data = { product: { brandId, name: "Runner", basePrice: "100.00" }, media: [{ fileIndex: 0, isPrimary: true }, { fileIndex: 1, position: 1 }] };

describe("admin product editor routes", () => {
  beforeEach(() => {
    vi.restoreAllMocks();
    vi.spyOn(AuditLogService.prototype, "record").mockResolvedValue({} as never);
    vi.spyOn(ProductsService.prototype, "create").mockResolvedValue({ id: productId } as never);
    vi.spyOn(ProductEditorService.prototype, "create").mockResolvedValue({ id: productId, media: [{ id: "one" }, { id: "two" }] } as never);
    vi.spyOn(ProductEditorService.prototype, "update").mockResolvedValue({ id: productId } as never);
    vi.spyOn(ProductEditorService.prototype, "formContext").mockResolvedValue({ brands: [], categories: [], sizeGuides: [] });
  });
  it("preserves legacy JSON creation", async () => {
    const result = await request(app).post(url).set("Authorization", "Bearer admin").send({ brandId, name: "Runner", basePrice: "100.00" });
    expect(result.status).toBe(201);
    expect(result.body.data.id).toBe(productId);
    expect(ProductsService.prototype.create).toHaveBeenCalledOnce();
    expect(ProductEditorService.prototype.create).not.toHaveBeenCalled();
  });
  it("accepts two files in one multipart product request", async () => {
    const result = await request(app).post(url).set("Authorization", "Bearer admin")
      .field("data", JSON.stringify(data)).attach("files[]", png, { filename: "one.png", contentType: "image/png" }).attach("files[]", png, { filename: "two.png", contentType: "image/png" });
    expect(result.status).toBe(201);
    expect(result.body.data.media).toHaveLength(2);
    expect(ProductEditorService.prototype.create).toHaveBeenCalledWith(expect.objectContaining({ product: expect.objectContaining({ name: "Runner" }) }), expect.arrayContaining([expect.objectContaining({ mimetype: "image/png" })]), expect.any(String));
    expect((vi.mocked(ProductEditorService.prototype.create).mock.calls[0]?.[1] ?? [])).toHaveLength(2);
  });
  it("rejects invalid nested input before service or Cloudinary", async () => {
    const result = await request(app).post(url).set("Authorization", "Bearer admin").send({ ...data, variants: [{ clientKey: "one", sku: "RUN", title: "Run", priceMinor: "100000", optionValueClientKeys: ["missing"] }] });
    expect(result.status).toBe(422);
    expect(ProductEditorService.prototype.create).not.toHaveBeenCalled();
  });
  it("accepts a section only PATCH and exposes lightweight context", async () => {
    const edited = await request(app).patch(`${url}/${productId}`).set("Authorization", "Bearer admin").send({ categories: { categoryIds: [], primaryCategoryId: null } });
    expect(edited.status).toBe(200);
    expect(ProductEditorService.prototype.update).toHaveBeenCalledOnce();
    const context = await request(app).get(`${url}/form-context`).set("Authorization", "Bearer admin");
    expect(context.status).toBe(200);
    expect(context.body.data).toEqual({ brands: [], categories: [], sizeGuides: [] });
  });
  it("accepts a multipart product edit with a new image", async () => {
    const edited = await request(app).patch(`${url}/${productId}`).set("Authorization", "Bearer admin")
      .field("data", JSON.stringify({ product: { name: "Runner Updated" }, media: { existing: [], new: [{ fileIndex: 0, isPrimary: true }], deleteIds: [] } }))
      .attach("files[]", png, { filename: "updated.png", contentType: "image/png" });
    expect(edited.status).toBe(200);
    expect(vi.mocked(ProductEditorService.prototype.update).mock.calls[0]?.[2]).toHaveLength(1);
  });
});
