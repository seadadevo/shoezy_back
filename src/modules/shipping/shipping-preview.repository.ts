import type { Prisma, PrismaClient } from "@prisma/client";
import { prisma } from "../../config/database";
import { publicProductVisibility } from "../catalog/public-product-visibility";
import { checkoutShippingSelect } from "../checkout/checkout.types";
import { resolveShippingRates } from "./shipping-zone-pricing";
import type { ShippingPreviewInput } from "./shipping-preview.validation";

export class ShippingPreviewRepository {
  constructor(private readonly client: PrismaClient = prisma) {}

  preview(slug: string, input: ShippingPreviewInput, now: Date) {
    return this.client.$transaction(async (transaction: Prisma.TransactionClient) => {
      const [product, settings] = await Promise.all([
        transaction.product.findFirst({ where: { ...publicProductVisibility(now), slug }, select: { id: true } }),
        transaction.storeSettings.findUnique({ where: { id: 1 }, select: { currency: true } }),
      ]);
      if (!product) return null;
      const methods = await transaction.shippingMethod.findMany({
        where: { isActive: true, currency: settings?.currency ?? "TND" },
        orderBy: [{ name: "asc" }, { id: "asc" }],
        select: checkoutShippingSelect,
      });
      const rates = await resolveShippingRates(transaction, { ...input, area: input.area ?? null }, methods);
      return methods.flatMap((method) => {
        const rate = rates.get(method.id);
        return rate ? [{
          id: method.id, code: method.code, name: method.name,
          priceMinor: rate.priceMinor.toString(), currency: rate.currency,
          estimatedMinDays: rate.estimatedMinDays, estimatedMaxDays: rate.estimatedMaxDays,
        }] : [];
      });
    }, { isolationLevel: "RepeatableRead" });
  }
}
