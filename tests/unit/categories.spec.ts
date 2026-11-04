import { describe, expect, it, vi } from "vitest";
import { toCategoryTree } from "../../src/modules/categories/categories.dto";
import { CategoriesService, type CategoriesStore } from "../../src/modules/categories/categories.service";
import type { CategoryRecord } from "../../src/modules/categories/categories.types";
import { categorySelect } from "../../src/modules/categories/categories.types";

const rootId = "11111111-1111-4111-8111-111111111111";
const childId = "22222222-2222-4222-8222-222222222222";
const deepId = "33333333-3333-4333-8333-333333333333";
function category(id: string, parentId: string | null, name: string, sortOrder = 0): CategoryRecord {
  return { id, parentId, name, slug: name.toLowerCase(), description: null, imageUrl: null, videoUrl: null, videoMimeType: null, videoStorageProvider: null, videoStorageKey: null, sortOrder, isActive: true, createdAt: new Date(), updatedAt: new Date(), _count: { productCategories: 0 }, translations: [] };
}
function store(records = [category(rootId, null, "Root"), category(childId, rootId, "Child")]): CategoriesStore {
  return {
    list: vi.fn(async () => ({ items: records, total: records.length })),
    listAll: vi.fn(async () => records),
    listParentLinks: vi.fn(async () => records.map(({ id, parentId }) => ({ id, parentId }))),
    findById: vi.fn(async (id) => records.find((record) => record.id === id) ?? null),
    create: vi.fn(async (input) => category(deepId, input.parentId ?? null, input.name)),
    update: vi.fn(async (id, input) => {
      const current = records.find((record) => record.id === id);
      return current ? { ...current, ...input } : null;
    }),
    deleteIfUnused: vi.fn(async () => "DELETED" as const),
  };
}

describe("category tree", () => {
  it("counts direct links in lists and each tree node, excluding deleted products in the query", async () => {
    const parent = category(rootId, null, "Root");
    const child = { ...category(childId, rootId, "Child"), _count: { productCategories: 3 } };
    const service = new CategoriesService(store([parent, child]));
    const list = await service.list({ page: 1, limit: 20, sortBy: "sortOrder", sortOrder: "asc" });
    expect(list.items.map((item) => item.productCount)).toEqual([0, 3]);
    expect((await service.get(rootId)).productCount).toBe(0);
    const tree = await service.tree();
    expect(tree[0]?.productCount).toBe(0);
    expect(tree[0]?.children[0]?.productCount).toBe(3);
    expect(JSON.stringify(tree)).not.toContain("_count");
    expect(categorySelect._count.select.productCategories.where).toEqual({ product: { deletedAt: null } });
  });
  it("builds and deterministically sorts a tree", () => {
    const result = toCategoryTree([
      category(childId, rootId, "Zulu", 1),
      category(deepId, rootId, "Alpha", 1),
      category(rootId, null, "Root"),
    ]);
    expect(result).toHaveLength(1);
    expect(result[0]?.children.map((child) => child.name)).toEqual(["Alpha", "Zulu"]);
  });

  it("terminates defensively for corrupted cycles", () => {
    const result = toCategoryTree([
      category(rootId, childId, "A"),
      category(childId, rootId, "B"),
    ]);
    expect(result).toHaveLength(1);
    expect(JSON.stringify(result).length).toBeLessThan(2_000);
  });
});

describe("category parent integrity", () => {
  it("rejects self-parenting", async () => {
    const repository = store();
    vi.mocked(repository.update).mockResolvedValue("SELF_PARENT");
    await expect(new CategoriesService(repository).update(rootId, { parentId: rootId })).rejects.toMatchObject({ code: "CATEGORY_PARENT_INVALID" });
  });

  it("rejects a two-node cycle", async () => {
    const repository = store();
    vi.mocked(repository.update).mockResolvedValue("CYCLE");
    await expect(new CategoriesService(repository).update(rootId, { parentId: childId })).rejects.toMatchObject({ code: "CATEGORY_CYCLE" });
  });

  it("rejects a deep cycle", async () => {
    const records = [
      category(rootId, null, "A"),
      category(childId, rootId, "B"),
      category(deepId, childId, "C"),
    ];
    const repository = store(records);
    vi.mocked(repository.update).mockResolvedValue("CYCLE");
    await expect(new CategoriesService(repository).update(rootId, { parentId: deepId })).rejects.toMatchObject({ code: "CATEGORY_CYCLE" });
  });

  it("allows moving a category under an unrelated valid parent", async () => {
    const records = [category(rootId, null, "A"), category(childId, null, "B"), category(deepId, rootId, "C")];
    const repository = store(records);
    await new CategoriesService(repository).update(deepId, { parentId: childId });
    expect(repository.update).toHaveBeenCalledWith(deepId, { parentId: childId });
  });
});

describe("category deletion safety", () => {
  it.each([
    ["HAS_CHILDREN", "CATEGORY_HAS_CHILDREN"],
    ["IN_USE", "CATEGORY_IN_USE"],
  ] as const)("maps %s to %s", async (repositoryResult, code) => {
    const repository = store();
    vi.mocked(repository.deleteIfUnused).mockResolvedValue(repositoryResult);
    await expect(new CategoriesService(repository).delete(rootId)).rejects.toMatchObject({ statusCode: 409, code });
  });
  it("prevents deactivating a required active category", async () => {
    const repository = store();
    vi.mocked(repository.update).mockResolvedValue("WOULD_INVALIDATE_PRODUCT");
    await expect(new CategoriesService(repository).update(rootId, { isActive: false })).rejects.toMatchObject({
      code: "PRODUCT_WOULD_BECOME_INVALID",
    });
  });
});
