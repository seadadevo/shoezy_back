import { Prisma, type DiscountScope, type DiscountType, type PrismaClient } from "@prisma/client";
import { prisma } from "../../config/database";
import { isSerializableTransactionConflict } from "../../common/utils/prisma-transaction";
import { isUniqueConstraintError, uniqueConstraintFields } from "../auth/auth.errors";
import { discountSelect, type DiscountRecord } from "./discounts.types";
import type { DiscountTargetInput, ListDiscountsQuery } from "./discounts.validation";

export type DiscountWriteFields = {
  name?: string;
  description?: string | null;
  imageUrl?: string | null;
  imageStorageProvider?: string | null;
  imageStorageKey?: string | null;
  showOnStorefront?: boolean;
  sortOrder?: number;
  ctaUrl?: string | null;
  code?: string | null;
  type?: DiscountType;
  scope?: DiscountScope;
  priority?: number;
  value?: bigint;
  currency?: string | null;
  minOrderMinor?: bigint | null;
  maxDiscountMinor?: bigint | null;
  usageLimit?: number | null;
  perCustomerLimit?: number | null;
  startsAt?: Date;
  endsAt?: Date | null;
  isActive?: boolean;
  combinable?: boolean;
  translations?: Partial<Record<"ar" | "en", { name: string; description?: string | null }>>;
};

export type FinalDiscountState = Required<Pick<DiscountWriteFields, "name" | "type" | "scope" | "priority" | "value" | "startsAt">>
  & Omit<DiscountWriteFields, "name" | "type" | "scope" | "priority" | "value" | "startsAt">
  & { targets: DiscountTargetInput[] };

export class DiscountsRepositoryError extends Error {
  constructor(public readonly code: "DUPLICATE_CODE" | "DUPLICATE_PRIORITY" | "DUPLICATE_TARGET") { super(code); }
}

function mapUnique(error: unknown): never {
  if (isUniqueConstraintError(error)) {
    const fields = uniqueConstraintFields(error);
    if (fields.some((field) => field.includes("priority"))) throw new DiscountsRepositoryError("DUPLICATE_PRIORITY");
    if (fields.some((field) => field.includes("code"))) throw new DiscountsRepositoryError("DUPLICATE_CODE");
    throw new DiscountsRepositoryError("DUPLICATE_TARGET");
  }
  throw error;
}

function normalizedTargets(record: DiscountRecord): DiscountTargetInput[] {
  return record.targets.map((target) => {
    if (target.productId) return { productId: target.productId };
    if (target.variantId) return { variantId: target.variantId };
    if (target.categoryId) return { categoryId: target.categoryId };
    return { collectionId: target.collectionId! };
  });
}

export class DiscountsRepository {
  constructor(private readonly client: PrismaClient = prisma) {}

  private async serializable<T>(operation: (transaction: Prisma.TransactionClient) => Promise<T>): Promise<T> {
    for (let attempt = 1; attempt <= 3; attempt += 1) {
      try { return await this.client.$transaction(operation, { isolationLevel: "Serializable" }); }
      catch (error: unknown) {
        if (!isSerializableTransactionConflict(error) || attempt === 3) throw error;
      }
    }
    throw new Error("Serializable retry exhausted");
  }

  async list(query: ListDiscountsQuery): Promise<{ items: DiscountRecord[]; total: number }> {
    const where: Prisma.DiscountWhereInput = {
      isActive: query.isActive,
      type: query.type,
      scope: query.scope,
      ...(query.search ? { OR: [
        { name: { contains: query.search, mode: "insensitive" } },
        { code: { contains: query.search, mode: "insensitive" } },
        { translations: { some: { name: { contains: query.search, mode: "insensitive" } } } },
      ] } : {}),
    };
    const [items, total] = await this.client.$transaction([
      this.client.discount.findMany({ where, skip: (query.page - 1) * query.limit, take: query.limit, orderBy: [{ [query.sortBy]: query.sortOrder }, { id: "asc" }], select: discountSelect }),
      this.client.discount.count({ where }),
    ]);
    return { items, total };
  }

  findById(discountId: string): Promise<DiscountRecord | null> {
    return this.client.discount.findUnique({ where: { id: discountId }, select: discountSelect });
  }

  private async validateTargets(transaction: Prisma.TransactionClient, targets: DiscountTargetInput[]): Promise<boolean> {
    const productIds = targets.flatMap((target) => "productId" in target ? [target.productId] : []);
    const variantIds = targets.flatMap((target) => "variantId" in target ? [target.variantId] : []);
    const categoryIds = targets.flatMap((target) => "categoryId" in target ? [target.categoryId] : []);
    const collectionIds = targets.flatMap((target) => "collectionId" in target ? [target.collectionId] : []);
    const [products, variants, categories, collections] = await Promise.all([
      transaction.product.count({ where: { id: { in: productIds }, deletedAt: null } }),
      transaction.productVariant.count({ where: { id: { in: variantIds }, product: { deletedAt: null } } }),
      transaction.category.count({ where: { id: { in: categoryIds } } }),
      transaction.collection.count({ where: { id: { in: collectionIds } } }),
    ]);
    return products === productIds.length && variants === variantIds.length
      && categories === categoryIds.length && collections === collectionIds.length;
  }

