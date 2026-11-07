import type { Prisma, PrismaClient } from "@prisma/client";
import { prisma } from "../../config/database";
import { localizedField, type CatalogLocale } from "../../common/localization/catalog-localization";
import { CommercePricingService } from "../../services/commerce-pricing.service";
import { collectionPublicSelect } from "../collections/collections.types";
import {
  catalogProductDetailSelect,
  catalogProductListSelect,
  catalogCategorySelect,
  catalogColorFilterSelect,
  catalogPromotionSelect,
  type CatalogProductDetailRecord,
  type CatalogProductListRecord,
  type CatalogVariantSummary,
  type CatalogVariantPricing,
  type ColorVariantDto,
} from "./catalog.types";
import type {
  CatalogCollectionQuery,
  CatalogSizeGuideQuery,
  ListCatalogEntitiesQuery,
  ListCatalogProductsQuery,
} from "./catalog.validation";
import { publicProductVisibility, publicVariantVisibility } from "./public-product-visibility";
import { publicReviewWhere, ratingSummaryFromGroups, type RatingSummary } from "../reviews/rating-summary";
import { relatedScore, type RelatedSignals } from "./related-products";

const publicVariantBase = publicVariantVisibility;

type ColorVariant = Array<{
  optionValues: Array<{
    optionValue: {
      id: string;
      value: string;
      displayValue: string | null;
      colorHex: string | null;
      position: number;
      option: { position: number };
      translations: Array<{ locale: string; displayValue: string | null }>;
    };
  }>;
}>;

export function catalogColorSummary(variants: ColorVariant, locale: CatalogLocale) {
  const ordered = variants
    .flatMap((variant) => variant.optionValues.map((link) => link.optionValue))
    .sort((left, right) => left.option.position - right.option.position
      || left.position - right.position
      || left.value.localeCompare(right.value, "en", { sensitivity: "base" })
      || left.id.localeCompare(right.id));
  const colors: Array<{ value: string; displayValue: string; colorHex: string | null }> = [];
  const indexes = new Map<string, number>();

  for (const value of ordered) {
    const key = value.value.trim().toLocaleLowerCase("en-US");
    if (!key) continue;
    const color = {
      value: value.value,
      displayValue: localizedField(value.translations, locale, "displayValue", value.displayValue ?? value.value),
      colorHex: value.colorHex,
    };
    const existingIndex = indexes.get(key);
    if (existingIndex === undefined) {
      indexes.set(key, colors.length);
      colors.push(color);
    } else if (!colors[existingIndex]?.colorHex && color.colorHex) {
      colors[existingIndex] = { ...colors[existingIndex]!, colorHex: color.colorHex };
    }
  }

  return { previewColors: colors.slice(0, 3), colorCount: colors.length };
}

function collectionAvailability(now: Date): Prisma.CollectionWhereInput {
  return {
    isActive: true,
    AND: [
      { OR: [{ startsAt: null }, { startsAt: { lte: now } }] },
      { OR: [{ endsAt: null }, { endsAt: { gt: now } }] },
    ],
  };
}

function publicCollectionSelect(now: Date) {
  return {
    ...collectionPublicSelect,
    _count: { select: { collectionProducts: { where: { product: publicProductVisibility(now) } } } },
  } as const satisfies Prisma.CollectionSelect;
}

function relatedProductSelect(now: Date) {
  return {
    ...catalogProductListSelect,
    brandId: true,
    collectionProducts: { where: { collection: collectionAvailability(now) }, select: { collectionId: true } },
  } as const satisfies Prisma.ProductSelect;
}

