import { type Prisma, type PrismaClient } from "@prisma/client";
import { DiscountEngineService, type DiscountCandidate, type DiscountCalculation, type PricingLine } from "./discount-engine.service";
import { localizedField, type CatalogLocale } from "../common/localization/catalog-localization";

export type CommercePricingInput = {
  lines: PricingLine[];
  userId: string | null;
  currency: string;
  shippingMinor: bigint;
  couponCode: string | null;
  now: Date;
  locale?: CatalogLocale;
};

type PricingClient = Prisma.TransactionClient | PrismaClient;

async function loadCandidates(transaction: PricingClient, input: CommercePricingInput): Promise<DiscountCandidate[]> {
  if (input.lines.length === 0) return [];
  const productIds = [...new Set(input.lines.map((line) => line.productId))];
  const variantIds = [...new Set(input.lines.map((line) => line.variantId))];
  const categoryIds = [...new Set(input.lines.flatMap((line) => line.categoryIds))];
  const collectionIds = [...new Set(input.lines.flatMap((line) => line.collectionIds))];
  const couponCode = input.couponCode?.trim().toUpperCase() ?? null;
  const discounts = await transaction.discount.findMany({
    where: {
      isActive: true,
      archivedAt: null,
      startsAt: { lte: input.now },
      OR: [{ endsAt: null }, { endsAt: { gt: input.now } }],
      AND: [
        { OR: [{ code: null }, ...(couponCode ? [{ code: couponCode }] : [])] },
        { OR: [
          { scope: "ORDER" },
          { scope: "CATALOG" },
          { scope: "PRODUCT", targets: { some: { productId: { in: productIds } } } },
          { scope: "VARIANT", targets: { some: { variantId: { in: variantIds } } } },
          { scope: "CATEGORY", targets: { some: { categoryId: { in: categoryIds } } } },
          { scope: "COLLECTION", targets: { some: { collectionId: { in: collectionIds } } } },
        ] },
      ],
    },
    orderBy: [{ priority: "asc" }, { id: "asc" }],
    select: {
      id: true, name: true, code: true, type: true, scope: true, priority: true, value: true,
      currency: true, minOrderMinor: true, maxDiscountMinor: true, usageLimit: true,
      perCustomerLimit: true, startsAt: true, endsAt: true, isActive: true, combinable: true,
      archivedAt: true,
      translations: { select: { locale: true, name: true, description: true } },
      targets: { select: { productId: true, variantId: true, categoryId: true, collectionId: true } },
      _count: { select: { redemptions: { where: { releasedAt: null } } } },
    },
  });
  const customerUsage = discounts.length === 0 || !input.userId ? [] : await transaction.discountRedemption.groupBy({
    by: ["discountId"],
    where: { userId: input.userId, discountId: { in: discounts.map((discount) => discount.id) }, releasedAt: null },
    _count: { _all: true },
  });
  const customerUsageById = new Map(customerUsage.map((usage) => [usage.discountId, usage._count._all]));
  return discounts.filter((discount) => input.userId || discount.perCustomerLimit === null).map((discount) => ({
    id: discount.id,
    name: localizedField(discount.translations, input.locale ?? "en", "name", discount.name),
    code: discount.code,
    type: discount.type,
    scope: discount.scope,
    priority: discount.priority,
    value: discount.value,
    currency: discount.currency,
    minOrderMinor: discount.minOrderMinor,
    maxDiscountMinor: discount.maxDiscountMinor,
    usageLimit: discount.usageLimit,
    perCustomerLimit: discount.perCustomerLimit,
    startsAt: discount.startsAt,
    endsAt: discount.endsAt,
    isActive: discount.isActive,
    combinable: discount.combinable,
    archivedAt: discount.archivedAt,
    productIds: discount.targets.flatMap((target) => target.productId ? [target.productId] : []),
    variantIds: discount.targets.flatMap((target) => target.variantId ? [target.variantId] : []),
    categoryIds: discount.targets.flatMap((target) => target.categoryId ? [target.categoryId] : []),
    collectionIds: discount.targets.flatMap((target) => target.collectionId ? [target.collectionId] : []),
    totalUsage: discount._count.redemptions,
    customerUsage: customerUsageById.get(discount.id) ?? 0,
  }));
}

export class CommercePricingService {
  constructor(private readonly engine = new DiscountEngineService()) {}

  async calculate(transaction: Prisma.TransactionClient, input: CommercePricingInput): Promise<DiscountCalculation> {
    return this.engine.calculate({
      ...input,
      discounts: await loadCandidates(transaction, input),
    });
  }

  async calculateCatalogLines(client: PricingClient, lines: PricingLine[], now: Date, locale: CatalogLocale = "en") {
    if (lines.length === 0) return new Map<string, DiscountCalculation>();
    const baseInput: CommercePricingInput = {
      lines,
      userId: null,
      currency: "TND",
      shippingMinor: 0n,
      couponCode: null,
      now,
      locale,
    };
    const discounts = (await loadCandidates(client, baseInput)).filter((discount) => discount.scope !== "ORDER" && discount.type !== "FREE_SHIPPING");
    return new Map(lines.map((line) => [line.variantId, this.engine.calculate({
      ...baseInput,
      lines: [line],
      discounts,
    })]));
  }
}
