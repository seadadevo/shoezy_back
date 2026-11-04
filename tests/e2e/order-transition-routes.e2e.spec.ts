import type { RequestHandler } from "express";
import request from "supertest";
import { beforeAll, describe, expect, it, vi } from "vitest";
import { createApp } from "../../src/app";
import { OrdersService } from "../../src/modules/orders/orders.service";

const orderId = "22222222-2222-4222-8222-222222222222";
vi.mock("../../src/common/middlewares/auth.middleware", async () => {
  const { AppError } = await import("../../src/common/errors/app-error.js");
  const { ALL_PERMISSION_CODES, CUSTOMER_PERMISSION_CODES } = await import("../../src/common/auth/rbac.constants.js");
  const requireAuth: RequestHandler = (request, _response, next) => {
    const token = request.headers.authorization;
    if (!token) return next(new AppError(401, "Authentication required", "AUTH_UNAUTHORIZED"));
    const admin = token === "Bearer admin";
    request.auth = { userId: "11111111-1111-4111-8111-111111111111", sessionId: "33333333-3333-4333-8333-333333333333", roleCodes: [admin ? "ADMIN" : "CUSTOMER"], permissions: [...(admin ? ALL_PERMISSION_CODES : CUSTOMER_PERMISSION_CODES)] };
    next();
  };
  return { requireAuth, createRequireAuth: vi.fn() };
});

describe("Task 21 Order transition route integration", () => {
  beforeAll(() => {
    vi.spyOn(OrdersService.prototype, "listAny").mockResolvedValue({ items: [], pagination: { page: 1, limit: 20, total: 0, totalPages: 0 } });
    vi.spyOn(OrdersService.prototype, "confirmAny").mockResolvedValue({ order: { id: orderId }, idempotentReplay: false } as never);
    vi.spyOn(OrdersService.prototype, "cancelOwn").mockResolvedValue({ order: { id: orderId }, idempotentReplay: false } as never);
  });
  const app = createApp();

  it("denies customer access and permits explicit admin Order operations", async () => {
    expect((await request(app).get("/api/v1/admin/orders")).status).toBe(401);
    expect((await request(app).get("/api/v1/admin/orders").set("Authorization", "Bearer customer")).status).toBe(403);
    expect((await request(app).get("/api/v1/admin/orders").set("Authorization", "Bearer admin")).status).toBe(200);
    expect((await request(app).post(`/api/v1/admin/orders/${orderId}/confirm`).set("Authorization", "Bearer admin").send({ reason: "Stock verified" })).status).toBe(200);
  });

  it("allows own cancellation but rejects generic status mass assignment", async () => {
    expect((await request(app).post(`/api/v1/orders/${orderId}/cancel`).set("Authorization", "Bearer customer").send({ reason: "Changed mind" })).status).toBe(200);
    expect((await request(app).post(`/api/v1/orders/${orderId}/cancel`).set("Authorization", "Bearer customer").send({ status: "DELIVERED" })).status).toBe(422);
  });
});