function productWhere(query: ListCatalogProductsQuery, now: Date): Prisma.ProductWhereInput {
  const optionFilters: Prisma.VariantOptionValueWhereInput[] = [];
  if (query.size) {
    optionFilters.push({ optionValue: { value: { equals: query.size, mode: "insensitive" }, option: { name: { equals: "size", mode: "insensitive" } } } });
  }
  if (query.color) {
    optionFilters.push({ optionValue: { value: { equals: query.color, mode: "insensitive" }, option: { name: { equals: "color", mode: "insensitive" } } } });
  }
  const variant: Prisma.ProductVariantWhereInput = {
    ...publicVariantBase,
    stockQuantity: query.inStock === undefined ? undefined : query.inStock ? { gt: 0 } : 0,
    priceMinor: query.minPriceMinor || query.maxPriceMinor ? {
      gte: query.minPriceMinor === undefined ? undefined : BigInt(query.minPriceMinor),
      lte: query.maxPriceMinor === undefined ? undefined : BigInt(query.maxPriceMinor),
    } : undefined,
    AND: optionFilters.map((filter) => ({ optionValues: { some: filter } })),
  };
  return {
    ...publicProductVisibility(now),
    brand: { isActive: true, slug: query.brand },
    gender: query.gender
      ? (query.gender.toUpperCase() === 'MALE' || query.gender.toUpperCase() === 'MEN')
        ? { in: ['MALE', 'UNISEX', 'MEN', 'male', 'unisex', 'men'], mode: 'insensitive' }
        : (query.gender.toUpperCase() === 'FEMALE' || query.gender.toUpperCase() === 'WOMEN')
          ? { in: ['FEMALE', 'UNISEX', 'WOMEN', 'female', 'unisex', 'women'], mode: 'insensitive' }
          : { equals: query.gender, mode: 'insensitive' }
      : undefined,
    season: query.season ? { equals: query.season, mode: "insensitive" } : undefined,
    productCategories: query.category ? {
      some: { category: { isActive: true, slug: query.category } },
    } : undefined,
    collectionProducts: query.collection ? {
      some: { collection: { ...collectionAvailability(now), slug: query.collection } },
    } : undefined,
    variants: { some: variant },
    ...(query.search ? {
      OR: [
        { name: { contains: query.search, mode: "insensitive" } },
        { slug: { contains: query.search, mode: "insensitive" } },
        { shortDescription: { contains: query.search, mode: "insensitive" } },
        { brand: { name: { contains: query.search, mode: "insensitive" }, isActive: true } },
        { translations: { some: { OR: [{ name: { contains: query.search, mode: "insensitive" } }, { shortDescription: { contains: query.search, mode: "insensitive" } }, { description: { contains: query.search, mode: "insensitive" } }] } } },
        { brand: { isActive: true, translations: { some: { name: { contains: query.search, mode: "insensitive" } } } } },
      ],
    } : {}),
  };
}

function productOrder(sort: ListCatalogProductsQuery["sort"]): Prisma.ProductOrderByWithRelationInput[] {
  const pinOrder: Prisma.ProductOrderByWithRelationInput[] = [
    { priority: "desc" },
  ];

  if (sort === "nameAsc") return [...pinOrder, { name: "asc" }, { id: "asc" }];
  if (sort === "nameDesc") return [...pinOrder, { name: "desc" }, { id: "asc" }];
  if (sort === "basePriceAsc") return [...pinOrder, { basePrice: "asc" }, { id: "asc" }];
  if (sort === "basePriceDesc") return [...pinOrder, { basePrice: "desc" }, { id: "asc" }];
  return [...pinOrder, { publishedAt: "desc" }, { id: "asc" }];
}

export class CatalogRepository {
  constructor(private readonly client: PrismaClient = prisma, private readonly pricing = new CommercePricingService()) {}

