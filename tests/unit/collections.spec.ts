import { describe, expect, it, vi } from "vitest";
import { CollectionsRepositoryError } from "../../src/modules/collections/collections.repository";
import { CollectionsService, type CollectionsStore } from "../../src/modules/collections/collections.service";
import type { CollectionDetailRecord, CollectionRecord } from "../../src/modules/collections/collections.types";
import { collectionSelect } from "../../src/modules/collections/collections.types";
import { replaceCollectionProductsSchema } from "../../src/modules/collections/collections.validation";

const collectionId = "11111111-1111-4111-8111-111111111111";
const productId = "22222222-2222-4222-8222-222222222222";

function collection(overrides: Partial<CollectionRecord> = {}): CollectionRecord {
  return {
    id: collectionId,
    name: "Summer Drop",
    slug: "summer-drop",
    description: null,
    imageUrl: null,
    videoUrl: null,
    videoMimeType: null,
    videoStorageProvider: null,
    videoStorageKey: null,
    isActive: true,
    startsAt: null,
    endsAt: null,
    createdAt: new Date("2026-08-13T00:00:00.000Z"),
    updatedAt: new Date("2026-08-13T00:00:00.000Z"),
    _count: { collectionProducts: 0 },
    translations: [],
    ...overrides,
  };
}

function detail(overrides: Partial<CollectionDetailRecord> = {}): CollectionDetailRecord {
  return { ...collection(), collectionProducts: [], ...overrides };
}

function store(): CollectionsStore {
  return {
    list: vi.fn(async () => ({ items: [collection()], total: 1 })),
    findById: vi.fn(async (id) => id === collectionId ? detail() : null),
    create: vi.fn(async (input) => collection({ ...input })),
    update: vi.fn(async (id, input) => id === collectionId ? collection({ ...input }) : null),
    replaceProducts: vi.fn(async (id) => id === collectionId ? "UPDATED" as const : "COLLECTION_NOT_FOUND" as const),
    delete: vi.fn(async (id) => id === collectionId),
  };
}

describe("collections service", () => {
  it("returns numeric counts on list and detail from non-deleted product links", async () => {
    const repository = store();
    vi.mocked(repository.list).mockResolvedValue({ items: [collection(), collection({ id: "other", _count: { collectionProducts: 2 } })], total: 2 });
    vi.mocked(repository.findById).mockResolvedValue(detail({ _count: { collectionProducts: 2 } }));
    const service = new CollectionsService(repository);
    const list = await service.list({ page: 1, limit: 20, sortBy: "createdAt", sortOrder: "desc" });
    expect(list.items.map((item) => item.productCount)).toEqual([0, 2]);
    expect((await service.get(collectionId)).productCount).toBe(2);
    expect(JSON.stringify(list)).not.toContain("_count");
    expect(collectionSelect._count.select.collectionProducts.where).toEqual({ product: { deletedAt: null } });
  });
  it("normalizes a slug and creates a schema-backed collection", async () => {
    const repository = store();
    const result = await new CollectionsService(repository).create({ name: " Été  Collection " });
    expect(result.slug).toBe("été-collection");
    expect(repository.create).toHaveBeenCalledWith(expect.objectContaining({ slug: "été-collection" }));
  });

  it("maps unique slug collisions to a stable conflict", async () => {
    const repository = store();
    vi.mocked(repository.create).mockRejectedValue(new CollectionsRepositoryError("DUPLICATE_SLUG"));
    await expect(new CollectionsService(repository).create({ name: "Summer" }))
      .rejects.toMatchObject({ statusCode: 409, code: "COLLECTION_SLUG_ALREADY_EXISTS" });
  });

  it("maps the database date CHECK without leaking its constraint name", async () => {
    const repository = store();
    vi.mocked(repository.update).mockRejectedValue(new CollectionsRepositoryError("INVALID_DATE_RANGE"));
    await expect(new CollectionsService(repository).update(collectionId, { name: "Concurrent update" }))
      .rejects.toMatchObject({ statusCode: 400, code: "COLLECTION_DATE_RANGE_INVALID" });
  });

  it("validates create and update date windows", async () => {
    const service = new CollectionsService(store());
    await expect(service.create({
      name: "Invalid",
      startsAt: "2026-08-14T00:00:00.000Z",
      endsAt: "2026-08-13T00:00:00.000Z",
    })).rejects.toMatchObject({ code: "COLLECTION_DATE_RANGE_INVALID" });
    await expect(service.update(collectionId, {
      startsAt: "2026-08-14T00:00:00.000Z",
      endsAt: "2026-08-14T00:00:00.000Z",
    })).rejects.toMatchObject({ code: "COLLECTION_DATE_RANGE_INVALID" });
  });

  it("returns bounded pagination and ordered product assignments", async () => {
    const repository = store();
    vi.mocked(repository.findById).mockResolvedValue(detail({
      collectionProducts: [{
        position: 3,
        product: { id: productId, name: "Shoe", slug: "shoe", status: "DRAFT", deletedAt: null, translations: [] },
      }],
    }));
    const list = await new CollectionsService(repository).list({
      page: 2,
      limit: 10,
      sortBy: "createdAt",
      sortOrder: "desc",
    });
    expect(list.pagination).toEqual({ page: 2, limit: 10, total: 1, totalPages: 1 });
    const result = await new CollectionsService(repository).replaceProducts(collectionId, {
      products: [{ productId, position: 3 }],
    });
    expect(result.products).toEqual([expect.objectContaining({ id: productId, position: 3 })]);
  });

  it.each([
    ["COLLECTION_NOT_FOUND", "COLLECTION_NOT_FOUND"],
    ["PRODUCT_NOT_FOUND", "PRODUCT_NOT_FOUND"],
  ] as const)("maps assignment result %s", async (status, code) => {
    const repository = store();
    vi.mocked(repository.replaceProducts).mockResolvedValue(status);
    await expect(new CollectionsService(repository).replaceProducts(collectionId, { products: [] }))
      .rejects.toMatchObject({ statusCode: 404, code });
  });

  it("deletes the Collection without issuing Product deletion through the service", async () => {
    const repository = store();
    await new CollectionsService(repository).delete(collectionId);
    expect(repository.delete).toHaveBeenCalledWith(collectionId);
  });
});

describe("collection product assignment validation", () => {
  const parse = (products: unknown[]) => replaceCollectionProductsSchema.safeParse({
    body: { products },
    params: { collectionId },
    query: {},
  }).success;

  it("rejects duplicate IDs and invalid positions", () => {
    expect(parse([{ productId, position: 0 }, { productId, position: 1 }])).toBe(false);
    expect(parse([{ productId, position: -1 }])).toBe(false);
    expect(parse([{ productId, position: 2_147_483_648 }])).toBe(false);
  });

  it("accepts unique bounded assignments and replacement with an empty set", () => {
    expect(parse([{ productId, position: 0 }])).toBe(true);
    expect(parse([])).toBe(true);
  });
});
