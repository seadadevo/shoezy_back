import type { RequestHandler } from "express";
import request from "supertest";
import { beforeAll, describe, expect, it, vi } from "vitest";
import { createApp } from "../../src/app";
import { CheckoutService } from "../../src/modules/checkout/checkout.service";
import { ShippingService } from "../../src/modules/shipping/shipping.service";

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

describe("Task 19 Checkout route integration", () => {
  beforeAll(() => {
    vi.spyOn(CheckoutService.prototype, "preview").mockResolvedValue({ advisory: true } as never);
    vi.spyOn(ShippingService.prototype, "listPublic").mockResolvedValue({ items: [], pagination: { page: 1, limit: 20, total: 0, totalPages: 0 } });
  });
  const app = createApp();

  it("publishes bounded active Shipping Methods without authentication", async () => {
    expect((await request(app).get("/api/v1/shipping-methods")).status).toBe(200);
    expect((await request(app).get("/api/v1/shipping-methods?limit=101")).status).toBe(422);
  });

  it("requires auth and own-scope Cart permission for preview", async () => {
    const body = { addressId, shippingMethodId };
    expect((await request(app).post("/api/v1/checkout/preview").send(body)).status).toBe(401);
    expect((await request(app).post("/api/v1/checkout/preview").set("Authorization", "Bearer denied").send(body)).status).toBe(403);
    expect((await request(app).post("/api/v1/checkout/preview").set("Authorization", "Bearer customer").send(body)).status).toBe(200);
  });

  it("rejects client-controlled totals", async () => {
    const response = await request(app).post("/api/v1/checkout/preview").set("Authorization", "Bearer customer").send({ addressId, shippingMethodId, totalMinor: "1" });
    expect(response.status).toBe(422);
  });
});
