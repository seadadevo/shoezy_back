import type { VariantRecord } from "./variants.types";
export function toVariantDto(variant: VariantRecord) { return { id: variant.id, productId: variant.productId,
  sku: variant.sku, barcode: variant.barcode, title: variant.title, isActive: variant.isActive,
  stockQuantity: variant.stockQuantity, weightGrams: variant.weightGrams, priceMinor: variant.priceMinor.toString(),
  costMinor: variant.costMinor?.toString() ?? null, compareAtPriceMinor: variant.compareAtPriceMinor?.toString() ?? null,
  metadataJson: variant.metadataJson, optionValues: variant.optionValues.map((link) => ({
    id: link.optionValue.id, value: link.optionValue.value, displayValue: link.optionValue.displayValue,
    colorHex: link.optionValue.colorHex, position: link.optionValue.position, option: link.optionValue.option,
  })), createdAt: variant.createdAt, updatedAt: variant.updatedAt, deletedAt: variant.deletedAt };
}
