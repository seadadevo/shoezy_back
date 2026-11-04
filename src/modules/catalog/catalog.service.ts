import { AppError } from "../../common/errors/app-error";
import { toCatalogProductDetailDto, toCatalogProductListDto, toCatalogPromotionDto } from "./catalog.dto";
import { CatalogRepository } from "./catalog.repository";
import type {
  CatalogCollectionQuery,
  CatalogSizeGuideQuery,
  ListCatalogEntitiesQuery,
  ListCatalogProductsQuery,
} from "./catalog.validation";
import { localizedField, type CatalogLocale } from "../../common/localization/catalog-localization";

export interface CatalogStore {
  listProducts: CatalogRepository["listProducts"];
  listColorOptions: CatalogRepository["listColorOptions"];
  findProductBySlug: CatalogRepository["findProductBySlug"];
  relatedProducts: CatalogRepository["relatedProducts"];
  listBrands: CatalogRepository["listBrands"];
  listPromotions: CatalogRepository["listPromotions"];
  listCategories: CatalogRepository["listCategories"];
  listCategoryRoots: CatalogRepository["listCategoryRoots"];
  listCategoryChildren: CatalogRepository["listCategoryChildren"];
  listCollections: CatalogRepository["listCollections"];
  findCollection: CatalogRepository["findCollection"];
  findSizeGuide: CatalogRepository["findSizeGuide"];
}

function pagination(page: number, limit: number, total: number) {
  return { page, limit, total, totalPages: Math.ceil(total / limit) };
}

function localeAndNow(value: CatalogLocale | Date, fallbackNow: Date) {
  return value instanceof Date ? { locale: "en" as const, now: value } : { locale: value, now: fallbackNow };
}

export class CatalogService {
  constructor(private readonly repository: CatalogStore = new CatalogRepository()) {}

  async listProducts(query: ListCatalogProductsQuery, localeOrNow: CatalogLocale | Date = "en", nowInput = new Date()) {
    const { locale, now } = localeAndNow(localeOrNow, nowInput);
    const result = await this.repository.listProducts(query, now, locale);
    const summaries = new Map(result.summaries.map((summary) => [summary.productId, summary]));
    return {
      items: result.items.map((product) => toCatalogProductListDto(product, summaries.get(product.id) ?? { productId: product.id, minimumPriceMinor: null, stockQuantity: 0 }, locale)),
      pagination: pagination(query.page, query.limit, result.total),
    };
  }

  async listFilters(localeOrNow: CatalogLocale | Date = "en", nowInput = new Date()) {
    const { locale, now } = localeAndNow(localeOrNow, nowInput);
    const options = await this.repository.listColorOptions(now);
    const colors: Array<{ value: string; displayValue: string; colorHex: string | null }> = [];
    const seen = new Set<string>();
    for (const option of options) {
      const key = option.value.trim().toLocaleLowerCase("en-US");
      if (!key || seen.has(key)) continue;
      seen.add(key);
      colors.push({
        value: option.value,
        displayValue: localizedField(option.translations, locale, "displayValue", option.displayValue ?? option.value),
        colorHex: option.colorHex,
      });
      if (colors.length >= 100) break;
    }
    return { colors };
  }

  async getProduct(slug: string, localeOrNow: CatalogLocale | Date = "en", nowInput = new Date()) {
    const { locale, now } = localeAndNow(localeOrNow, nowInput);
    const product = await this.repository.findProductBySlug(slug, now, locale);
    if (!product) throw new AppError(404, "Product not found", "PRODUCT_NOT_FOUND");
    return toCatalogProductDetailDto(product, locale, product.promotionPricing, product.ratingSummary, product.colorVariants);
  }

  async relatedProducts(slug: string, limit: number, localeOrNow: CatalogLocale | Date = "en", nowInput = new Date()) {
    const { locale, now } = localeAndNow(localeOrNow, nowInput);
    const result = await this.repository.relatedProducts(slug, limit, now, locale);
    if (!result) throw new AppError(404, "Product not found", "PRODUCT_NOT_FOUND");
    const summaries = new Map(result.summaries.map((summary) => [summary.productId, summary]));
    return { items: result.items.map((product) => toCatalogProductListDto(product, summaries.get(product.id) ?? { productId: product.id, minimumPriceMinor: null, stockQuantity: 0 }, locale)) };
  }

  async listBrands(query: ListCatalogEntitiesQuery, localeOrNow: CatalogLocale | Date = "en", nowInput = new Date()) {
    const { locale, now } = localeAndNow(localeOrNow, nowInput);
    const result = await this.repository.listBrands(query, now);
    return { items: result.items.map(({ translations, _count, ...brand }) => ({ ...brand, productCount: _count.products, name: localizedField(translations, locale, "name", brand.name), description: localizedField(translations, locale, "description", brand.description) })), pagination: pagination(query.page, query.limit, result.total) };
  }

