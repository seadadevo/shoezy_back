import { Prisma, type PrismaClient } from "@prisma/client";
import { prisma } from "../../config/database";
import { isSerializableTransactionConflict } from "../../common/utils/prisma-transaction";
import { isUniqueConstraintError } from "../auth/auth.errors";
import { optionSelect, optionValueSelect, type ProductOptionRecord, type ProductOptionValueRecord, type ProductOptionValueUsage } from "./product-options.types";
import type { CreateOptionInput, CreateOptionValueInput, UpdateOptionInput, UpdateOptionValueInput } from "./product-options.validation";
import { upsertTranslations } from "../../common/localization/catalog-localization";
export class ProductOptionsRepositoryError extends Error { constructor(public readonly code: "DUPLICATE_OPTION_NAME" | "DUPLICATE_OPTION_VALUE") { super(code); } }
function jsonData(value: unknown) { return value === null ? Prisma.DbNull : value as Prisma.InputJsonValue; }
export class ProductOptionsRepository {
  constructor(private readonly client: PrismaClient = prisma) {}
  private async serializable<T>(operation: (transaction: Prisma.TransactionClient) => Promise<T>): Promise<T> { for (let attempt = 1; attempt <= 3; attempt += 1) { try { return await this.client.$transaction(operation, { isolationLevel: "Serializable" }); } catch (error: unknown) { if (!isSerializableTransactionConflict(error) || attempt === 3) throw error; } } throw new Error("Serializable retry exhausted"); }
  findProduct(productId: string): Promise<{ id: string; status: "DRAFT" | "ACTIVE" } | null> { return this.client.product.findFirst({ where: { id: productId, deletedAt: null }, select: { id: true, status: true } }); }
  list(productId: string): Promise<ProductOptionRecord[]> { return this.client.productOption.findMany({ where: { productId }, orderBy: [{ position: "asc" }, { id: "asc" }], select: optionSelect }); }
  findOption(productId: string, optionId: string): Promise<ProductOptionRecord | null> { return this.client.productOption.findFirst({ where: { id: optionId, productId, product: { deletedAt: null } }, select: optionSelect }); }
  async createOption(productId: string, input: CreateOptionInput): Promise<ProductOptionRecord | "PRODUCT_NOT_FOUND" | "WOULD_INVALIDATE_PRODUCT"> { try { return await this.serializable(async (transaction) => {
    const product = await transaction.product.findFirst({ where: { id: productId, deletedAt: null }, select: { status: true } }); if (!product) return "PRODUCT_NOT_FOUND"; if (product.status === "ACTIVE") return "WOULD_INVALIDATE_PRODUCT";
    const { translations, ...data } = input;
    const created = await transaction.productOption.create({ data: { ...data, productId }, select: { id: true } });
    await upsertTranslations(translations ?? { en: { name: input.name } }, (locale, fields) => transaction.productOptionTranslation.upsert({ where: { optionId_locale: { optionId: created.id, locale } }, create: { optionId: created.id, locale, ...fields }, update: fields }));
    return transaction.productOption.findUniqueOrThrow({ where: { id: created.id }, select: optionSelect });
  }); } catch (error: unknown) { if (isUniqueConstraintError(error)) throw new ProductOptionsRepositoryError("DUPLICATE_OPTION_NAME"); throw error; } }
  async updateOption(productId: string, optionId: string, input: UpdateOptionInput): Promise<ProductOptionRecord | null> { try { return await this.serializable(async (transaction) => {
    const { translations, ...data } = input;
    const current = await transaction.productOption.findFirst({ where: { id: optionId, productId }, select: { id: true } });
    if (!current) return null;
    if (Object.keys(data).length) await transaction.productOption.update({ where: { id: optionId }, data });
    await upsertTranslations(translations, (locale, fields) => transaction.productOptionTranslation.upsert({ where: { optionId_locale: { optionId, locale } }, create: { optionId, locale, ...fields }, update: fields }));
    return transaction.productOption.findUniqueOrThrow({ where: { id: optionId }, select: optionSelect });
  }); } catch (error: unknown) { if (isUniqueConstraintError(error)) throw new ProductOptionsRepositoryError("DUPLICATE_OPTION_NAME"); throw error; } }
  findValue(productId: string, optionId: string, valueId: string): Promise<ProductOptionValueUsage | null> { return this.client.productOptionValue.findFirst({ where: { id: valueId, optionId, option: { productId, product: { deletedAt: null } } }, select: { ...optionValueSelect, _count: { select: { variants: true } } } }); }
  async createValue(optionId: string, input: CreateOptionValueInput): Promise<ProductOptionValueRecord> { try { return await this.serializable(async (transaction) => {
    const { metadataJson, translations, ...fields } = input;
    const created = await transaction.productOptionValue.create({ data: { ...fields, ...(metadataJson !== undefined ? { metadataJson: jsonData(metadataJson) } : {}), optionId }, select: { id: true } });
    await upsertTranslations(translations ?? { en: { displayValue: input.displayValue ?? input.value } }, (locale, translation) => transaction.productOptionValueTranslation.upsert({ where: { optionValueId_locale: { optionValueId: created.id, locale } }, create: { optionValueId: created.id, locale, ...translation }, update: translation }));
    return transaction.productOptionValue.findUniqueOrThrow({ where: { id: created.id }, select: optionValueSelect });
  }); } catch (error: unknown) { if (isUniqueConstraintError(error)) throw new ProductOptionsRepositoryError("DUPLICATE_OPTION_VALUE"); throw error; } }
  async updateValue(productId: string, optionId: string, valueId: string, input: UpdateOptionValueInput): Promise<ProductOptionValueRecord | "NOT_FOUND" | "IN_USE"> { try { const { metadataJson, translations, ...fields } = input; return await this.serializable(async (transaction) => { const current = await transaction.productOptionValue.findFirst({ where: { id: valueId, optionId, option: { productId, product: { deletedAt: null } } }, select: { value: true, _count: { select: { variants: true } } } }); if (!current) return "NOT_FOUND"; if (input.value !== undefined && input.value !== current.value && current._count.variants > 0) return "IN_USE"; if (Object.keys(fields).length || metadataJson !== undefined) await transaction.productOptionValue.update({ where: { id: valueId }, data: { ...fields, ...(metadataJson !== undefined ? { metadataJson: jsonData(metadataJson) } : {}) } }); await upsertTranslations(translations, (locale, translation) => transaction.productOptionValueTranslation.upsert({ where: { optionValueId_locale: { optionValueId: valueId, locale } }, create: { optionValueId: valueId, locale, ...translation }, update: translation })); return transaction.productOptionValue.findUniqueOrThrow({ where: { id: valueId }, select: optionValueSelect }); }); } catch (error: unknown) { if (isUniqueConstraintError(error)) throw new ProductOptionsRepositoryError("DUPLICATE_OPTION_VALUE"); throw error; } }
  deleteOptionIfUnused(productId: string, optionId: string): Promise<"DELETED" | "IN_USE" | "NOT_FOUND"> { return this.client.$transaction(async (transaction) => { const option = await transaction.productOption.findFirst({ where: { id: optionId, productId }, select: { id: true, values: { select: { _count: { select: { variants: true } } } } } }); if (!option) return "NOT_FOUND"; if (option.values.some((value) => value._count.variants > 0)) return "IN_USE"; await transaction.productOption.delete({ where: { id: optionId } }); return "DELETED"; }, { isolationLevel: "Serializable" }); }
  deleteValueIfUnused(productId: string, optionId: string, valueId: string): Promise<"DELETED" | "IN_USE" | "NOT_FOUND"> { return this.client.$transaction(async (transaction) => { const value = await transaction.productOptionValue.findFirst({ where: { id: valueId, optionId, option: { productId } }, select: { id: true, _count: { select: { variants: true } } } }); if (!value) return "NOT_FOUND"; if (value._count.variants > 0) return "IN_USE"; await transaction.productOptionValue.delete({ where: { id: valueId } }); return "DELETED"; }, { isolationLevel: "Serializable" }); }
}