  private async upsertTranslations(
    transaction: Prisma.TransactionClient,
    discountId: string,
    translations: DiscountWriteFields["translations"],
  ): Promise<void> {
    if (!translations) return;
    for (const locale of ["ar", "en"] as const) {
      const translation = translations[locale];
      if (!translation) continue;
      await transaction.discountTranslation.upsert({
        where: { discountId_locale: { discountId, locale } },
        create: { discountId, locale, ...translation },
        update: translation,
      });
    }
  }

  async create(fields: DiscountWriteFields, targets: DiscountTargetInput[], validate: (state: FinalDiscountState) => void): Promise<DiscountRecord | "TARGET_NOT_FOUND"> {
    try {
      return await this.serializable(async (transaction) => {
        if (!await this.validateTargets(transaction, targets)) return "TARGET_NOT_FOUND";
        const state = { ...fields, targets } as FinalDiscountState;
        validate(state);
        const { translations, ...scalarFields } = fields;
        const created = await transaction.discount.create({
          data: {
            ...(scalarFields as Required<Pick<DiscountWriteFields, "name" | "type" | "scope" | "priority" | "value" | "startsAt">>),
            targets: { create: targets.map((target) => ({ ...target })) },
          },
          select: { id: true },
        });
        await this.upsertTranslations(transaction, created.id, translations ?? {
          en: { name: state.name, description: fields.description ?? null },
        });
        return transaction.discount.findUniqueOrThrow({ where: { id: created.id }, select: discountSelect });
      });
    } catch (error: unknown) { mapUnique(error); }
  }

  async update(discountId: string, fields: DiscountWriteFields, targets: DiscountTargetInput[] | undefined, validate: (state: FinalDiscountState) => void): Promise<DiscountRecord | "NOT_FOUND" | "TARGET_NOT_FOUND"> {
    try {
      return await this.serializable(async (transaction) => {
        await transaction.$queryRaw`SELECT "id" FROM "discounts" WHERE "id" = ${discountId}::uuid FOR UPDATE`;
        const current = await transaction.discount.findUnique({ where: { id: discountId }, select: discountSelect });
        if (!current) return "NOT_FOUND";
        const finalTargets = targets ?? normalizedTargets(current);
        if (!await this.validateTargets(transaction, finalTargets)) return "TARGET_NOT_FOUND";
        validate({
          name: fields.name ?? current.name,
          description: fields.description === undefined ? current.description : fields.description,
          code: fields.code === undefined ? current.code : fields.code,
          type: fields.type ?? current.type,
          scope: fields.scope ?? current.scope,
          priority: fields.priority ?? current.priority,
          value: fields.value ?? current.value,
          currency: fields.currency === undefined ? current.currency : fields.currency,
          minOrderMinor: fields.minOrderMinor === undefined ? current.minOrderMinor : fields.minOrderMinor,
          maxDiscountMinor: fields.maxDiscountMinor === undefined ? current.maxDiscountMinor : fields.maxDiscountMinor,
          usageLimit: fields.usageLimit === undefined ? current.usageLimit : fields.usageLimit,
          perCustomerLimit: fields.perCustomerLimit === undefined ? current.perCustomerLimit : fields.perCustomerLimit,
          startsAt: fields.startsAt ?? current.startsAt,
          endsAt: fields.endsAt === undefined ? current.endsAt : fields.endsAt,
          isActive: fields.isActive ?? current.isActive,
          combinable: fields.combinable ?? current.combinable,
          translations: fields.translations,
          targets: finalTargets,
        });
        const { translations, ...scalarFields } = fields;
        await transaction.discount.update({ where: { id: discountId }, data: scalarFields });
        const english = translations?.en ?? ((fields.name !== undefined || fields.description !== undefined) ? {
          name: fields.name ?? current.name,
          description: fields.description === undefined ? current.description : fields.description,
        } : undefined);
        await this.upsertTranslations(transaction, discountId, translations || english ? { ...translations, ...(english ? { en: english } : {}) } : undefined);
        if (targets) {
          await transaction.discountTarget.deleteMany({ where: { discountId } });
          if (targets.length) await transaction.discountTarget.createMany({ data: targets.map((target) => ({ discountId, ...target })) });
        }
        return transaction.discount.findUniqueOrThrow({ where: { id: discountId }, select: discountSelect });
      });
    } catch (error: unknown) { mapUnique(error); }
  }

