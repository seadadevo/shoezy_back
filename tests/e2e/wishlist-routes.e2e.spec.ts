import type { RequestHandler } from "express";
import request from "supertest";
import { beforeAll, describe, expect, it, vi } from "vitest";
import { createApp } from "../../src/app";
import { WishlistsService } from "../../src/modules/wishlists/wishlists.service";

const productId = "22222222-2222-4222-8222-222222222222";

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

describe("Task 17 Wishlist route integration", () => {
  beforeAll(() => {
    vi.spyOn(WishlistsService.prototype, "list").mockResolvedValue({ items: [], pagination: { page: 1, limit: 20, total: 0, totalPages: 0 } });
    vi.spyOn(WishlistsService.prototype, "add").mockResolvedValue({ id: "44444444-4444-4444-8444-444444444444" } as never);
  });
  const app = createApp();

  it("requires authentication and the own-scope permission", async () => {
    expect((await request(app).get("/api/v1/wishlist")).status).toBe(401);
    expect((await request(app).get("/api/v1/wishlist").set("Authorization", "Bearer denied")).status).toBe(403);
    expect((await request(app).get("/api/v1/wishlist").set("Authorization", "Bearer customer")).status).toBe(200);
  });

  it("runs strict validation before the controller", async () => {
    const response = await request(app).post("/api/v1/wishlist/items").set("Authorization", "Bearer customer").send({ productId, userId: productId });
    expect(response.status).toBe(422);
    expect(WishlistsService.prototype.add).not.toHaveBeenCalled();
  });
});
