import fs from "fs";
import path from "path";

// ─── 1. products.validation.ts ───────────────────────────────────
{
  const filePath = path.resolve(__dirname, "../src/modules/products/products.validation.ts");
  let content = fs.readFileSync(filePath, "utf-8").replace(/\r\n/g, "\n");

  const oldFields = `const fields = {
  brandId: uuid, sizeGuideId: uuid.nullable().optional(), name: z.string().trim().min(1).max(220),
  slug: z.string().trim().min(1).max(250).optional(), skuPrefix: nullableString(80),
  shortDescription: nullableString(500), basePrice: decimalMoney, compareAtPrice: decimalMoney.nullable().optional(),
  description: z.string().trim().max(50_000).nullable().optional(), material: nullableString(150),
  gender: nullableString(50), season: nullableString(50), seoTitle: nullableString(255), seoDescription: nullableString(500),
  translations: createTranslations.optional(),
};`;

  const newFields = `const fields = {
  brandId: uuid, sizeGuideId: uuid.nullable().optional(), name: z.string().trim().min(1).max(220),
  slug: z.string().trim().min(1).max(250).optional(), skuPrefix: nullableString(80),
  shortDescription: nullableString(500), basePrice: decimalMoney, compareAtPrice: decimalMoney.nullable().optional(),
  description: z.string().trim().max(50_000).nullable().optional(), material: nullableString(150),
  gender: nullableString(50), season: nullableString(50), seoTitle: nullableString(255), seoDescription: nullableString(500),
  colorName: nullableString(100),
  colorHex: z.string().trim().regex(/^#(?:[0-9a-fA-F]{3}|[0-9a-fA-F]{6})$/, "Invalid hex color").nullable().optional(),
  isFeatured: z.boolean().default(false).optional(),
  priority: z.coerce.number().int().min(0).max(1000).default(0).optional(),
  translations: createTranslations.optional(),
};`;

  const oldCreateBody = `export const productCreateBody = z.object({ ...fields, status: z.literal("DRAFT").optional() }).strict();`;
  const newCreateBody = `export const productCreateBody = z.object({
  ...fields,
  linkToProductId: uuid.optional(),
  status: z.literal("DRAFT").optional(),
}).strict();`;

  const oldUpdateBody = `export const productUpdateBody = z.object({
  brandId: fields.brandId.optional(), sizeGuideId: fields.sizeGuideId, name: fields.name.optional(), slug: fields.slug,
  skuPrefix: fields.skuPrefix, shortDescription: fields.shortDescription, basePrice: fields.basePrice.optional(),
  compareAtPrice: fields.compareAtPrice, description: fields.description, material: fields.material, gender: fields.gender,
  season: fields.season, status: z.enum(["DRAFT", "ACTIVE"]).optional(), seoTitle: fields.seoTitle, seoDescription: fields.seoDescription,
  translations: updateTranslations.optional(),
}).strict();`;

  const newUpdateBody = `export const productUpdateBody = z.object({
  brandId: fields.brandId.optional(), sizeGuideId: fields.sizeGuideId, name: fields.name.optional(), slug: fields.slug,
  skuPrefix: fields.skuPrefix, shortDescription: fields.shortDescription, basePrice: fields.basePrice.optional(),
  compareAtPrice: fields.compareAtPrice, description: fields.description, material: fields.material, gender: fields.gender,
  season: fields.season, status: z.enum(["DRAFT", "ACTIVE"]).optional(), seoTitle: fields.seoTitle, seoDescription: fields.seoDescription,
  colorName: fields.colorName, colorHex: fields.colorHex,
  isFeatured: z.boolean().optional(), priority: z.coerce.number().int().min(0).max(1000).optional(),
  unlinkFromGroup: z.boolean().optional(),
  translations: updateTranslations.optional(),
}).strict();`;

  const oldSortBy = `sortBy: z.enum(["name", "slug", "basePrice", "status", "createdAt", "updatedAt"]).default("createdAt"),`;
  const newSortBy = `sortBy: z.enum(["name", "slug", "basePrice", "status", "priority", "isFeatured", "createdAt", "updatedAt"]).default("createdAt"),`;

  content = content.replace(oldFields, newFields);
  content = content.replace(oldCreateBody, newCreateBody);
  content = content.replace(oldUpdateBody, newUpdateBody);
  content = content.replace(oldSortBy, newSortBy);

  if (!content.includes("searchModelsSchema")) {
    content += `\nexport const searchModelsSchema = z.object({ body: emptyBody, params: z.object({}).strict(), query: z.object({ q: z.string().trim().min(1).max(100).optional() }).strict() }).strict();
export type SearchModelsQuery = z.infer<typeof searchModelsSchema>["query"];\n`;
  }

  fs.writeFileSync(filePath, content, "utf-8");
  console.log("products.validation.ts updated");
}

// ─── 2. products.dto.ts ──────────────────────────────────────────
{
  const filePath = path.resolve(__dirname, "../src/modules/products/products.dto.ts");
  let content = fs.readFileSync(filePath, "utf-8").replace(/\r\n/g, "\n");

  const oldDto = `export function toProductDto(product: ProductRecord | ProductDetailRecord) {
  return { id: product.id, brandId: product.brandId, sizeGuideId: product.sizeGuideId, name: product.name,`;

  const newDto = `export function toProductDto(product: ProductRecord | ProductDetailRecord) {
  return { id: product.id, groupId: product.groupId, colorName: product.colorName, colorHex: product.colorHex, isFeatured: product.isFeatured, priority: product.priority, brandId: product.brandId, sizeGuideId: product.sizeGuideId, name: product.name,`;

  content = content.replace(oldDto, newDto);
  fs.writeFileSync(filePath, content, "utf-8");
  console.log("products.dto.ts updated");
}

