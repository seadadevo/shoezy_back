import { Prisma, type PrismaClient } from "@prisma/client";
import { prisma } from "../../config/database";
import { AppError } from "../../common/errors/app-error";
import { isSerializableTransactionConflict } from "../../common/utils/prisma-transaction";
import { isUniqueConstraintError, uniqueConstraintFields } from "../auth/auth.errors";
import { AuditLogService } from "../admin-audit/audit-log.service";
import { recordStockMovement } from "../inventory/inventory.repository";
import { detailSelect, readinessSelect } from "./products.repository";
import { assertProductReady } from "./products-readiness";
import type { ProductEditorCreateInput, ProductEditorUpdateInput } from "./product-editor.validation";
import type { UploadedMedia } from "./media-storage";
import { upsertTranslations } from "../../common/localization/catalog-localization";

const json = (value: unknown) => value === null ? Prisma.DbNull : value as Prisma.InputJsonValue;
const missing = (path: string, message: string) => new AppError(422, message, "PRODUCT_EDITOR_REFERENCE_INVALID", { issues: [{ path: path.split("."), message }] });
type VariantFields = NonNullable<ProductEditorCreateInput["variants"]>[number];

export class ProductEditorRepository {
  constructor(private readonly client: PrismaClient = prisma) {}
  private async serializable<T>(work: (tx: Prisma.TransactionClient) => Promise<T>): Promise<T> {
    for (let attempt = 1; attempt <= 3; attempt += 1) {
      try { return await this.client.$transaction(work, { isolationLevel: "Serializable", timeout: 20_000 }); }
      catch (error: unknown) { if (!isSerializableTransactionConflict(error) || attempt === 3) throw error; }
    }
    throw new Error("Serializable retry exhausted");
  }
  formContext() { return Promise.all([
    this.client.brand.findMany({ where: { isActive: true }, select: { id: true, name: true }, orderBy: { name: "asc" } }),
    this.client.category.findMany({ select: { id: true, name: true, parentId: true, isActive: true }, orderBy: { name: "asc" } }),
    this.client.sizeGuide.findMany({ select: { id: true, name: true, brandId: true }, orderBy: { name: "asc" } }),
  ]).then(([brands, categories, sizeGuides]) => ({ brands, categories, sizeGuides })); }
  private async categories(tx: Prisma.TransactionClient, productId: string, input: NonNullable<ProductEditorCreateInput["categories"]>) {
    const found = await tx.category.findMany({ where: { id: { in: input.categoryIds } }, select: { id: true, isActive: true } });
    if (found.length !== input.categoryIds.length) throw missing("categories.categoryIds", "Category not found");
    await tx.productCategory.deleteMany({ where: { productId } });
    if (input.categoryIds.length) await tx.productCategory.createMany({ data: input.categoryIds.map((categoryId) => ({ productId, categoryId, isPrimary: categoryId === input.primaryCategoryId })) });
  }
  private async variant(tx: Prisma.TransactionClient, productId: string, fields: Omit<VariantFields, "clientKey" | "optionValueClientKeys">, valueIds: string[], actorId: string, existingId?: string) {
    const { metadataJson, priceMinor, costMinor, compareAtPriceMinor, stockQuantity, ...scalars } = fields;
    const optionIds = await tx.productOption.findMany({ where: { productId }, select: { id: true } });
    const values = await tx.productOptionValue.findMany({ where: { id: { in: valueIds }, option: { productId } }, select: { id: true, optionId: true } });
    if (values.length !== valueIds.length || new Set(values.map((value) => value.optionId)).size !== optionIds.length || values.length !== optionIds.length) throw missing("variants.optionValueClientKeys", "A variant must select one value from every option");
    if (compareAtPriceMinor != null && BigInt(compareAtPriceMinor) < BigInt(priceMinor)) throw missing("variants.compareAtPriceMinor", "Compare-at price must not be lower than price");
    const data = { ...scalars, priceMinor: BigInt(priceMinor), stockQuantity: stockQuantity ?? 0,
      ...(costMinor !== undefined ? { costMinor: costMinor === null ? null : BigInt(costMinor) } : {}),
      ...(compareAtPriceMinor !== undefined ? { compareAtPriceMinor: compareAtPriceMinor === null ? null : BigInt(compareAtPriceMinor) } : {}),
      ...(metadataJson !== undefined ? { metadataJson: json(metadataJson) } : {}),
    };
    if (!existingId) {
      const created = await tx.productVariant.create({ data: { ...data, productId, optionValues: { create: valueIds.map((optionValueId) => ({ optionValueId })) } }, select: { id: true, stockQuantity: true } });
      await recordStockMovement(tx, { variantId: created.id, type: "INITIAL_STOCK", beforeQuantity: 0, afterQuantity: created.stockQuantity, referenceType: "VARIANT", referenceId: created.id, actorUserId: actorId });
      return created.id;
    }
    throw new Error("Existing variants use updateVariant");
  }
  private async addMedia(tx: Prisma.TransactionClient, productId: string, entries: Array<{ fileIndex?: number; url?: string; variantClientKey?: string | null; variantId?: string | null; position?: number; isPrimary?: boolean; altText?: string | null }>, uploads: UploadedMedia[], variantKeys: Map<string, string>) {
    for (const [index, entry] of entries.entries()) {
      const variantId = entry.variantClientKey ? variantKeys.get(entry.variantClientKey) : entry.variantId ?? null;
      if (entry.variantClientKey && !variantId) throw missing(`media.${index}.variantClientKey`, "Unknown variant key");
      if (variantId && !await tx.productVariant.findFirst({ where: { id: variantId, productId, deletedAt: null }, select: { id: true } })) throw missing(`media.${index}.variantId`, "Variant not found");
      const uploaded = entry.fileIndex === undefined ? undefined : uploads[entry.fileIndex];
      if (entry.fileIndex !== undefined && !uploaded) throw missing(`media.${index}.fileIndex`, "Uploaded file not found");
      if (entry.isPrimary) await tx.productMedia.updateMany({ where: { productId, isPrimary: true }, data: { isPrimary: false } });
      await tx.productMedia.create({ data: { productId, variantId, type: "IMAGE", mediaType: "IMAGE", url: uploaded?.url ?? entry.url!, altText: entry.altText, position: entry.position ?? 0, isPrimary: entry.isPrimary ?? false, storageProvider: uploaded?.provider, storageKey: uploaded?.key } });
    }
  }
  async create(input: ProductEditorCreateInput, uploads: UploadedMedia[], actorId: string) {
    try { return await this.serializable(async (tx) => {
      const brand = await tx.brand.findUnique({ where: { id: input.product.brandId }, select: { id: true } });
      if (!brand) throw missing("product.brandId", "Brand not found");
      if (input.product.sizeGuideId && !await tx.sizeGuide.findUnique({ where: { id: input.product.sizeGuideId }, select: { id: true } })) throw missing("product.sizeGuideId", "Size guide not found");
      let groupId: string | undefined = undefined;
      if (input.product.linkToProductId) {
        const target = await tx.product.findUnique({ where: { id: input.product.linkToProductId }, select: { groupId: true } });
        if (!target) throw missing("product.linkToProductId", "Target product not found");
        groupId = target.groupId;
      }
      const { translations: productTranslations, linkToProductId: _linkToProductId, unlinkFromGroup: _unlinkFromGroup, ...productData } = input.product;
      const created = await tx.product.create({ data: { ...productData, ...(groupId ? { groupId } : {}), slug: input.product.slug ?? input.product.name, status: "DRAFT" }, select: { id: true } });
      await upsertTranslations(productTranslations ?? { en: { name: input.product.name, shortDescription: input.product.shortDescription, description: input.product.description, material: input.product.material, seoTitle: input.product.seoTitle, seoDescription: input.product.seoDescription } }, (locale, fields) => tx.productTranslation.upsert({ where: { productId_locale: { productId: created.id, locale } }, create: { productId: created.id, locale, ...fields }, update: fields }));
      if (input.categories) await this.categories(tx, created.id, input.categories);
      const valueKeys = new Map<string, string>(), variantKeys = new Map<string, string>();
      for (const option of input.options ?? []) {
        const createdOption = await tx.productOption.create({ data: { productId: created.id, name: option.name, position: option.position ?? 0 }, select: { id: true } });
        await upsertTranslations(option.translations ?? { en: { name: option.name } }, (locale, fields) => tx.productOptionTranslation.upsert({ where: { optionId_locale: { optionId: createdOption.id, locale } }, create: { optionId: createdOption.id, locale, ...fields }, update: fields }));
        for (const value of option.values) {
          const { clientKey, metadataJson, translations, ...fields } = value;
          const createdValue = await tx.productOptionValue.create({ data: { ...fields, optionId: createdOption.id, ...(metadataJson !== undefined ? { metadataJson: json(metadataJson) } : {}) }, select: { id: true } });
          await upsertTranslations(translations ?? { en: { displayValue: value.displayValue ?? value.value } }, (locale, translation) => tx.productOptionValueTranslation.upsert({ where: { optionValueId_locale: { optionValueId: createdValue.id, locale } }, create: { optionValueId: createdValue.id, locale, ...translation }, update: translation }));
          valueKeys.set(clientKey, createdValue.id);
        }
      }
      for (const [index, variant] of (input.variants ?? []).entries()) {
        const { clientKey, optionValueClientKeys, ...fields } = variant;
        const valueIds = optionValueClientKeys.map((key) => valueKeys.get(key));
        if (valueIds.some((id) => !id)) throw missing(`variants.${index}.optionValueClientKeys`, "Unknown option value key");
        variantKeys.set(clientKey, await this.variant(tx, created.id, fields, valueIds as string[], actorId));
      }
      const combinations = await tx.productVariant.findMany({ where: { productId: created.id }, select: { optionValues: { select: { optionValueId: true } } } });
      const uniqueCombinations = new Set(combinations.map((variant) => variant.optionValues.map((link) => link.optionValueId).sort().join("|")));
      if (uniqueCombinations.size !== combinations.length) throw new AppError(409, "Variant combination already exists", "PRODUCT_VARIANT_COMBINATION_CONFLICT");
      await this.addMedia(tx, created.id, input.media ?? [], uploads, variantKeys);
      await new AuditLogService().record({ actorUserId: actorId, action: "PRODUCT_CREATE", entityType: "PRODUCT", entityId: created.id, metadata: { categoriesChanged: Boolean(input.categories), optionsChanged: Boolean(input.options), variantsCreated: input.variants?.length ?? 0, mediaAdded: input.media?.length ?? 0 } }, tx);
      return tx.product.findUniqueOrThrow({ where: { id: created.id }, select: detailSelect });
    }); } catch (error: unknown) { this.mapError(error); }
  }
  async update(productId: string, input: ProductEditorUpdateInput, uploads: UploadedMedia[], actorId: string) {
    try { return await this.serializable(async (tx) => {
      await tx.$queryRaw`SELECT "id" FROM "products" WHERE "id" = ${productId}::uuid FOR UPDATE`;
      const current = await tx.product.findFirst({ where: { id: productId, deletedAt: null }, select: { id: true, status: true, publishedAt: true, basePrice: true, compareAtPrice: true } });
      if (!current) throw new AppError(404, "Product not found", "PRODUCT_NOT_FOUND");
      if (input.product) {
        const base = input.product.basePrice ?? current.basePrice.toString();
        const compare = input.product.compareAtPrice === undefined ? current.compareAtPrice?.toString() : input.product.compareAtPrice;
        if (compare != null && new Prisma.Decimal(compare).lessThan(new Prisma.Decimal(base))) throw missing("product.compareAtPrice", "Compare-at price must not be lower than base price");
        if (input.product.brandId && !await tx.brand.findUnique({ where: { id: input.product.brandId }, select: { id: true } })) throw missing("product.brandId", "Brand not found");
        if (input.product.sizeGuideId && !await tx.sizeGuide.findUnique({ where: { id: input.product.sizeGuideId }, select: { id: true } })) throw missing("product.sizeGuideId", "Size guide not found");
        let groupIdUpdate: { groupId?: string } = {};
        if (input.product.unlinkFromGroup === true) {
          groupIdUpdate = { groupId: crypto.randomUUID() };
        } else if (input.product.linkToProductId) {
          const target = await tx.product.findUnique({ where: { id: input.product.linkToProductId }, select: { groupId: true } });
          if (!target) throw missing("product.linkToProductId", "Target product not found");
          groupIdUpdate = { groupId: target.groupId };
        }
        const { translations, linkToProductId: _linkToProductId, unlinkFromGroup: _unlinkFromGroup, ...productData } = input.product;
        const updateData = { ...productData, ...groupIdUpdate, ...(input.product.status === "ACTIVE" && !current.publishedAt ? { publishedAt: new Date() } : {}) };
        if (Object.keys(updateData).length) await tx.product.update({ where: { id: productId }, data: updateData });
        if (translations) await upsertTranslations(translations, (locale, fields) => tx.productTranslation.upsert({ where: { productId_locale: { productId, locale } }, create: { productId, locale, ...fields }, update: fields }));
      }
      if (input.categories) await this.categories(tx, productId, input.categories);
      const valueKeys = new Map<string, string>(), variantKeys = new Map<string, string>();
      const valueDeletes: string[] = [], optionDeletes = input.options?.deleteIds ?? [];
      for (const [optionIndex, option] of (input.options?.upsert ?? []).entries()) {
        let optionId = option.id;
        if (optionId) {
          if (!await tx.productOption.findFirst({ where: { id: optionId, productId }, select: { id: true } })) throw missing(`options.upsert.${optionIndex}.id`, "Option not found");
          const { id: _id, clientKey: _clientKey, values: _values, translations, ...fields } = option;
          if (Object.keys(fields).length) await tx.productOption.update({ where: { id: optionId }, data: fields });
          await upsertTranslations(translations, (locale, translation) => tx.productOptionTranslation.upsert({ where: { optionId_locale: { optionId: optionId!, locale } }, create: { optionId: optionId!, locale, ...translation }, update: translation }));
        } else {
          if (!option.name) throw missing(`options.upsert.${optionIndex}.name`, "Name is required for a new option");
          optionId = (await tx.productOption.create({ data: { productId, name: option.name, position: option.position ?? 0 }, select: { id: true } })).id;
          await upsertTranslations(option.translations ?? { en: { name: option.name } }, (locale, translation) => tx.productOptionTranslation.upsert({ where: { optionId_locale: { optionId: optionId!, locale } }, create: { optionId: optionId!, locale, ...translation }, update: translation }));
        }
        for (const [valueIndex, value] of (option.values?.upsert ?? []).entries()) {
          let valueId = value.id;
          const { id: _id, clientKey, metadataJson, translations, ...fields } = value;
          if (valueId) {
            if (!await tx.productOptionValue.findFirst({ where: { id: valueId, optionId }, select: { id: true } })) throw missing(`options.upsert.${optionIndex}.values.upsert.${valueIndex}.id`, "Option value not found");
            if (Object.keys(fields).length || metadataJson !== undefined) await tx.productOptionValue.update({ where: { id: valueId }, data: { ...fields, ...(metadataJson !== undefined ? { metadataJson: json(metadataJson) } : {}) } });
            await upsertTranslations(translations, (locale, translation) => tx.productOptionValueTranslation.upsert({ where: { optionValueId_locale: { optionValueId: valueId!, locale } }, create: { optionValueId: valueId!, locale, ...translation }, update: translation }));
          } else {
            if (!value.value) throw missing(`options.upsert.${optionIndex}.values.upsert.${valueIndex}.value`, "Value is required for a new option value");
            valueId = (await tx.productOptionValue.create({ data: { ...fields, value: value.value, optionId, ...(metadataJson !== undefined ? { metadataJson: json(metadataJson) } : {}) }, select: { id: true } })).id;
            await upsertTranslations(translations ?? { en: { displayValue: value.displayValue ?? value.value } }, (locale, translation) => tx.productOptionValueTranslation.upsert({ where: { optionValueId_locale: { optionValueId: valueId!, locale } }, create: { optionValueId: valueId!, locale, ...translation }, update: translation }));
          }
          if (clientKey) {
            if (valueKeys.has(clientKey)) throw missing(`options.upsert.${optionIndex}.values.upsert.${valueIndex}.clientKey`, "Duplicate option value key");
            valueKeys.set(clientKey, valueId);
          }
        }
        valueDeletes.push(...(option.values?.deleteIds ?? []));
      }
      for (const [index, item] of (input.variants?.upsert ?? []).entries()) {
        const { id, clientKey, optionValueIds, optionValueClientKeys, stockQuantity, metadataJson, priceMinor, costMinor, compareAtPriceMinor, ...fields } = item;
        if (optionValueIds && optionValueClientKeys) throw missing(`variants.upsert.${index}.optionValueIds`, "Choose IDs or client keys");
        const selected = optionValueIds ?? optionValueClientKeys?.map((key) => valueKeys.get(key) ?? "");
        if (selected?.some((value) => !value)) throw missing(`variants.upsert.${index}.optionValueClientKeys`, "Unknown option value key");
        let variantId = id;
        if (variantId) {
          const existing = await tx.productVariant.findFirst({ where: { id: variantId, productId, deletedAt: null }, select: { stockQuantity: true, priceMinor: true, compareAtPriceMinor: true } });
          if (!existing) throw missing(`variants.upsert.${index}.id`, "Variant not found");
          const finalPrice = priceMinor === undefined ? existing.priceMinor : BigInt(priceMinor);
          const finalCompare = compareAtPriceMinor === undefined ? existing.compareAtPriceMinor : compareAtPriceMinor === null ? null : BigInt(compareAtPriceMinor);
          if (finalCompare !== null && finalCompare < finalPrice) throw missing(`variants.upsert.${index}.compareAtPriceMinor`, "Compare-at price must not be lower than price");
          await tx.productVariant.update({ where: { id: variantId }, data: { ...fields,
            ...(priceMinor !== undefined ? { priceMinor: BigInt(priceMinor) } : {}),
            ...(costMinor !== undefined ? { costMinor: costMinor === null ? null : BigInt(costMinor) } : {}),
            ...(compareAtPriceMinor !== undefined ? { compareAtPriceMinor: compareAtPriceMinor === null ? null : BigInt(compareAtPriceMinor) } : {}),
            ...(metadataJson !== undefined ? { metadataJson: json(metadataJson) } : {}),
            ...(stockQuantity !== undefined ? { stockQuantity } : {}),
          } });
          if (stockQuantity !== undefined) await recordStockMovement(tx, { variantId, type: "MANUAL_SET", beforeQuantity: existing.stockQuantity, afterQuantity: stockQuantity, referenceType: "VARIANT", referenceId: variantId, actorUserId: actorId });
          if (selected) {
            const valid = await tx.productOptionValue.findMany({ where: { id: { in: selected }, option: { productId } }, select: { id: true, optionId: true } });
            const options = await tx.productOption.count({ where: { productId } });
            if (new Set(selected).size !== selected.length || valid.length !== selected.length || new Set(valid.map((value) => value.optionId)).size !== options || valid.length !== options) throw missing(`variants.upsert.${index}.optionValueIds`, "A variant must select one value from every option");
            await tx.variantOptionValue.deleteMany({ where: { variantId } });
            if (selected.length) await tx.variantOptionValue.createMany({ data: selected.map((optionValueId) => ({ variantId: variantId!, optionValueId })) });
          }
        } else {
          if (!item.sku || !item.title || !item.priceMinor || !selected) throw missing(`variants.upsert.${index}`, "New variant requires SKU, title, price, and option values");
          variantId = await this.variant(tx, productId, { ...fields, sku: item.sku, title: item.title, priceMinor: item.priceMinor, stockQuantity, costMinor, compareAtPriceMinor, metadataJson }, selected, actorId);
        }
        if (clientKey) {
          if (variantKeys.has(clientKey)) throw missing(`variants.upsert.${index}.clientKey`, "Duplicate variant key");
          variantKeys.set(clientKey, variantId);
        }
      }
      for (const [index, id] of (input.variants?.deleteIds ?? []).entries()) {
        if (!await tx.productVariant.findFirst({ where: { id, productId, deletedAt: null }, select: { id: true } })) throw missing(`variants.deleteIds.${index}`, "Variant not found");
        await tx.productVariant.update({ where: { id }, data: { deletedAt: new Date(), isActive: false } });
      }
      for (const [index, id] of valueDeletes.entries()) {
        const found = await tx.productOptionValue.findFirst({ where: { id, option: { productId } }, select: { id: true } });
        if (!found) throw missing(`options.values.deleteIds.${index}`, "Option value not found");
        if (await tx.variantOptionValue.count({ where: { optionValueId: id } })) throw new AppError(409, "Option value is used by a variant", "PRODUCT_OPTION_VALUE_IN_USE");
        await tx.productOptionValue.delete({ where: { id } });
      }
      for (const [index, id] of optionDeletes.entries()) {
        const found = await tx.productOption.findFirst({ where: { id, productId }, select: { id: true } });
        if (!found) throw missing(`options.deleteIds.${index}`, "Option not found");
        if (await tx.variantOptionValue.count({ where: { optionValue: { optionId: id } } })) throw new AppError(409, "Option is used by a variant", "PRODUCT_OPTION_IN_USE");
        await tx.productOption.delete({ where: { id } });
      }
      const combos = await tx.productVariant.findMany({ where: { productId, deletedAt: null }, select: { id: true, optionValues: { select: { optionValueId: true } } } });
      const signatures = new Set<string>();
      for (const combo of combos) { const signature = combo.optionValues.map((link) => link.optionValueId).sort().join("|"); if (signatures.has(signature)) throw new AppError(409, "Variant combination already exists", "PRODUCT_VARIANT_COMBINATION_CONFLICT"); signatures.add(signature); }
      const deletedMediaKeys: string[] = [];
      for (const [index, id] of (input.media?.deleteIds ?? []).entries()) {
        const found = await tx.productMedia.findFirst({ where: { id, productId }, select: { storageProvider: true, storageKey: true } });
        if (!found) throw missing(`media.deleteIds.${index}`, "Media not found");
        await tx.productMedia.delete({ where: { id } });
        if ((found.storageProvider === "CLOUDINARY" || found.storageProvider === "LOCAL") && found.storageKey) deletedMediaKeys.push(found.storageKey);
      }
      for (const [index, entry] of (input.media?.existing ?? []).entries()) {
        const existingMedia = await tx.productMedia.findFirst({ where: { id: entry.id, productId }, select: { id: true, type: true, mediaType: true } });
        if (!existingMedia) throw missing(`media.existing.${index}.id`, "Media not found");
        if (entry.variantId && !await tx.productVariant.findFirst({ where: { id: entry.variantId, productId, deletedAt: null }, select: { id: true } })) throw missing(`media.existing.${index}.variantId`, "Variant not found");
        if (entry.isPrimary) {
          if (existingMedia.type === "VIDEO" || existingMedia.mediaType === "VIDEO") {
            throw new AppError(422, "Video media cannot be used as the product primary cover", "MEDIA_VIDEO_CANNOT_BE_PRIMARY");
          }
          await tx.productMedia.updateMany({ where: { productId, isPrimary: true }, data: { isPrimary: false } });
        }
        const { id, ...fields } = entry;
        await tx.productMedia.update({ where: { id }, data: fields });
      }
      await this.addMedia(tx, productId, input.media?.new ?? [], uploads, variantKeys);
      const final = await tx.product.findUniqueOrThrow({ where: { id: productId }, select: { status: true } });
      if (final.status === "ACTIVE") {
        const state = await tx.product.findUniqueOrThrow({ where: { id: productId }, select: readinessSelect });
        assertProductReady(state, productId);
      }
      await new AuditLogService().record({ actorUserId: actorId, action: "PRODUCT_UPDATE", entityType: "PRODUCT", entityId: productId, metadata: { categoriesChanged: Boolean(input.categories), optionsChanged: Boolean(input.options), variantsCreated: input.variants?.upsert.filter((variant) => !variant.id).length ?? 0, mediaAdded: input.media?.new.length ?? 0 } }, tx);
      return { product: await tx.product.findUniqueOrThrow({ where: { id: productId }, select: detailSelect }), deletedMediaKeys };
    }); } catch (error: unknown) { this.mapError(error); }
  }
  private mapError(error: unknown): never {
    if (isUniqueConstraintError(error)) {
      const fields = uniqueConstraintFields(error);
      const field = fields.some((name) => name.includes("sku")) ? "variants.sku" : fields.some((name) => name.includes("barcode")) ? "variants.barcode" : fields.some((name) => name.includes("slug")) ? "product.slug" : "product";
      throw new AppError(409, "Product value already exists", "PRODUCT_EDITOR_CONFLICT", { issues: [{ path: field.split("."), message: "Value already exists" }] });
    }
    throw error;
  }
}