  private async variantSummaries(productIds: string[], now: Date, locale: CatalogLocale): Promise<{
    summaries: CatalogVariantSummary[];
    pricing: Map<string, CatalogVariantPricing>;
  }> {
    if (productIds.length === 0) return { summaries: [], pricing: new Map() };
    const variants = await this.client.productVariant.findMany({
      where: { productId: { in: productIds }, ...publicVariantBase },
      orderBy: [{ productId: "asc" }, { priceMinor: "asc" }, { id: "asc" }],
      select: {
        id: true,
        productId: true,
        priceMinor: true,
        stockQuantity: true,
        optionValues: {
          where: { optionValue: { option: { name: { equals: "color", mode: "insensitive" } } } },
          select: {
            optionValue: {
              select: {
                id: true,
                value: true,
                displayValue: true,
                colorHex: true,
                position: true,
                option: { select: { position: true } },
                translations: { select: { locale: true, displayValue: true } },
              },
            },
          },
        },
        product: {
          select: {
            productCategories: { where: { category: { isActive: true } }, select: { categoryId: true } },
            collectionProducts: {
              where: { collection: collectionAvailability(now) },
              select: { collectionId: true },
            },
          },
        },
      },
    });
    const lines = variants.map((variant) => ({
      variantId: variant.id,
      productId: variant.productId,
      categoryIds: variant.product.productCategories.map((link) => link.categoryId),
      collectionIds: variant.product.collectionProducts.map((link) => link.collectionId),
      unitPriceMinor: variant.priceMinor,
      quantity: 1,
    }));
    const calculations = await this.pricing.calculateCatalogLines(this.client, lines, now, locale);
    const pricing = new Map<string, CatalogVariantPricing>();
    for (const variant of variants) {
      const calculation = calculations.get(variant.id)!;
      const discountMinor = calculation.totalDiscountMinor;
      pricing.set(variant.id, {
        variantId: variant.id,
        originalPriceMinor: variant.priceMinor,
        effectivePriceMinor: calculation.grandTotalMinor,
        discountMinor,
        discountPercentageBasisPoints: variant.priceMinor > 0n ? (discountMinor * 10_000n + variant.priceMinor / 2n) / variant.priceMinor : 0n,
        promotions: calculation.discounts.map((discount) => ({
          discountId: discount.discountId,
          name: discount.name,
          type: discount.type,
          value: discount.value,
          amountMinor: discount.amountMinor,
          endsAt: discount.endsAt,
        })),
      });
    }
    const summaries = productIds.map((productId) => {
      const productVariants = variants.filter((variant) => variant.productId === productId);
      const cheapest = productVariants.reduce<typeof productVariants[number] | undefined>((best, variant) => !best || variant.priceMinor < best.priceMinor ? variant : best, undefined);
      const promotional = productVariants.reduce<CatalogVariantPricing | undefined>((best, variant) => {
        const candidate = pricing.get(variant.id)!;
        return !best || candidate.effectivePriceMinor < best.effectivePriceMinor ? candidate : best;
      }, undefined);
      return {
        productId,
        minimumPriceMinor: cheapest?.priceMinor ?? null,
        minimumEffectivePriceMinor: promotional?.effectivePriceMinor ?? null,
        stockQuantity: productVariants.reduce((sum, variant) => sum + variant.stockQuantity, 0),
        promotionalPricing: promotional && promotional.discountMinor > 0n ? promotional : null,
        ...catalogColorSummary(productVariants, locale),
      };
    });
    return { summaries, pricing };
  }

  async listColorOptions(now: Date) {
    return this.client.productOptionValue.findMany({
      where: {
        option: {
          name: { equals: "color", mode: "insensitive" },
          product: publicProductVisibility(now),
        },
        variants: { some: { variant: publicVariantBase } },
      },
      orderBy: [{ value: "asc" }, { id: "asc" }],
      take: 500,
      select: catalogColorFilterSelect,
    });
  }

