import type { ProductOptionRecord, ProductOptionValueRecord } from "./product-options.types";
import { translationsByLocale } from "../../common/localization/catalog-localization";
export function toOptionValueDto(value: ProductOptionValueRecord) { return { id: value.id, optionId: value.optionId, value: value.value, displayValue: value.displayValue, colorHex: value.colorHex, metadataJson: value.metadataJson, position: value.position, translations: translationsByLocale(value.translations) }; }
export function toOptionDto(option: ProductOptionRecord) { return { id: option.id, productId: option.productId, name: option.name, position: option.position, translations: translationsByLocale(option.translations), values: option.values.map(toOptionValueDto) }; }