// ─── 3. products.repository.ts ───────────────────────────────────
{
  const filePath = path.resolve(__dirname, "../src/modules/products/products.repository.ts");
  let content = fs.readFileSync(filePath, "utf-8").replace(/\r\n/g, "\n");

  content = content.replace(
    'export class ProductsRepositoryError extends Error { constructor(public readonly code: "DUPLICATE_SLUG") { super(code); } }',
    'export class ProductsRepositoryError extends Error { constructor(public readonly code: "DUPLICATE_SLUG" | "DUPLICATE_GROUP_COLOR") { super(code); } }'
  );

  const oldCatch = `} catch (error: unknown) { if (isUniqueConstraintError(error)) throw new ProductsRepositoryError("DUPLICATE_SLUG"); throw error; }`;
  const newCatch = `} catch (error: unknown) {
      if (isUniqueConstraintError(error)) {
        const msg = error instanceof Error ? error.message : "";
        if (msg.includes("products_group_color_uniq") || msg.includes("group_id") || msg.includes("color_name")) {
          throw new ProductsRepositoryError("DUPLICATE_GROUP_COLOR");
        }
        throw new ProductsRepositoryError("DUPLICATE_SLUG");
      }
      throw error;
    }`;

  content = content.replace(oldCatch, newCatch);

  const searchModelsMethod = `  async searchModels(query: { q?: string }): Promise<Array<{ id: string; name: string; groupId: string; colorName: string | null; slug: string }>> {
    const where: Prisma.ProductWhereInput = {
      deletedAt: null,
      ...(query.q ? {
        OR: [
          { name: { contains: query.q, mode: "insensitive" } },
          { slug: { contains: query.q, mode: "insensitive" } },
        ],
      } : {}),
    };

    const products = await this.client.product.findMany({
      where,
      orderBy: [{ isFeatured: "desc" }, { priority: "desc" }, { name: "asc" }],
      take: 20,
      select: {
        id: true,
        name: true,
        groupId: true,
        colorName: true,
        slug: true,
      },
    });

    const seenGroups = new Set<string>();
    const models: typeof products = [];
    for (const p of products) {
      if (!seenGroups.has(p.groupId)) {
        seenGroups.add(p.groupId);
        models.push(p);
      }
    }
    return models;
  }
`;

  if (!content.includes("searchModels(")) {
    content = content.replace(
      'async list(query: ListProductsQuery)',
      `${searchModelsMethod}\n  async list(query: ListProductsQuery)`
    );
  }

  fs.writeFileSync(filePath, content, "utf-8");
  console.log("products.repository.ts updated");
}

// ─── 4. products.service.ts ──────────────────────────────────────
{
  const filePath = path.resolve(__dirname, "../src/modules/products/products.service.ts");
  let content = fs.readFileSync(filePath, "utf-8").replace(/\r\n/g, "\n");

  const oldService = fs.readFileSync(filePath, "utf-8").replace(/\r\n/g, "\n");

  const newServiceContent = `import { Prisma } from "@prisma/client";
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
  searchModels?: (query: { q?: string }) => Promise<Array<{ id: string; name: string; groupId: string; colorName: string | null }>>;
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

  async searchModels(query: { q?: string }) {
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

    const derivedSlug = slug(input.slug ?? (input.linkToProductId && input.colorName ? \`\${input.name}-\${input.colorName}\` : input.name));

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
`;

  fs.writeFileSync(filePath, newServiceContent, "utf-8");
  console.log("products.service.ts updated");
}

// ─── 5. products.controller.ts ───────────────────────────────────
{
  const filePath = path.resolve(__dirname, "../src/modules/products/products.controller.ts");
  let content = fs.readFileSync(filePath, "utf-8").replace(/\r\n/g, "\n");

  if (!content.includes("searchModels =")) {
    const method = `  searchModels = async (r: Request, s: Response, n: NextFunction) => { try { s.json(ok(await this.service.searchModels(data(r).query as { q?: string }))); } catch (e: unknown) { n(e); } };\n`;
    content = content.replace("list = async", `${method}  list = async`);
    fs.writeFileSync(filePath, content, "utf-8");
    console.log("products.controller.ts updated");
  }
}

// ─── 6. products.routes.ts ───────────────────────────────────────
{
  const filePath = path.resolve(__dirname, "../src/modules/products/products.routes.ts");
  let content = fs.readFileSync(filePath, "utf-8").replace(/\r\n/g, "\n");

  if (!content.includes("searchModelsSchema")) {
    content = content.replace(
      'import { createProductSchema, listProductsSchema, productIdSchema, replaceProductCategoriesSchema, updateProductSchema } from "./products.validation";',
      'import { createProductSchema, listProductsSchema, productIdSchema, replaceProductCategoriesSchema, updateProductSchema, searchModelsSchema } from "./products.validation";'
    );
    content = content.replace(
      'router.get("/", validate(listProductsSchema), requireAuth, requirePermission(PERMISSIONS.PRODUCTS_READ_ANY), controller.list);',
      'router.get("/search-models", validate(searchModelsSchema), requireAuth, requirePermission(PERMISSIONS.PRODUCTS_READ_ANY), controller.searchModels);\nrouter.get("/", validate(listProductsSchema), requireAuth, requirePermission(PERMISSIONS.PRODUCTS_READ_ANY), controller.list);'
    );
    fs.writeFileSync(filePath, content, "utf-8");
    console.log("products.routes.ts updated");
  }
}

console.log("All products module files patched successfully!");

