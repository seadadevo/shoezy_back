import { AppError } from "../../common/errors/app-error";
import type { ProductReadinessRecord } from "./products.types";

export function assertProductReady(state: ProductReadinessRecord, productId: string) {
  const categories = state.productCategories.filter((link) => link.category.isActive);
  const primary = state.productCategories.filter((link) => link.isPrimary);
  const optionIds = new Set(state.options.map((option) => option.id));
  const validVariants = state.variants.every((variant) => {
    const selected = variant.optionValues.map((link) => link.optionValue.option);
    const validPrice = variant.priceMinor >= 0n && (variant.costMinor === null || variant.costMinor >= 0n) && (variant.compareAtPriceMinor === null || variant.compareAtPriceMinor >= variant.priceMinor);
    return validPrice && selected.length === optionIds.size && new Set(selected.map((option) => option.id)).size === optionIds.size && selected.every((option) => option.productId === productId && optionIds.has(option.id));
  });
  if (!state.brand.isActive || categories.length === 0 || primary.length > 1 || (primary[0] && !primary[0].category.isActive) || state.variants.length === 0 || !validVariants) throw new AppError(400, "Product is not ready for activation", "PRODUCT_NOT_READY");
}
