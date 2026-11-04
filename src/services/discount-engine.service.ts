export type PricingLine = {
  variantId: string;
  productId: string;
  categoryIds: string[];
  collectionIds: string[];
  unitPriceMinor: bigint;
  quantity: number;
};

export type DiscountCandidate = {
  id: string;
  name: string;
  code: string | null;
  type: "PERCENTAGE" | "FIXED_AMOUNT" | "FREE_SHIPPING";
  scope: "ORDER" | "PRODUCT" | "VARIANT" | "CATEGORY" | "COLLECTION" | "CATALOG";
  priority: number;
  value: bigint;
  currency: string | null;
  minOrderMinor: bigint | null;
  maxDiscountMinor: bigint | null;
  usageLimit: number | null;
  perCustomerLimit: number | null;
  startsAt: Date;
  endsAt: Date | null;
  isActive: boolean;
  combinable: boolean;
  archivedAt: Date | null;
  productIds: string[];
  variantIds: string[];
  categoryIds: string[];
  collectionIds: string[];
  totalUsage?: number;
  customerUsage?: number;
};

export type DiscountContribution = { discountId: string; amountMinor: bigint };
export type DiscountCalculation = {
  grossMerchandiseSubtotalMinor: bigint;
  lines: Array<PricingLine & {
    grossMinor: bigint;
    discountContributions: DiscountContribution[];
    discountMinor: bigint;
    finalMinor: bigint;
  }>;
  discounts: Array<{
    discountId: string;
    name: string;
    code: string | null;
    type: DiscountCandidate["type"];
    value: bigint;
    priority: number;
    amountMinor: bigint;
    endsAt: Date | null;
  }>;
  grossShippingMinor: bigint;
  shippingDiscountMinor: bigint;
  merchandiseDiscountMinor: bigint;
  totalDiscountMinor: bigint;
  grandTotalMinor: bigint;
  eligibleCoupon: boolean;
};

export type DiscountEngineInput = {
  lines: PricingLine[];
  discounts: DiscountCandidate[];
  currency: string;
  shippingMinor: bigint;
  couponCode?: string | null;
  now?: Date;
};

function proportionalAllocation(amount: bigint, values: bigint[], lines: PricingLine[]): bigint[] {
  const total = values.reduce((sum, value) => sum + value, 0n);
  if (amount <= 0n || total <= 0n) return values.map(() => 0n);
  const allocation = values.map((value) => amount * value / total);
  let remainder = amount - allocation.reduce((sum, value) => sum + value, 0n);
  const order = values.map((_, index) => index).sort((left, right) => {
    const byVariant = lines[left]!.variantId.localeCompare(lines[right]!.variantId);
    return byVariant || left - right;
  });
  for (const index of order) {
    if (remainder === 0n) break;
    if (values[index]! > allocation[index]!) {
      allocation[index] = allocation[index]! + 1n;
      remainder -= 1n;
    }
  }
  return allocation;
}

function appliesToLine(discount: DiscountCandidate, line: PricingLine): boolean {
  if (discount.scope === "ORDER" || discount.scope === "CATALOG") return true;
  if (discount.scope === "PRODUCT") return discount.productIds.includes(line.productId);
  if (discount.scope === "VARIANT") return discount.variantIds.includes(line.variantId);
  if (discount.scope === "CATEGORY") return line.categoryIds.some((categoryId) => discount.categoryIds.includes(categoryId));
  return line.collectionIds.some((collectionId) => discount.collectionIds.includes(collectionId));
}

function currentlyEligible(discount: DiscountCandidate, input: DiscountEngineInput, grossSubtotal: bigint, now: Date, coupon: string | null): boolean {
  if (!discount.isActive || discount.archivedAt !== null || discount.startsAt > now || (discount.endsAt !== null && now >= discount.endsAt)) return false;
  if (discount.code !== null && discount.code.toUpperCase() !== coupon) return false;
  if (discount.minOrderMinor !== null && grossSubtotal < discount.minOrderMinor) return false;
  if (discount.usageLimit !== null && (discount.totalUsage ?? 0) >= discount.usageLimit) return false;
  if (discount.perCustomerLimit !== null && (discount.customerUsage ?? 0) >= discount.perCustomerLimit) return false;
  if (discount.type === "FIXED_AMOUNT" && discount.currency !== input.currency) return false;
  if (discount.type === "FREE_SHIPPING") return input.shippingMinor > 0n;
  return input.lines.some((line) => appliesToLine(discount, line));
}

