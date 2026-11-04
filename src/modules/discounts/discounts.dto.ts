import type { DiscountRecord } from "./discounts.types";

export function discountStatus(discount: Pick<DiscountRecord, "archivedAt" | "isActive" | "startsAt" | "endsAt">, now = new Date()) {
  if (discount.archivedAt) return "ARCHIVED" as const;
  if (!discount.isActive) return "DISABLED" as const;
  if (discount.startsAt > now) return "SCHEDULED" as const;
  if (discount.endsAt && discount.endsAt <= now) return "EXPIRED" as const;
  return "ACTIVE" as const;
}

export function toDiscountDto(discount: DiscountRecord, now = new Date()) {
  return {
    id: discount.id,
    name: discount.name,
    description: discount.description,
    imageUrl: discount.imageUrl,
    showOnStorefront: discount.showOnStorefront,
    sortOrder: discount.sortOrder,
    ctaUrl: discount.ctaUrl,
    translations: Object.fromEntries(discount.translations.map(({ locale, ...translation }) => [locale, translation])),
    code: discount.code,
    activationMode: discount.code ? "COUPON" as const : "AUTOMATIC" as const,
    type: discount.type,
    scope: discount.scope,
    status: discountStatus(discount, now),
    priority: discount.priority,
    value: discount.value.toString(),
    currency: discount.currency,
    minOrderMinor: discount.minOrderMinor?.toString() ?? null,
    maxDiscountMinor: discount.maxDiscountMinor?.toString() ?? null,
    usageLimit: discount.usageLimit,
    perCustomerLimit: discount.perCustomerLimit,
    startsAt: discount.startsAt,
    endsAt: discount.endsAt,
    isActive: discount.isActive,
    combinable: discount.combinable,
    archivedAt: discount.archivedAt,
    targets: discount.targets.map((target) => ({
      id: target.id,
      productId: target.productId,
      variantId: target.variantId,
      categoryId: target.categoryId,
      collectionId: target.collectionId,
      product: target.product ? { id: target.product.id, name: target.product.name, slug: target.product.slug, available: target.product.deletedAt === null } : null,
      variant: target.variant ? {
        id: target.variant.id,
        sku: target.variant.sku,
        available: target.variant.isActive && target.variant.product.deletedAt === null,
        product: { id: target.variant.product.id, name: target.variant.product.name, slug: target.variant.product.slug },
      } : null,
      category: target.category,
      collection: target.collection,
    })),
    redemptionCount: discount._count.redemptions,
    createdAt: discount.createdAt,
    updatedAt: discount.updatedAt,
  };
}
