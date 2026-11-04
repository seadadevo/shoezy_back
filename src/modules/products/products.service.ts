import { Prisma } from "@prisma/client";
import { AppError } from "../../common/errors/app-error";
import { normalizeSlug } from "../../common/utils/slug";
import { toProductDetailDto, toProductDto } from "./products.dto";
import { ProductsRepository, ProductsRepositoryError } from "./products.repository";
import { assertProductReady } from "./products-readiness";
import type { CreateProductInput, ListProductsQuery, ReplaceProductCategoriesInput, UpdateProductInput } from "./products.validation";

export interface ProductsStore {
  list: ProductsRepository["list"];
  findById: ProductsRepository["findById"];
  findDetail: ProductsRepository["findDetail"];
  findBrand: ProductsRepository["findBrand"];
  findSizeGuide: ProductsRepository["findSizeGuide"];
  readiness: ProductsRepository["readiness"];
  create: ProductsRepository["create"];
  update: ProductsRepository["update"];
  activate: ProductsRepository["activate"];
  replaceCategories: ProductsRepository["replaceCategories"];
  softDelete: ProductsRepository["softDelete"];
  searchModels?: (query: { q?: string; excludeProductId?: string }) => Promise<any>;
}

function slug(value: string) {
  const result = normalizeSlug(value);
  if (!result || result.length > 250) throw new AppError(422, "Product slug is invalid", "PRODUCT_SLUG_INVALID");
  return result;
}

function prices(base: string, compare: string | null | undefined) {
  const baseValue = new Prisma.Decimal(base);
  if (compare !== null && compare !== undefined && new Prisma.Decimal(compare).lessThan(baseValue)) {
    throw new AppError(400, "Compare-at price must not be lower than base price", "PRODUCT_PRICE_INVALID");
  }
}

export class ProductsService {
  constructor(private readonly repository: ProductsStore = new ProductsRepository()) {}

  private map(error: unknown): never {
    if (error instanceof ProductsRepositoryError) {
      if (error.code === "DUPLICATE_GROUP_COLOR") {
        throw new AppError(409, "A product with this color already exists in this model group", "PRODUCT_COLOR_ALREADY_EXISTS");
      }
      throw new AppError(409, "A product already uses this slug", "PRODUCT_SLUG_ALREADY_EXISTS");
    }
    throw error;
  }

  private async relations(brandId: string, sizeGuideId?: string | null) {
    const brand = await this.repository.findBrand(brandId);
    if (!brand) throw new AppError(404, "Brand not found", "BRAND_NOT_FOUND");
    if (sizeGuideId && !(await this.repository.findSizeGuide(sizeGuideId))) throw new AppError(404, "Size guide not found", "SIZE_GUIDE_NOT_FOUND");
    return brand;
  }

  private assertReady = assertProductReady;

  async list(query: ListProductsQuery) {
    const result = await this.repository.list(query);
    return {
      items: result.items.map(toProductDto),
      pagination: {
        page: query.page,
        limit: query.limit,
        total: result.total,
        totalPages: Math.ceil(result.total / query.limit),
      },
    };
  }

  async get(id: string) {
    const product = await this.repository.findDetail(id);
    if (!product) throw new AppError(404, "Product not found", "PRODUCT_NOT_FOUND");
    return toProductDetailDto(product);
  }

  async searchModels(query: { q?: string; excludeProductId?: string }) {
    if (typeof this.repository.searchModels === "function") {
      return this.repository.searchModels(query);
    }
    return [];
  }

  async create(input: CreateProductInput) {
    let groupId: string | undefined = undefined;
    if (input.linkToProductId) {
      const target = await this.repository.findById(input.linkToProductId);
      if (!target) {
        throw new AppError(404, "Target product not found", "TARGET_PRODUCT_NOT_FOUND");
      }
      if (!input.colorName?.trim()) {
        throw new AppError(422, "Color name is required when linking to an existing model product", "PRODUCT_COLOR_NAME_REQUIRED");
      }
      groupId = target.groupId;
    }

    await this.relations(input.brandId, input.sizeGuideId);
    prices(input.basePrice, input.compareAtPrice);

    const derivedSlug = slug(input.slug ?? (input.linkToProductId && input.colorName ? `${input.name}-${input.colorName}` : input.name));

    try {
      return toProductDto(
        await this.repository.create({
          ...input,
          groupId,
          slug: derivedSlug,
          status: "DRAFT",
        }),
      );
    } catch (error: unknown) {
      this.map(error);
    }
  }

  async update(id: string, input: UpdateProductInput) {
    const current = await this.repository.findById(id, true);
    if (!current || current.deletedAt) throw new AppError(404, "Product not found", "PRODUCT_NOT_FOUND");
    if (input.brandId) await this.relations(input.brandId, input.sizeGuideId);
    else if (input.sizeGuideId) await this.relations(current.brandId, input.sizeGuideId);
    prices(input.basePrice ?? current.basePrice.toString(), input.compareAtPrice === undefined ? current.compareAtPrice?.toString() : input.compareAtPrice);
    const finalStatus = input.status ?? current.status;

    let groupIdUpdate: { groupId?: string } = {};
    if (input.unlinkFromGroup === true) {
      groupIdUpdate = { groupId: crypto.randomUUID() };
    }

    const data = {
      ...input,
      ...groupIdUpdate,
      ...(input.slug !== undefined ? { slug: slug(input.slug) } : {}),
      ...(finalStatus === "ACTIVE" && !current.publishedAt ? { publishedAt: new Date() } : {}),
    };

    try {
      const product = finalStatus === "ACTIVE"
        ? await this.repository.activate(id, data, (state) => this.assertReady(state, id))
        : await this.repository.update(id, data);
      if (!product) throw new AppError(404, "Product not found", "PRODUCT_NOT_FOUND");
      return toProductDto(product);
    } catch (error: unknown) {
      this.map(error);
    }
  }

  async replaceCategories(id: string, input: ReplaceProductCategoriesInput) {
    const result = await this.repository.replaceCategories(id, input);
    if (result === "PRODUCT_NOT_FOUND") throw new AppError(404, "Product not found", "PRODUCT_NOT_FOUND");
    if (result === "CATEGORY_NOT_FOUND") throw new AppError(404, "Category not found", "CATEGORY_NOT_FOUND");
    if (result === "WOULD_INVALIDATE") throw new AppError(409, "Active product requires an active category", "PRODUCT_WOULD_BECOME_INVALID");
    return this.get(id);
  }

  async delete(id: string): Promise<void> {
    if (!(await this.repository.softDelete(id))) throw new AppError(404, "Product not found", "PRODUCT_NOT_FOUND");
  }
}
