import type { CategoryRecord, CategoryTreeDto } from "./categories.types";
import { translationsByLocale } from "../../common/localization/catalog-localization";

export function toCategoryDto(category: CategoryRecord) {
  return {
    id: category.id,
    parentId: category.parentId,
    name: category.name,
    slug: category.slug,
    productCount: category._count.productCategories,
    description: category.description,
    imageUrl: category.imageUrl,
    videoUrl: category.videoUrl,
    videoMimeType: category.videoMimeType,
    sortOrder: category.sortOrder,
    isActive: category.isActive,
    createdAt: category.createdAt,
    updatedAt: category.updatedAt,
    translations: translationsByLocale(category.translations),
  };
}

function compare(left: CategoryRecord, right: CategoryRecord): number {
  return left.sortOrder - right.sortOrder || left.name.localeCompare(right.name) || left.id.localeCompare(right.id);
}

export function toCategoryTree(categories: CategoryRecord[]): CategoryTreeDto[] {
  const records = new Map(categories.map((category) => [category.id, category]));
  const children = new Map<string | null, CategoryRecord[]>();
  for (const category of categories) {
    const parentId = category.parentId && records.has(category.parentId) ? category.parentId : null;
    children.set(parentId, [...(children.get(parentId) ?? []), category]);
  }
  for (const list of children.values()) list.sort(compare);

  const emitted = new Set<string>();
  const build = (category: CategoryRecord, path: Set<string>): CategoryTreeDto | null => {
    if (path.has(category.id) || emitted.has(category.id)) return null;
    const nextPath = new Set(path).add(category.id);
    emitted.add(category.id);
    const nested = (children.get(category.id) ?? [])
      .map((child) => build(child, nextPath))
      .filter((child): child is CategoryTreeDto => child !== null);
    const { parentId: _parentId, translations, _count, videoStorageProvider: _videoStorageProvider, videoStorageKey: _videoStorageKey, ...data } = category;
    return { ...data, productCount: _count.productCategories, translations: translationsByLocale(translations), children: nested };
  };

  const roots = (children.get(null) ?? []).map((category) => build(category, new Set())).filter((node): node is CategoryTreeDto => node !== null);
  // Corrupted closed cycles have no root. Emit each remaining node once as a
  // defensive root and stop traversal on the first repeated identifier.
  for (const category of [...categories].sort(compare)) {
    if (!emitted.has(category.id)) {
      const node = build(category, new Set());
      if (node) roots.push(node);
    }
  }
  return roots;
}
