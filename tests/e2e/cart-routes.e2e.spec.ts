import type { RequestHandler } from "express";
import request from "supertest";
import { beforeAll, describe, expect, it, vi } from "vitest";
import { createApp } from "../../src/app";
import { CartsService } from "../../src/modules/carts/carts.service";

const variantId = "22222222-2222-4222-8222-222222222222";

vi.mock("../../src/common/middlewares/auth.middleware", async () => {
  const { AppError } = await import("../../src/common/errors/app-error.js");
  const { CUSTOMER_PERMISSION_CODES } = await import("../../src/common/auth/rbac.constants.js");
  const requireAuth: RequestHandler = (request, _response, next) => {
    if (!request.headers.authorization) return next(new AppError(401, "Authentication required", "AUTH_UNAUTHORIZED"));
    request.auth = { userId: "11111111-1111-4111-8111-111111111111", sessionId: "33333333-3333-4333-8333-333333333333", roleCodes: ["CUSTOMER"], permissions: request.headers.authorization === "Bearer denied" ? [] : [...CUSTOMER_PERMISSION_CODES] };
    next();
  };
  return { requireAuth, createRequireAuth: vi.fn() };
});

describe("Task 18 Cart route integration", () => {
  beforeAll(() => {
    vi.spyOn(CartsService.prototype, "get").mockResolvedValue({ id: null, items: [] } as never);
    vi.spyOn(CartsService.prototype, "addItem").mockResolvedValue({ id: "44444444-4444-4444-8444-444444444444", items: [] } as never);
  });
  const app = createApp();

  it("requires authentication and database-derived own-scope permission", async () => {
    expect((await request(app).get("/api/v1/cart")).status).toBe(401);
    expect((await request(app).get("/api/v1/cart").set("Authorization", "Bearer denied")).status).toBe(403);
    expect((await request(app).get("/api/v1/cart").set("Authorization", "Bearer customer")).status).toBe(200);
  });

  it("rejects mass assignment and unsafe quantities", async () => {
    const injected = await request(app).post("/api/v1/cart/items").set("Authorization", "Bearer customer").send({ variantId, quantity: 1, unitPriceMinor: "1" });
    const overflow = await request(app).post("/api/v1/cart/items").set("Authorization", "Bearer customer").send({ variantId, quantity: 2_147_483_648 });
    expect(injected.status).toBe(422);
    expect(overflow.status).toBe(422);
    expect(CartsService.prototype.addItem).not.toHaveBeenCalled();
  });
});