  private async groupColorVariants(groupIds: string[], now: Date): Promise<Map<string, ColorVariantDto[]>> {
    const validGroupIds = [...new Set(groupIds.filter(Boolean))];
    if (validGroupIds.length === 0 || typeof this.client.product.findMany !== "function") {
      return new Map();
    }
    const siblings = await this.client.product.findMany({
      where: {
        groupId: { in: validGroupIds },
        ...publicProductVisibility(now),
      },
      orderBy: [{ priority: "desc" }, { publishedAt: "asc" }, { id: "asc" }],
      select: {
        id: true,
        groupId: true,
        slug: true,
        name: true,
        colorName: true,
        colorHex: true,
        basePrice: true,
        variants: {
          where: { ...publicVariantBase },
          select: { stockQuantity: true },
        },
        media: {
          where: { type: "IMAGE" },
          orderBy: [{ isPrimary: "desc" }, { position: "asc" }, { id: "asc" }],
          take: 1,
          select: { url: true },
        },
      },
    });

    const map = new Map<string, ColorVariantDto[]>();
    for (const sibling of siblings) {
      const list = map.get(sibling.groupId) ?? [];
      list.push({
        id: sibling.id,
        slug: sibling.slug,
        colorName: sibling.colorName || sibling.name,
        colorHex: sibling.colorHex ?? null,
        thumbnail: sibling.media?.[0]?.url || "",
        inStock: Array.isArray(sibling.variants) ? sibling.variants.some((v) => v.stockQuantity > 0) : true,
        isCurrent: false,
        basePrice: sibling.basePrice?.toString() ?? "0",
      });
      map.set(sibling.groupId, list);
    }
    return map;
  }

  async listProducts(query: ListCatalogProductsQuery, now: Date, locale: CatalogLocale = "en"): Promise<{
    items: CatalogProductListRecord[];
    summaries: CatalogVariantSummary[];
    total: number;
  }> {
    const where = productWhere(query, now);

    if (query.groupByModel) {
      // 1. Fetch lightweight candidate list of only (id, groupId) to identify unique models quickly
      const candidateIds = await this.client.product.findMany({
        where,
        orderBy: productOrder(query.sort),
        select: { id: true, groupId: true },
      });

      const seenGroups = new Set<string>();
      const targetProductIds: string[] = [];
      for (const candidate of candidateIds) {
        if (!seenGroups.has(candidate.groupId)) {
          seenGroups.add(candidate.groupId);
          targetProductIds.push(candidate.id);
        }
      }
      const total = targetProductIds.length;

      const pageStart = (query.page - 1) * query.limit;
      const pageProductIds = targetProductIds.slice(pageStart, pageStart + query.limit);

      // 2. Fetch full catalog details ONLY for the exact items on this page
      const fetchedItems = pageProductIds.length > 0
        ? await this.client.product.findMany({
            where: { id: { in: pageProductIds } },
            select: catalogProductListSelect,
          })
        : [];

      // Preserve the sorted order of pageProductIds
      const itemMap = new Map(fetchedItems.map((item) => [item.id, item]));
      const items = pageProductIds.flatMap((id) => {
        const item = itemMap.get(id);
        return item ? [item] : [];
      });
      const [{ summaries }, groupCounts, groupVariantsMap] = await Promise.all([
        this.variantSummaries(items.map((item) => item.id), now, locale),
        typeof this.client.product.groupBy === "function" ? this.client.product.groupBy({
          by: ["groupId"],
          where: {
            groupId: { in: items.map((i) => i.groupId) },
            ...publicProductVisibility(now),
          },
          _count: { id: true },
        }) : Promise.resolve([]),
        this.groupColorVariants(items.map((i) => i.groupId), now),
      ]);
      const groupCountMap = new Map(groupCounts.map((g) => [g.groupId, g._count.id]));

      const enhancedSummaries = summaries.map((s) => {
        const item = items.find((i) => i.id === s.productId);
        const groupCount = item ? (groupCountMap.get(item.groupId) ?? 1) : 1;
        const variants = item ? (groupVariantsMap.get(item.groupId) ?? []) : [];
        return {
          ...s,
          colorCount: Math.max(s.colorCount ?? 0, groupCount),
          colorVariants: variants,
        };
      });

      return {
        items,
        total,
        summaries: enhancedSummaries,
      };
    }

    const [items, total] = await this.client.$transaction([
      this.client.product.findMany({
        where,
        skip: (query.page - 1) * query.limit,
        take: query.limit,
        orderBy: productOrder(query.sort),
        select: catalogProductListSelect,
      }),
      this.client.product.count({ where }),
    ]);
    const [{ summaries }, groupCounts, groupVariantsMap] = await Promise.all([
      this.variantSummaries(items.map((item) => item.id), now, locale),
      typeof this.client.product.groupBy === "function" ? this.client.product.groupBy({
        by: ["groupId"],
        where: {
          groupId: { in: items.map((i) => i.groupId) },
          ...publicProductVisibility(now),
        },
        _count: { id: true },
      }) : Promise.resolve([]),
      this.groupColorVariants(items.map((i) => i.groupId), now),
    ]);
    const groupCountMap = new Map(groupCounts.map((g) => [g.groupId, g._count.id]));

    const enhancedSummaries = summaries.map((s) => {
      const item = items.find((i) => i.id === s.productId);
      const groupCount = item ? (groupCountMap.get(item.groupId) ?? 1) : 1;
      const variants = item ? (groupVariantsMap.get(item.groupId) ?? []) : [];
      return {
        ...s,
        colorCount: Math.max(s.colorCount ?? 0, groupCount),
        colorVariants: variants,
      };
    });

    return {
      items,
      total,
      summaries: enhancedSummaries,
    };
  }