function discountAmount(discount: DiscountCandidate, base: bigint): bigint {
  let amount = discount.type === "PERCENTAGE"
    ? (base * discount.value + 5_000n) / 10_000n
    : discount.type === "FIXED_AMOUNT" ? discount.value : base;
  if (discount.maxDiscountMinor !== null && amount > discount.maxDiscountMinor) amount = discount.maxDiscountMinor;
  return amount > base ? base : amount;
}

export class DiscountEngineService {
  calculate(input: DiscountEngineInput): DiscountCalculation {
    const now = input.now ?? new Date();
    const coupon = input.couponCode?.trim().toUpperCase() ?? null;
    const grossValues = input.lines.map((line) => line.unitPriceMinor * BigInt(line.quantity));
    const grossSubtotal = grossValues.reduce((sum, value) => sum + value, 0n);
    const eligible = input.discounts
      .filter((discount) => currentlyEligible(discount, input, grossSubtotal, now, coupon))
      .sort((left, right) => left.priority - right.priority);
    const selected = eligible.length === 0 ? [] : eligible[0]!.combinable
      ? eligible.filter((discount) => discount.combinable)
      : [eligible[0]!];
    const eligibleCoupon = coupon === null || selected.some((discount) => discount.code?.toUpperCase() === coupon);
    const remaining = [...grossValues];
    const contributions: DiscountContribution[][] = input.lines.map(() => []);
    const applications: DiscountCalculation["discounts"] = [];
    let shippingRemaining = input.shippingMinor;

    for (const discount of selected) {
      if (discount.type === "FREE_SHIPPING") {
        const amount = discountAmount(discount, shippingRemaining);
        if (amount > 0n) {
          shippingRemaining -= amount;
          applications.push({
            discountId: discount.id, name: discount.name, code: discount.code, type: discount.type,
            value: discount.value, priority: discount.priority, amountMinor: amount, endsAt: discount.endsAt,
          });
        }
        continue;
      }
      const eligibleValues = remaining.map((value, index) => appliesToLine(discount, input.lines[index]!) ? value : 0n);
      const base = eligibleValues.reduce((sum, value) => sum + value, 0n);
      const amount = discountAmount(discount, base);
      if (amount <= 0n) continue;
      const allocated = proportionalAllocation(amount, eligibleValues, input.lines);
      allocated.forEach((value, index) => {
        if (value === 0n) return;
        remaining[index] = remaining[index]! - value;
        contributions[index]!.push({ discountId: discount.id, amountMinor: value });
      });
      applications.push({
        discountId: discount.id, name: discount.name, code: discount.code, type: discount.type,
        value: discount.value, priority: discount.priority, amountMinor: amount, endsAt: discount.endsAt,
      });
    }

    const merchandiseDiscount = grossSubtotal - remaining.reduce((sum, value) => sum + value, 0n);
    const shippingDiscount = input.shippingMinor - shippingRemaining;
    return {
      grossMerchandiseSubtotalMinor: grossSubtotal,
      lines: input.lines.map((line, index) => ({
        ...line,
        grossMinor: grossValues[index]!,
        discountContributions: contributions[index]!,
        discountMinor: grossValues[index]! - remaining[index]!,
        finalMinor: remaining[index]!,
      })),
      discounts: applications,
      grossShippingMinor: input.shippingMinor,
      shippingDiscountMinor: shippingDiscount,
      merchandiseDiscountMinor: merchandiseDiscount,
      totalDiscountMinor: merchandiseDiscount + shippingDiscount,
      grandTotalMinor: remaining.reduce((sum, value) => sum + value, 0n) + shippingRemaining,
      eligibleCoupon,
    };
  }
}