  async delete(discountId: string): Promise<"DELETED" | "NOT_FOUND" | "IN_USE"> {
    return this.serializable(async (transaction) => {
      const discount = await transaction.discount.findUnique({ where: { id: discountId }, select: { id: true, _count: { select: { redemptions: true } } } });
      if (!discount) return "NOT_FOUND";
      if (discount._count.redemptions > 0) return "IN_USE";
      await transaction.discount.delete({ where: { id: discountId } });
      return "DELETED";
    });
  }

  async setActive(discountId: string, isActive: boolean): Promise<DiscountRecord | "NOT_FOUND" | "ARCHIVED"> {
    const result = await this.client.discount.updateMany({
      where: { id: discountId, archivedAt: null },
      data: { isActive },
    });
    if (result.count === 0) {
      const exists = await this.client.discount.findUnique({ where: { id: discountId }, select: { archivedAt: true } });
      return exists?.archivedAt ? "ARCHIVED" : "NOT_FOUND";
    }
    return this.client.discount.findUniqueOrThrow({ where: { id: discountId }, select: discountSelect });
  }

  async archive(discountId: string, now: Date): Promise<DiscountRecord | "NOT_FOUND"> {
    const result = await this.client.discount.updateMany({
      where: { id: discountId, archivedAt: null },
      data: { archivedAt: now, isActive: false },
    });
    if (result.count === 0 && !await this.client.discount.findUnique({ where: { id: discountId }, select: { id: true } })) return "NOT_FOUND";
    return this.client.discount.findUniqueOrThrow({ where: { id: discountId }, select: discountSelect });
  }

  async statistics(discountId: string): Promise<{
    usageCount: number;
    associatedOrders: number;
    totalDiscountGrantedMinor: bigint;
    revenueMinor: bigint;
  } | "NOT_FOUND"> {
    const discount = await this.client.discount.findUnique({ where: { id: discountId }, select: { id: true } });
    if (!discount) return "NOT_FOUND";
    const redemptions = await this.client.discountRedemption.findMany({
      where: { discountId, releasedAt: null },
      select: { amountMinor: true, order: { select: { paidMinor: true, refundedMinor: true } } },
    });
    return {
      usageCount: redemptions.length,
      associatedOrders: redemptions.length,
      totalDiscountGrantedMinor: redemptions.reduce((sum, item) => sum + item.amountMinor, 0n),
      revenueMinor: redemptions.reduce((sum, item) => {
        const net = item.order.paidMinor - item.order.refundedMinor;
        return sum + (net > 0n ? net : 0n);
      }, 0n),
    };
  }

  async lockAndValidateUsage(transaction: Prisma.TransactionClient, discountIds: string[], userId: string | null): Promise<"OK" | "LIMIT_EXCEEDED"> {
    if (discountIds.length === 0) return "OK";
    const stableIds = [...discountIds].sort();
    await transaction.$queryRaw(Prisma.sql`
      SELECT "id"
      FROM "discounts"
      WHERE "id" IN (${Prisma.join(stableIds)})
      ORDER BY "priority" ASC, "id" ASC
      FOR UPDATE
    `);
    const discounts = await transaction.discount.findMany({
      where: { id: { in: stableIds } },
      select: { id: true, usageLimit: true, perCustomerLimit: true },
    });
    if (discounts.length !== stableIds.length) return "LIMIT_EXCEEDED";
    const [totals, customerTotals] = await Promise.all([
      transaction.discountRedemption.groupBy({ by: ["discountId"], where: { discountId: { in: stableIds }, releasedAt: null }, _count: { _all: true } }),
      userId ? transaction.discountRedemption.groupBy({ by: ["discountId"], where: { discountId: { in: stableIds }, userId, releasedAt: null }, _count: { _all: true } }) : Promise.resolve([]),
    ]);
    const totalById = new Map(totals.map((item) => [item.discountId, item._count._all]));
    const customerById = new Map(customerTotals.map((item) => [item.discountId, item._count._all]));
    return discounts.some((discount) =>
      (discount.usageLimit !== null && (totalById.get(discount.id) ?? 0) >= discount.usageLimit)
      || (discount.perCustomerLimit !== null && (customerById.get(discount.id) ?? 0) >= discount.perCustomerLimit)
    ) ? "LIMIT_EXCEEDED" : "OK";
  }

  createRedemptions(transaction: Prisma.TransactionClient, orderId: string, userId: string | null, applications: Array<{ discountId: string; amountMinor: bigint }>) {
    if (applications.length === 0) return Promise.resolve({ count: 0 });
    return transaction.discountRedemption.createMany({
      data: applications.map((application) => ({ ...application, orderId, userId, redeemedAt: new Date() })),
    });
  }
}