  async findProductBySlug(slug: string, now: Date, locale: CatalogLocale = "en"): Promise<(CatalogProductDetailRecord & { colorVariants: ColorVariantDto[]; promotionPricing: Map<string, CatalogVariantPricing>; ratingSummary: RatingSummary }) | null> {
    const product = await this.client.product.findFirst({
      where: { ...publicProductVisibility(now), slug },
      select: catalogProductDetailSelect(now),
    });
    if (!product) return null;
    const [{ pricing }, groups, siblings] = await Promise.all([
      this.variantSummaries([product.id], now, locale),
      this.client.productReview.groupBy({ by: ["rating"], where: publicReviewWhere(product.id, now), _count: { _all: true } }),
      typeof this.client.product.findMany === "function" ? this.client.product.findMany({
        where: {
          ...publicProductVisibility(now),
          groupId: product.groupId,
        },
        orderBy: [{ priority: "desc" }, { publishedAt: "asc" }, { id: "asc" }],
        select: {
          id: true,
          slug: true,
          colorName: true,
          colorHex: true,
          basePrice: true,
          variants: {
            where: { ...publicVariantBase },
            select: { stockQuantity: true },
          },
          media: {
            where: { type: "IMAGE" },
            orderBy: [{ isPrimary: "desc" }, { position: "asc" }, { id: "asc" }],
            take: 1,
            select: { url: true },
          },
        },
      }) : Promise.resolve([]),
    ]);
    const colorVariants: ColorVariantDto[] = siblings.map((sibling) => ({
      id: sibling.id,
      slug: sibling.slug,
      colorName: sibling.colorName || product.name,
      colorHex: sibling.colorHex ?? null,
      thumbnail: sibling.media?.[0]?.url || "",
      inStock: Array.isArray(sibling.variants) ? sibling.variants.some((v) => v.stockQuantity > 0) : true,
      isCurrent: sibling.id === product.id,
      basePrice: sibling.basePrice?.toString() ?? "0",
    }));
    return Object.assign(product, { colorVariants, promotionPricing: pricing, ratingSummary: ratingSummaryFromGroups(groups) });
  }