  async listPromotions(localeOrNow: CatalogLocale | Date = "en", nowInput = new Date()) {
    const { locale, now } = localeAndNow(localeOrNow, nowInput);
    const promotions = await this.repository.listPromotions(now);
    return { items: promotions.map((promotion) => toCatalogPromotionDto(promotion, locale)) };
  }

  async listCategories(query: ListCatalogEntitiesQuery, locale: CatalogLocale = "en", now = new Date()) {
    const result = await this.repository.listCategories(query, now);
    return { items: result.items.map(({ translations, _count, ...category }) => ({ ...category, productCount: _count.productCategories, name: localizedField(translations, locale, "name", category.name), description: localizedField(translations, locale, "description", category.description) })), pagination: pagination(query.page, query.limit, result.total) };
  }

  async categoryTree(query: ListCatalogEntitiesQuery, locale: CatalogLocale = "en", now = new Date()) {
    const MAX_TREE_DEPTH = 20;
    const MAX_TREE_NODES = 5_000;
    const result = await this.repository.listCategoryRoots(query, now);
    type TreeNode = (typeof result.items)[number] & { children: TreeNode[] };
    type TreeDto = Omit<(typeof result.items)[number], "translations" | "_count"> & { productCount: number; children: TreeDto[] };
    const roots: TreeNode[] = result.items.map((category) => ({ ...category, children: [] }));
    const nodes = new Map(roots.map((category) => [category.id, category]));
    let frontier = roots;
    for (let depth = 1; frontier.length > 0; depth += 1) {
      const children = await this.repository.listCategoryChildren(frontier.map((category) => category.id), now);
      if (children.length === 0) break;
      if (depth >= MAX_TREE_DEPTH) {
        throw new AppError(500, "Category tree exceeds maximum depth", "CATEGORY_TREE_LIMIT_EXCEEDED");
      }
      if (nodes.size + children.length > MAX_TREE_NODES) {
        throw new AppError(500, "Category tree exceeds maximum node count", "CATEGORY_TREE_LIMIT_EXCEEDED");
      }
      const next: TreeNode[] = [];
      for (const child of children) {
        if (nodes.has(child.id)) {
          throw new AppError(500, "Category tree contains a cycle", "CATEGORY_TREE_INVALID");
        }
        const parent = child.parentId ? nodes.get(child.parentId) : undefined;
        if (!parent) throw new AppError(500, "Category tree parent is missing", "CATEGORY_TREE_INVALID");
        const node: TreeNode = { ...child, children: [] };
        parent.children.push(node);
        nodes.set(node.id, node);
        next.push(node);
      }
      frontier = next;
    }
    const localize = (node: TreeNode): TreeDto => { const { translations, children, _count, ...category } = node; return { ...category, productCount: _count.productCategories, name: localizedField(translations, locale, "name", category.name), description: localizedField(translations, locale, "description", category.description), children: children.map(localize) }; };
    return { items: roots.map(localize), pagination: pagination(query.page, query.limit, result.total) };
  }

  async listCollections(query: ListCatalogEntitiesQuery, localeOrNow: CatalogLocale | Date = "en", nowInput = new Date()) {
    const { locale, now } = localeAndNow(localeOrNow, nowInput);
    const result = await this.repository.listCollections(query, now);
    return { items: result.items.map((collection) => { const { translations, _count, ...fields } = collection; return { ...fields, productCount: _count.collectionProducts, name: localizedField(translations, locale, "name", collection.name), description: localizedField(translations, locale, "description", collection.description) }; }), pagination: pagination(query.page, query.limit, result.total) };
  }

  async getCollection(slug: string, query: CatalogCollectionQuery, localeOrNow: CatalogLocale | Date = "en", nowInput = new Date()) {
    const { locale, now } = localeAndNow(localeOrNow, nowInput);
    const result = await this.repository.findCollection(slug, query, now, locale);
    if (!result) throw new AppError(404, "Collection not found", "COLLECTION_NOT_FOUND");
    const summaries = new Map(result.summaries.map((summary) => [summary.productId, summary]));
    return {
      ...(() => { const { translations, _count, ...fields } = result.collection; return { ...fields, productCount: _count.collectionProducts, name: localizedField(translations, locale, "name", result.collection.name), description: localizedField(translations, locale, "description", result.collection.description) }; })(),
      products: {
        items: result.products.map((product) => toCatalogProductListDto(product, summaries.get(product.id) ?? { productId: product.id, minimumPriceMinor: null, stockQuantity: 0 }, locale)),
        pagination: pagination(query.page, query.limit, result.total),
      },
    };
  }

  async getSizeGuide(sizeGuideId: string, query: CatalogSizeGuideQuery) {
    const result = await this.repository.findSizeGuide(sizeGuideId, query);
    if (!result) throw new AppError(404, "Size guide not found", "SIZE_GUIDE_NOT_FOUND");
    return {
      ...result.guide,
      entries: result.entries.map((entry) => ({
        ...entry,
        footLengthCm: entry.footLengthCm?.toString() ?? null,
      })),
      entryPagination: pagination(query.page, query.limit, result.total),
    };
  }
}
