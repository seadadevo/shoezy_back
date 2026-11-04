import type { RequestHandler } from "express";
import request from "supertest";
import { beforeAll, describe, expect, it, vi } from "vitest";
import { createApp } from "../../src/app";
import { AddressesService } from "../../src/modules/addresses/addresses.service";
import { BrandsService } from "../../src/modules/brands/brands.service";
import { CategoriesService } from "../../src/modules/categories/categories.service";
import { CartsService } from "../../src/modules/carts/carts.service";
import { CollectionsService } from "../../src/modules/collections/collections.service";
import { ProductOptionsService } from "../../src/modules/products/product-options.service";
import { ProductsService } from "../../src/modules/products/products.service";
import { SizeGuidesService } from "../../src/modules/size-guides/size-guides.service";
import { UsersService } from "../../src/modules/users/users.service";
import { VariantsService } from "../../src/modules/variants/variants.service";

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

describe("Tasks 05-12 route integration", () => {
  beforeAll(() => {
    vi.spyOn(UsersService.prototype, "getProfile").mockResolvedValue({
      id: "11111111-1111-4111-8111-111111111111",
      email: "customer@example.com",
      phone: null,
      firstName: "Test",
      lastName: "Customer",
      status: "ACTIVE",
      provider: "EMAIL",
      emailVerifiedAt: null,
      phoneVerifiedAt: null,
      lastLoginAt: null,
      createdAt: new Date(),
      updatedAt: new Date(),
    });
    vi.spyOn(UsersService.prototype, "changePassword").mockResolvedValue(undefined);
    vi.spyOn(AddressesService.prototype, "list").mockResolvedValue([]);
    vi.spyOn(BrandsService.prototype, "list").mockResolvedValue({ items: [], pagination: { page: 1, limit: 20, total: 0, totalPages: 0 } });
    vi.spyOn(CategoriesService.prototype, "tree").mockResolvedValue([]);
    vi.spyOn(CollectionsService.prototype, "list").mockResolvedValue({ items: [], pagination: { page: 1, limit: 20, total: 0, totalPages: 0 } });
    vi.spyOn(SizeGuidesService.prototype, "list").mockResolvedValue({ items: [], pagination: { page: 1, limit: 20, total: 0, totalPages: 0 } });
    vi.spyOn(ProductsService.prototype, "list").mockResolvedValue({ items: [], pagination: { page: 1, limit: 20, total: 0, totalPages: 0 } });
    vi.spyOn(ProductOptionsService.prototype, "list").mockResolvedValue([]);
    vi.spyOn(VariantsService.prototype, "list").mockResolvedValue({ items: [], pagination: { page: 1, limit: 20, total: 0, totalPages: 0 } });
    vi.spyOn(CartsService.prototype, "get").mockResolvedValue({ id: null, items: [] } as never);
  });

  const app = createApp();

  it("passes customer profile and address requests through validation, auth, permission, and controller", async () => {
    expect((await request(app).get("/api/v1/users/me")).status).toBe(401);
    expect((await request(app).get("/api/v1/users/me").set("Authorization", "Bearer customer")).status).toBe(200);
    expect((await request(app).get("/api/v1/addresses").set("Authorization", "Bearer customer")).status).toBe(200);
    expect((await request(app).post("/api/v1/auth/change-password").set("Authorization", "Bearer customer").send({ currentPassword: "current-password-123", newPassword: "different-password-456" })).status).toBe(200);
  });

  it("denies a customer and allows an RBAC admin through every mounted catalog module", async () => {
    expect((await request(app).get("/api/v1/admin/brands").set("Authorization", "Bearer customer")).status).toBe(403);
    expect((await request(app).get("/api/v1/admin/collections").set("Authorization", "Bearer customer")).status).toBe(403);
    const paths = [
      "/api/v1/admin/brands",
      "/api/v1/admin/categories/tree",
      "/api/v1/admin/size-guides",
      "/api/v1/admin/products",
      `/api/v1/admin/products/${productId}/options`,
      `/api/v1/admin/products/${productId}/variants`,
      "/api/v1/admin/collections",
    ];
    for (const path of paths) {
      const response = await request(app).get(path).set("Authorization", "Bearer admin");
      expect(response.status, path).toBe(200);
    }
  });

  it("mounts the completed authenticated Cart module", async () => {
    expect((await request(app).get("/api/v1/cart").set("Authorization", "Bearer customer")).status).toBe(200);
  });
});
