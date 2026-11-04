import type { RequestHandler } from "express";
import request from "supertest";
import { beforeAll, describe, expect, it, vi } from "vitest";
import { createApp } from "../../src/app";
import { HomepageService } from "../../src/modules/homepage/homepage.service";
import { AuditLogService } from "../../src/modules/admin-audit/audit-log.service";

vi.mock("../../src/common/middlewares/auth.middleware", async () => {
  const { AppError } = await import("../../src/common/errors/app-error.js");
  const { ALL_PERMISSION_CODES, CUSTOMER_PERMISSION_CODES } = await import("../../src/common/auth/rbac.constants.js");
  const requireAuth: RequestHandler = (req, _res, next) => {
    if (!req.headers.authorization) return next(new AppError(401, "Authentication required", "AUTH_UNAUTHORIZED"));
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

describe("Homepage routes e2e integration", () => {
  beforeAll(() => {
    vi.spyOn(AuditLogService.prototype, "record").mockResolvedValue({} as never);
    vi.spyOn(HomepageService.prototype, "listPublic").mockResolvedValue([]);
    vi.spyOn(HomepageService.prototype, "listAdmin").mockResolvedValue({
      items: [],
      pagination: { page: 1, limit: 20, total: 0, totalPages: 0 },
    });
  });

  const app = createApp();

  it("public endpoint is accessible without authentication", async () => {
    const response = await request(app).get("/api/v1/homepage/banners?placement=HERO_SLIDER");
    expect(response.status).toBe(200);
    expect(response.body.success).toBe(true);
    expect(response.body.data).toEqual([]);
  });

  it("admin endpoint requires database-backed administrative permission", async () => {
    expect((await request(app).get("/api/v1/admin/homepage/banners")).status).toBe(401);
    expect((await request(app).get("/api/v1/admin/homepage/banners").set("Authorization", "Bearer customer")).status).toBe(403);
    expect((await request(app).get("/api/v1/admin/homepage/banners").set("Authorization", "Bearer admin")).status).toBe(200);
  });

  it("rejects invalid banner creation payload with 422", async () => {
    const response = await request(app)
      .post("/api/v1/admin/homepage/banners")
      .set("Authorization", "Bearer admin")
      .send({
        placement: "INVALID_PLACEMENT",
      });
    expect(response.status).toBe(422);
  });

  it("accepts desktop and mobile videos through the existing admin multipart route", async () => {
    const mp4 = Buffer.from([0, 0, 0, 20, 0x66, 0x74, 0x79, 0x70, 0x69, 0x73, 0x6f, 0x6d, 0, 0, 0, 0, 0x69, 0x73, 0x6f, 0x6d]);
    const create = vi.spyOn(HomepageService.prototype, "create").mockResolvedValue({
      id: "33333333-3333-4333-8333-333333333333",
      placement: "HERO_SLIDER",
      ctaUrl: null,
      desktopImageUrl: null,
      mobileImageUrl: null,
      desktopVideoUrl: "/uploads/homepage/desktop.mp4",
      desktopVideoMimeType: "video/mp4",
      mobileVideoUrl: "/uploads/homepage/mobile.mp4",
      mobileVideoMimeType: "video/mp4",
      sortOrder: 0,
      isActive: true,
      startsAt: null,
      endsAt: null,
      promotionId: null,
      createdAt: "2026-10-04T00:00:00.000Z",
      updatedAt: "2026-10-04T00:00:00.000Z",
      translations: { en: { title: "Animated Hero" } },
      promotion: null,
    });

    const response = await request(app)
      .post("/api/v1/admin/homepage/banners")
      .set("Authorization", "Bearer admin")
      .field("data", JSON.stringify({ placement: "HERO_SLIDER", translations: { en: { title: "Animated Hero" } } }))
      .attach("desktopVideo", mp4, { filename: "desktop.mp4", contentType: "video/mp4" })
      .attach("mobileVideo", mp4, { filename: "mobile.mp4", contentType: "video/mp4" });

    expect(response.status).toBe(201);
    expect(response.body.data).toMatchObject({ desktopVideoMimeType: "video/mp4", mobileVideoMimeType: "video/mp4" });
    expect(create).toHaveBeenCalledWith(expect.any(Object), expect.objectContaining({
      desktopVideo: [expect.objectContaining({ fieldname: "desktopVideo" })],
      mobileVideo: [expect.objectContaining({ fieldname: "mobileVideo" })],
    }));
  });
  it("accepts MOV video through the existing admin multipart route", async () => {
    const mov = Buffer.from([0, 0, 0, 20, 0x66, 0x74, 0x79, 0x70, 0x71, 0x74, 0x20, 0x20, 0, 0, 0, 0, 0x71, 0x74, 0x20, 0x20]);
    const create = vi.spyOn(HomepageService.prototype, "create").mockResolvedValue({
      id: "44444444-4444-4444-8444-444444444444",
      placement: "HERO_SLIDER",
      ctaUrl: null,
      desktopImageUrl: null,
      mobileImageUrl: null,
      desktopVideoUrl: "/uploads/homepage/desktop.mov",
      desktopVideoMimeType: "video/quicktime",
      mobileVideoUrl: null,
      mobileVideoMimeType: null,
      sortOrder: 0,
      isActive: true,
      startsAt: null,
      endsAt: null,
      promotionId: null,
      createdAt: "2026-10-04T00:00:00.000Z",
      updatedAt: "2026-10-04T00:00:00.000Z",
      translations: { en: { title: "Animated Hero MOV" } },
      promotion: null,
    });

    const response = await request(app)
      .post("/api/v1/admin/homepage/banners")
      .set("Authorization", "Bearer admin")
      .field("data", JSON.stringify({ placement: "HERO_SLIDER", translations: { en: { title: "Animated Hero MOV" } } }))
      .attach("desktopVideo", mov, { filename: "desktop.mov", contentType: "video/quicktime" });

    expect(response.status).toBe(201);
    expect(response.body.data).toMatchObject({ desktopVideoMimeType: "video/quicktime" });
    expect(create).toHaveBeenCalledWith(expect.any(Object), expect.objectContaining({
      desktopVideo: [expect.objectContaining({ fieldname: "desktopVideo" })],
    }));
  });
});
