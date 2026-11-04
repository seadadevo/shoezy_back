import type { PrismaClient } from "@prisma/client";
import { describe, expect, it, vi } from "vitest";
import { CatalogRepository } from "../../src/modules/catalog/catalog.repository";
import { publicProductVisibility } from "../../src/modules/catalog/public-product-visibility";

describe("entity product count queries", () => {
  it("fetches filtered public counts with each entity page and category tree batch", async () => {
    const findBrands = vi.fn().mockResolvedValue([]);
    const findCategories = vi.fn().mockResolvedValue([]);
    const findCollections = vi.fn().mockResolvedValue([]);
    const findCollection = vi.fn().mockResolvedValue(null);
    const count = vi.fn().mockResolvedValue(0);
    const client = {
      brand: { findMany: findBrands, count },
      category: { findMany: findCategories, count },
      collection: { findMany: findCollections, findFirst: findCollection, count },
      $transaction: vi.fn((queries: Promise<unknown>[]) => Promise.all(queries)),
    } as unknown as PrismaClient;
    const repository = new CatalogRepository(client);
    const now = new Date("2026-08-13T12:00:00.000Z");
    const visible = publicProductVisibility(now);
    const query = { page: 1, limit: 20 };

    await repository.listBrands(query, now);
    await repository.listCategories(query, now);
    await repository.listCategoryRoots(query, now);
    await repository.listCategoryChildren(["parent"], now);
    await repository.listCollections(query, now);
    await repository.findCollection("summer", query, now);

    expect(findBrands).toHaveBeenCalledTimes(1);
    expect(findBrands.mock.calls[0]?.[0].select._count.select.products.where).toEqual(visible);
    expect(findCategories).toHaveBeenCalledTimes(3);
    for (const [args] of findCategories.mock.calls) {
      expect(args.select._count.select.productCategories.where).toEqual({ product: visible });
    }
    expect(findCollections).toHaveBeenCalledTimes(1);
    expect(findCollections.mock.calls[0]?.[0].select._count.select.collectionProducts.where).toEqual({ product: visible });
    expect(findCollection.mock.calls[0]?.[0].select._count.select.collectionProducts.where).toEqual({ product: visible });
    expect(count).toHaveBeenCalledTimes(4);
  });
});
