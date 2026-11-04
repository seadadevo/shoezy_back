import request from "supertest";
import { beforeAll, describe, expect, it, vi } from "vitest";
import { createApp } from "../../src/app";
import { CatalogService } from "../../src/modules/catalog/catalog.service";

describe("Task 15 public Catalog route integration", () => {
  beforeAll(() => {
    vi.spyOn(CatalogService.prototype, "listProducts").mockResolvedValue({ items: [], pagination: { page: 1, limit: 20, total: 0, totalPages: 0 } });
    vi.spyOn(CatalogService.prototype, "listFilters").mockResolvedValue({ colors: [] });
    vi.spyOn(CatalogService.prototype, "listBrands").mockResolvedValue({ items: [], pagination: { page: 1, limit: 20, total: 0, totalPages: 0 } });
    vi.spyOn(CatalogService.prototype, "listCategories").mockResolvedValue({ items: [], pagination: { page: 1, limit: 20, total: 0, totalPages: 0 } });
    vi.spyOn(CatalogService.prototype, "categoryTree").mockResolvedValue({ items: [], pagination: { page: 1, limit: 20, total: 0, totalPages: 0 } });
    vi.spyOn(CatalogService.prototype, "listCollections").mockResolvedValue({ items: [], pagination: { page: 1, limit: 20, total: 0, totalPages: 0 } });
    vi.spyOn(CatalogService.prototype, "relatedProducts").mockResolvedValue({ items: [] });
  });
  const app = createApp();

  it("allows anonymous bounded catalog discovery", async () => {
    for (const path of [
      "/api/v1/catalog/products",
      "/api/v1/catalog/filters",
      "/api/v1/catalog/brands",
      "/api/v1/catalog/categories",
      "/api/v1/catalog/categories/tree",
      "/api/v1/catalog/collections",
    ]) expect((await request(app).get(path)).status, path).toBe(200);
  });

  it("passes the existing color query through to server-side catalog filtering", async () => {
    const response = await request(app).get("/api/v1/catalog/products?color=Blue");
    expect(response.status).toBe(200);
    expect(CatalogService.prototype.listProducts).toHaveBeenCalledWith(expect.objectContaining({ color: "Blue" }), "en");
  });

  it("rejects unknown and invalid query values before the controller", async () => {
    expect((await request(app).get("/api/v1/catalog/products?sort=costMinor")).status).toBe(422);
    expect((await request(app).get("/api/v1/catalog/products?limit=101")).status).toBe(422);
    expect((await request(app).get("/api/v1/catalog/products?unknown=true")).status).toBe(422);
  });

  it("serves anonymous related cards by slug with a bounded limit", async () => {
    const response = await request(app).get("/api/v1/catalog/products/trail-shoe/related?limit=3");
    expect(response.status).toBe(200);
    expect(response.body.data).toEqual({ items: [] });
    expect(CatalogService.prototype.relatedProducts).toHaveBeenCalledWith("trail-shoe", 3, "en");
    expect((await request(app).get("/api/v1/catalog/products/trail-shoe/related?limit=21")).status).toBe(422);
    expect((await request(app).get("/api/v1/catalog/products/trail-shoe/related?limit=0")).status).toBe(422);
  });
});
