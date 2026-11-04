import request from "supertest";
import { describe, expect, it } from "vitest";
import { createApp } from "../../src/app";

const uuid = "11111111-1111-4111-8111-111111111111";
describe("new administration route guards", () => {
  const app = createApp();
  it.each([
    ["get", "/api/v1/admin/store-settings"],
    ["patch", "/api/v1/admin/store-settings"],
    ["get", "/api/v1/admin/shipping-zones"],
    ["get", "/api/v1/admin/inventory/movements"],
    ["get", "/api/v1/admin/exchanges"],
    ["get", "/api/v1/admin/customers"],
    ["post", `/api/v1/admin/products/${uuid}/media/upload`],
  ] as const)("requires authentication for %s %s", async (method, path) => {
    const response = await request(app)[method](path).send(method === "patch" ? { storeName: "Shoozy" } : undefined);
    expect(response.status).toBe(401);
    expect(response.body.error.code).toBe("AUTH_UNAUTHORIZED");
  });
});
