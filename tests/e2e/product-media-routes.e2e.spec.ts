import type { RequestHandler } from "express";
import request from "supertest";
import { beforeAll, describe, expect, it, vi } from "vitest";
import { createApp } from "../../src/app";
import { ProductMediaService } from "../../src/modules/products/product-media.service";
import { AuditLogService } from "../../src/modules/admin-audit/audit-log.service";

vi.mock("../../src/common/middlewares/auth.middleware", async () => {
  const { AppError } = await import("../../src/common/errors/app-error.js");
  const { ALL_PERMISSION_CODES, CUSTOMER_PERMISSION_CODES } = await import("../../src/common/auth/rbac.constants.js");
  const requireAuth: RequestHandler = (request, _response, next) => {
    const token = request.headers.authorization;
    if (!token) return next(new AppError(401, "Authentication required", "AUTH_UNAUTHORIZED"));
    const admin = token === "Bearer admin";
    request.auth = {
      userId: "11111111-1111-4111-8111-111111111111",
      sessionId: "22222222-2222-4222-8222-222222222222",
      roleCodes: [admin ? "ADMIN" : "CUSTOMER"],
      permissions: [...(admin ? ALL_PERMISSION_CODES : CUSTOMER_PERMISSION_CODES)],
    };
    next();
  };
  return { requireAuth, createRequireAuth: vi.fn() };
});

const productId = "33333333-3333-4333-8333-333333333333";
const mediaId = "44444444-4444-4444-8444-444444444444";

describe("Task 13 Product Media route integration", () => {
  beforeAll(() => {
    vi.spyOn(AuditLogService.prototype, "record").mockResolvedValue({} as never);
    vi.spyOn(ProductMediaService.prototype, "list").mockResolvedValue({
      items: [],
      pagination: { page: 1, limit: 20, total: 0, totalPages: 0 },
    });
    vi.spyOn(ProductMediaService.prototype, "create").mockResolvedValue({
      id: mediaId,
      productId,
      variantId: null,
      type: "IMAGE",
      mediaType: "IMAGE",
      mimeType: "image/jpeg",
      url: "https://example.com/shoe.jpg",
      altText: null,
      position: 0,
      isPrimary: true,
      createdAt: new Date(),
    });
  });

  const app = createApp();

  it("requires authentication and administrative catalog permission", async () => {
    const path = `/api/v1/admin/products/${productId}/media`;
    expect((await request(app).get(path)).status).toBe(401);
    expect((await request(app).get(path).set("Authorization", "Bearer customer")).status).toBe(403);
    expect((await request(app).get(path).set("Authorization", "Bearer admin")).status).toBe(200);
  });

  it("passes a strict validated create request through the mounted route", async () => {
    const path = `/api/v1/admin/products/${productId}/media`;
    expect((await request(app).post(path).set("Authorization", "Bearer admin").send({
      type: "IMAGE",
      url: "https://example.com/shoe.jpg",
      isPrimary: true,
    })).status).toBe(201);
    expect((await request(app).post(path).set("Authorization", "Bearer admin").send({
      type: "IMAGE",
      url: "https://example.com/shoe.jpg",
      userId: productId,
    })).status).toBe(422);
    expect(AuditLogService.prototype.record).toHaveBeenCalledWith(expect.objectContaining({ action: "PRODUCT_MEDIA_CREATE", entityType: "PRODUCT_MEDIA", entityId: mediaId }));
  });
});
