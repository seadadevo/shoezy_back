import type { RequestHandler } from "express";
import request from "supertest";
import { beforeAll, describe, expect, it, vi } from "vitest";
import { createApp } from "../../src/app";
import { ShippingService } from "../../src/modules/shipping/shipping.service";

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

describe("Task 22 Shipping route integration", () => {
  beforeAll(() => {
    vi.spyOn(ShippingService.prototype, "listAdmin").mockResolvedValue({ items: [], pagination: { page: 1, limit: 20, total: 0, totalPages: 0 } });
    vi.spyOn(ShippingService.prototype, "updateOrderShipping").mockResolvedValue({ orderId } as never);
    vi.spyOn(ShippingService.prototype, "getOwnShipment").mockResolvedValue({ orderId } as never);
  });
  const app = createApp();

  it("protects ShippingMethod administration with explicit permission", async () => {
    expect((await request(app).get("/api/v1/admin/shipping-methods")).status).toBe(401);
    expect((await request(app).get("/api/v1/admin/shipping-methods").set("Authorization", "Bearer customer")).status).toBe(403);
    expect((await request(app).get("/api/v1/admin/shipping-methods").set("Authorization", "Bearer admin")).status).toBe(200);
  });

  it("rejects numeric money and mass-assigned Order status", async () => {
    expect((await request(app).post("/api/v1/admin/shipping-methods").set("Authorization", "Bearer admin").send({ code: "FAST", name: "Fast", basePriceMinor: 1000 })).status).toBe(422);
    expect((await request(app).patch(`/api/v1/admin/orders/${orderId}/shipping`).set("Authorization", "Bearer admin").send({ trackingNumber: "TN-1", status: "DELIVERED" })).status).toBe(422);
  });

  it("scopes shipment reads to authenticated own Orders", async () => {
    expect((await request(app).get(`/api/v1/orders/${orderId}/shipment`)).status).toBe(401);
    expect((await request(app).get(`/api/v1/orders/${orderId}/shipment`).set("Authorization", "Bearer customer")).status).toBe(200);
  });
});
