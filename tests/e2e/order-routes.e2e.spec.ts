import type { RequestHandler } from "express";
import request from "supertest";
import { beforeAll, describe, expect, it, vi } from "vitest";
import { createApp } from "../../src/app";
import { OrdersService } from "../../src/modules/orders/orders.service";

const addressId = "22222222-2222-4222-8222-222222222222";
const shippingMethodId = "33333333-3333-4333-8333-333333333333";

vi.mock("../../src/common/middlewares/auth.middleware", async () => {
  const { AppError } = await import("../../src/common/errors/app-error.js");
  const { CUSTOMER_PERMISSION_CODES } = await import("../../src/common/auth/rbac.constants.js");
  const requireAuth: RequestHandler = (request, _response, next) => {
    if (!request.headers.authorization) return next(new AppError(401, "Authentication required", "AUTH_UNAUTHORIZED"));
    request.auth = { userId: "11111111-1111-4111-8111-111111111111", sessionId: "44444444-4444-4444-8444-444444444444", roleCodes: ["CUSTOMER"], permissions: request.headers.authorization === "Bearer denied" ? [] : [...CUSTOMER_PERMISSION_CODES] };
    next();
  };
  return { requireAuth, createRequireAuth: vi.fn() };
});

describe("Task 20 Order route integration", () => {
  beforeAll(() => {
    vi.spyOn(OrdersService.prototype, "place").mockResolvedValue({ order: { id: "55555555-5555-4555-8555-555555555555" }, idempotentReplay: false } as never);
    vi.spyOn(OrdersService.prototype, "listOwn").mockResolvedValue({ items: [], pagination: { page: 1, limit: 20, total: 0, totalPages: 0 } });
  });
  const app = createApp();
  const body = { addressId, shippingMethodId };

  it("requires auth, own-scope permission, and a durable Idempotency-Key", async () => {
    expect((await request(app).post("/api/v1/orders").send(body)).status).toBe(401);
    expect((await request(app).post("/api/v1/orders").set("Authorization", "Bearer denied").set("Idempotency-Key", "order-key-12345678").send(body)).status).toBe(403);
    expect((await request(app).post("/api/v1/orders").set("Authorization", "Bearer customer").send(body)).status).toBe(422);
    expect((await request(app).post("/api/v1/orders").set("Authorization", "Bearer customer").set("Idempotency-Key", "order-key-12345678").send(body)).status).toBe(201);
  });

  it("rejects client-controlled status, stock, and totals", async () => {
    const response = await request(app).post("/api/v1/orders").set("Authorization", "Bearer customer").set("Idempotency-Key", "order-key-87654321").send({ ...body, status: "DELIVERED", totalMinor: "1" });
    expect(response.status).toBe(422);
  });

  it("paginates authenticated customer reads", async () => {
    expect((await request(app).get("/api/v1/orders?limit=101").set("Authorization", "Bearer customer")).status).toBe(422);
    expect((await request(app).get("/api/v1/orders").set("Authorization", "Bearer customer")).status).toBe(200);
  });
});