  async relatedProducts(slug: string, limit: number, now: Date, locale: CatalogLocale = "en") {
    const source = await this.client.product.findFirst({
      where: { ...publicProductVisibility(now), slug },
      select: {
        id: true, brandId: true, gender: true, basePrice: true,
        productCategories: { where: { category: { isActive: true } }, select: { categoryId: true } },
        collectionProducts: { where: { collection: collectionAvailability(now) }, select: { collectionId: true } },
      },
    });
    if (!source) return null;
    const categoryIds = [...new Set(source.productCategories.map((link) => link.categoryId))];
    const collectionIds = [...new Set(source.collectionProducts.map((link) => link.collectionId))];
    const sourceSignals: RelatedSignals = {
      categoryIds: new Set(categoryIds), collectionIds: new Set(collectionIds),
      brandId: source.brandId, gender: source.gender, basePrice: source.basePrice.toNumber(),
    };
    const categoryPool = categoryIds.length ? await this.client.product.findMany({
      where: { ...publicProductVisibility(now), id: { not: source.id }, AND: [{ productCategories: { some: { categoryId: { in: categoryIds } } } }] },
      orderBy: [{ publishedAt: "desc" }, { id: "asc" }],
      take: 200,
      select: relatedProductSelect(now),
    }) : [];
    const signals: Prisma.ProductWhereInput[] = [];
    if (collectionIds.length) signals.push({ collectionProducts: { some: { collectionId: { in: collectionIds }, collection: collectionAvailability(now) } } });
    signals.push({ brandId: source.brandId });
    if (source.gender) signals.push({ gender: { equals: source.gender, mode: "insensitive" } });
    signals.push({ basePrice: { gte: source.basePrice.mul("0.75"), lte: source.basePrice.mul("1.25") } });

    const otherPool = await this.client.product.findMany({
      where: { ...publicProductVisibility(now), id: { notIn: [source.id, ...categoryPool.map((item) => item.id)] }, OR: signals },
      orderBy: [{ publishedAt: "desc" }, { id: "asc" }],
      take: 200,
      select: relatedProductSelect(now),
    });
    const strong = [...categoryPool, ...otherPool];
    const ranked = strong.map((candidate) => ({
      candidate,
      score: relatedScore(sourceSignals, {
        categoryIds: new Set(candidate.productCategories.map((link) => link.category.id)),
        collectionIds: new Set(candidate.collectionProducts.map((link) => link.collectionId)),
        brandId: candidate.brandId, gender: candidate.gender, basePrice: candidate.basePrice.toNumber(),
      }),
    })).sort((left, right) => right.score - left.score
      || (right.candidate.publishedAt?.getTime() ?? 0) - (left.candidate.publishedAt?.getTime() ?? 0)
      || left.candidate.id.localeCompare(right.candidate.id));
    const selected = ranked.slice(0, limit).map(({ candidate }) => candidate);
    if (selected.length < limit) {
      const fallback = await this.client.product.findMany({
        where: { ...publicProductVisibility(now), id: { notIn: [source.id, ...strong.map((item) => item.id)] } },
        orderBy: [{ publishedAt: "desc" }, { id: "asc" }],
        take: limit - selected.length,
        select: relatedProductSelect(now),
      });
      selected.push(...fallback);
    }
    const [{ summaries }, groupVariantsMap] = await Promise.all([
      this.variantSummaries(selected.map((item) => item.id), now, locale),
      this.groupColorVariants(selected.map((item) => item.groupId), now),
    ]);
    const enhancedSummaries = summaries.map((s) => {
      const item = selected.find((i) => i.id === s.productId);
      const variants = item ? (groupVariantsMap.get(item.groupId) ?? []) : [];
      return {
        ...s,
        colorCount: Math.max(s.colorCount ?? 0, variants.length),
        colorVariants: variants,
      };
    });
    return { items: selected, summaries: enhancedSummaries };
  }

  async listBrands(query: ListCatalogEntitiesQuery, now: Date) {
    const where: Prisma.BrandWhereInput = { isActive: true, products: { some: publicProductVisibility(now) } };
    const [items, total] = await this.client.$transaction([
      this.client.brand.findMany({ where, skip: (query.page - 1) * query.limit, take: query.limit, orderBy: [{ name: "asc" }, { id: "asc" }], select: { id: true, name: true, slug: true, description: true, logoUrl: true, showcaseImageUrl: true, _count: { select: { products: { where: publicProductVisibility(now) } } }, translations: { select: { locale: true, name: true, description: true } } } }),
      this.client.brand.count({ where }),
    ]);
    return { items, total };
  }

