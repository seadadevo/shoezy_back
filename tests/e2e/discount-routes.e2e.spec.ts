import type { RequestHandler } from "express";
import request from "supertest";
import { beforeAll, describe, expect, it, vi } from "vitest";
import { createApp } from "../../src/app";
import { DiscountsService } from "../../src/modules/discounts/discounts.service";
const discountId = "33333333-3333-4333-8333-333333333333";
const now = new Date("2026-08-13T12:00:00.000Z");

vi.mock("../../src/common/middlewares/auth.middleware", async () => {
  const { AppError } = await import("../../src/common/errors/app-error.js");
  const { ALL_PERMISSION_CODES, CUSTOMER_PERMISSION_CODES } = await import("../../src/common/auth/rbac.constants.js");
  const requireAuth: RequestHandler = (request, _response, next) => {
    if (!request.headers.authorization) return next(new AppError(401, "Authentication required", "AUTH_UNAUTHORIZED"));
    const admin = request.headers.authorization === "Bearer admin";
    request.auth = { userId: "11111111-1111-4111-8111-111111111111", sessionId: "22222222-2222-4222-8222-222222222222", roleCodes: [admin ? "ADMIN" : "CUSTOMER"], permissions: [...(admin ? ALL_PERMISSION_CODES : CUSTOMER_PERMISSION_CODES)] };
    next();
  };
  return { requireAuth, createRequireAuth: vi.fn() };
});

describe("Task 16 Discount route integration", () => {
  beforeAll(() => vi.spyOn(DiscountsService.prototype, "list").mockResolvedValue({ items: [], pagination: { page: 1, limit: 20, total: 0, totalPages: 0 } }));
  const app = createApp();
  it("requires database-backed administrative permission", async () => {
    expect((await request(app).get("/api/v1/admin/discounts")).status).toBe(401);
    expect((await request(app).get("/api/v1/admin/discounts").set("Authorization", "Bearer customer")).status).toBe(403);
    expect((await request(app).get("/api/v1/admin/discounts").set("Authorization", "Bearer admin")).status).toBe(200);
  });
  it("rejects mass assignment before the controller", async () => {
    const response = await request(app).post("/api/v1/admin/discounts").set("Authorization", "Bearer admin").send({ name: "Bad", type: "PERCENTAGE", scope: "ORDER", priority: 1, value: "100", startsAt: now.toISOString(), targets: [], userId: discountId });
    expect(response.status).toBe(422);
  });
});