  async listPromotions(now: Date) {
    return this.client.discount.findMany({
      where: {
        showOnStorefront: true,
        isActive: true,
        archivedAt: null,
        startsAt: { lte: now },
        OR: [{ endsAt: null }, { endsAt: { gt: now } }],
      },
      orderBy: [{ sortOrder: "asc" }, { startsAt: "desc" }, { id: "asc" }],
      select: catalogPromotionSelect,
    });
  }

  async listCategories(query: ListCatalogEntitiesQuery, now: Date) {
    const where: Prisma.CategoryWhereInput = { isActive: true };
    const [items, total] = await this.client.$transaction([
      this.client.category.findMany({ where, skip: (query.page - 1) * query.limit, take: query.limit, orderBy: [{ sortOrder: "asc" }, { name: "asc" }, { id: "asc" }], select: catalogCategorySelect(now) }),
      this.client.category.count({ where }),
    ]);
    return { items, total };
  }

  async listCategoryRoots(query: ListCatalogEntitiesQuery, now: Date) {
    const where: Prisma.CategoryWhereInput = { isActive: true, parentId: null };
    const [items, total] = await this.client.$transaction([
      this.client.category.findMany({
        where,
        skip: (query.page - 1) * query.limit,
        take: query.limit,
        orderBy: [{ sortOrder: "asc" }, { name: "asc" }, { id: "asc" }],
        select: catalogCategorySelect(now),
      }),
      this.client.category.count({ where }),
    ]);
    return { items, total };
  }

  listCategoryChildren(parentIds: string[], now: Date) {
    if (parentIds.length === 0) return Promise.resolve([]);
    return this.client.category.findMany({
      where: { isActive: true, parentId: { in: parentIds } },
      orderBy: [{ sortOrder: "asc" }, { name: "asc" }, { id: "asc" }],
      select: catalogCategorySelect(now),
    });
  }

  async listCollections(query: ListCatalogEntitiesQuery, now: Date) {
    const where = collectionAvailability(now);
    const [items, total] = await this.client.$transaction([
      this.client.collection.findMany({ where, skip: (query.page - 1) * query.limit, take: query.limit, orderBy: [{ startsAt: "desc" }, { name: "asc" }, { id: "asc" }], select: publicCollectionSelect(now) }),
      this.client.collection.count({ where }),
    ]);
    return { items, total };
  }

  async findCollection(slug: string, query: CatalogCollectionQuery, now: Date, locale: CatalogLocale = "en") {
    const collection = await this.client.collection.findFirst({ where: { ...collectionAvailability(now), slug }, select: publicCollectionSelect(now) });
    if (!collection) return null;
    const where: Prisma.CollectionProductWhereInput = { collectionId: collection.id, product: publicProductVisibility(now) };
    const [links, total] = await this.client.$transaction([
      this.client.collectionProduct.findMany({ where, skip: (query.page - 1) * query.limit, take: query.limit, orderBy: [{ position: "asc" }, { productId: "asc" }], select: { product: { select: catalogProductListSelect } } }),
      this.client.collectionProduct.count({ where }),
    ]);
    const productIds = links.map((link) => link.product.id);
    const { summaries } = await this.variantSummaries(productIds, now, locale);
    return { collection, products: links.map((link) => link.product), summaries, total };
  }

  async findSizeGuide(sizeGuideId: string, query: CatalogSizeGuideQuery) {
    const guide = await this.client.sizeGuide.findUnique({ where: { id: sizeGuideId }, select: { id: true, name: true, gender: true, notes: true, brand: { select: { id: true, name: true, slug: true, isActive: true } } } });
    if (!guide || (guide.brand && !guide.brand.isActive)) return null;
    const [entries, total] = await this.client.$transaction([
      this.client.sizeGuideEntry.findMany({ where: { sizeGuideId }, skip: (query.page - 1) * query.limit, take: query.limit, orderBy: [{ sortOrder: "asc" }, { id: "asc" }], select: { id: true, euSize: true, usSize: true, ukSize: true, footLengthCm: true, sortOrder: true } }),
      this.client.sizeGuideEntry.count({ where: { sizeGuideId } }),
    ]);
    return { guide, entries, total };
  }
}
