import type { Prisma, PrismaClient } from "@prisma/client";
import { prisma } from "../../config/database";
import { AppError } from "../../common/errors/app-error";
import { AuditLogService } from "../admin-audit/audit-log.service";
import { sizeGuideEntrySelect, sizeGuideSelect, type SizeGuideDetailRecord, type SizeGuideEntryRecord, type SizeGuideRecord } from "./size-guides.types";
import type { CreateSizeGuideEntryInput, CreateSizeGuideInput, ListSizeGuidesQuery, UpdateSizeGuideEntryInput, UpdateSizeGuideInput } from "./size-guides.validation";
export class SizeGuidesRepository {
  constructor(private readonly client: PrismaClient = prisma) {}
  async list(query: ListSizeGuidesQuery): Promise<{ items: SizeGuideRecord[]; total: number }> {
    const where: Prisma.SizeGuideWhereInput = { brandId: query.brandId, ...(query.search ? { OR: [
      { name: { contains: query.search, mode: "insensitive" } },
      { gender: { contains: query.search, mode: "insensitive" } },
    ] } : {}) };
    const [items, total] = await this.client.$transaction([
      this.client.sizeGuide.findMany({ where, skip: (query.page - 1) * query.limit, take: query.limit, orderBy: [{ name: query.sortOrder }, { id: "asc" }], select: sizeGuideSelect }),
      this.client.sizeGuide.count({ where }),
    ]);
    return { items, total };
  }
  findBrand(brandId: string): Promise<{ id: string; isActive: boolean } | null> { return this.client.brand.findUnique({ where: { id: brandId }, select: { id: true, isActive: true } }); }
  findById(sizeGuideId: string): Promise<SizeGuideRecord | null> { return this.client.sizeGuide.findUnique({ where: { id: sizeGuideId }, select: sizeGuideSelect }); }
  findDetail(sizeGuideId: string): Promise<SizeGuideDetailRecord | null> {
    return this.client.sizeGuide.findUnique({ where: { id: sizeGuideId }, select: {
      ...sizeGuideSelect, brand: { select: { id: true, name: true, isActive: true } },
      entries: { orderBy: [{ sortOrder: "asc" }, { id: "asc" }], select: sizeGuideEntrySelect },
    } });
  }
  create(input: CreateSizeGuideInput, actorId?: string): Promise<SizeGuideRecord> {
    const { entries, ...guide } = input;
    if (entries === undefined) return this.client.sizeGuide.create({ data: guide, select: sizeGuideSelect });
    return this.client.$transaction(async (tx) => {
      const created = await tx.sizeGuide.create({ data: guide, select: sizeGuideSelect });
      if (entries.length) await tx.sizeGuideEntry.createMany({ data: entries.map((entry) => ({ ...entry, sizeGuideId: created.id })) });
      if (actorId) await new AuditLogService().record({ actorUserId: actorId, action: "SIZE_GUIDE_CREATE", entityType: "SIZE_GUIDE", entityId: created.id }, tx);
      return created;
    }, { isolationLevel: "Serializable" });
  }
  async update(sizeGuideId: string, input: UpdateSizeGuideInput): Promise<SizeGuideRecord | null> {
    const { entries: _entries, ...guide } = input;
    const result = await this.client.sizeGuide.updateMany({ where: { id: sizeGuideId }, data: guide });
    return result.count === 1 ? this.findById(sizeGuideId) : null;
  }
  updateAggregate(sizeGuideId: string, input: UpdateSizeGuideInput, actorId?: string): Promise<SizeGuideRecord | null> {
    const { entries, ...guide } = input;
    return this.client.$transaction(async (tx) => {
      const current = await tx.sizeGuide.findUnique({ where: { id: sizeGuideId }, select: { id: true } });
      if (!current) return null;
      if (Object.keys(guide).length) await tx.sizeGuide.update({ where: { id: sizeGuideId }, data: guide });
      if (entries) {
        const seen = new Set<string>();
        for (const item of entries.upsert) {
          if (item.id) {
            if (seen.has(item.id)) throw new AppError(422, "Duplicate entry ID", "SIZE_GUIDE_ENTRY_DUPLICATE");
            seen.add(item.id);
            const found = await tx.sizeGuideEntry.findFirst({ where: { id: item.id, sizeGuideId } });
            if (!found) throw new AppError(404, "Size guide entry not found", "SIZE_GUIDE_ENTRY_NOT_FOUND");
            const { id, ...changes } = item;
            const merged = { euSize: found.euSize, usSize: found.usSize, ukSize: found.ukSize, footLengthCm: found.footLengthCm, ...changes };
            if (!merged.euSize && !merged.usSize && !merged.ukSize && !merged.footLengthCm) throw new AppError(422, "At least one size measurement is required", "SIZE_GUIDE_ENTRY_EMPTY");
            await tx.sizeGuideEntry.update({ where: { id }, data: changes });
          } else await tx.sizeGuideEntry.create({ data: { ...item, sizeGuideId } });
        }
        if (entries.deleteIds.some((id) => seen.has(id))) throw new AppError(422, "Entry cannot be updated and deleted", "SIZE_GUIDE_ENTRY_CONFLICT");
        const deleted = await tx.sizeGuideEntry.deleteMany({ where: { sizeGuideId, id: { in: entries.deleteIds } } });
        if (deleted.count !== entries.deleteIds.length) throw new AppError(404, "Size guide entry not found", "SIZE_GUIDE_ENTRY_NOT_FOUND");
      }
      if (actorId) await new AuditLogService().record({ actorUserId: actorId, action: "SIZE_GUIDE_UPDATE", entityType: "SIZE_GUIDE", entityId: sizeGuideId }, tx);
      return tx.sizeGuide.findUniqueOrThrow({ where: { id: sizeGuideId }, select: sizeGuideSelect });
    }, { isolationLevel: "Serializable" });
  }
  findEntry(sizeGuideId: string, entryId: string): Promise<SizeGuideEntryRecord | null> { return this.client.sizeGuideEntry.findFirst({ where: { id: entryId, sizeGuideId }, select: sizeGuideEntrySelect }); }
  createEntry(sizeGuideId: string, input: CreateSizeGuideEntryInput): Promise<SizeGuideEntryRecord> { return this.client.sizeGuideEntry.create({ data: { ...input, sizeGuideId }, select: sizeGuideEntrySelect }); }
  async updateEntry(sizeGuideId: string, entryId: string, input: UpdateSizeGuideEntryInput): Promise<SizeGuideEntryRecord | null> {
    const result = await this.client.sizeGuideEntry.updateMany({ where: { id: entryId, sizeGuideId }, data: input });
    return result.count === 1 ? this.findEntry(sizeGuideId, entryId) : null;
  }
  async deleteEntry(sizeGuideId: string, entryId: string): Promise<boolean> { return (await this.client.sizeGuideEntry.deleteMany({ where: { id: entryId, sizeGuideId } })).count === 1; }
  deleteIfUnused(sizeGuideId: string): Promise<"DELETED" | "IN_USE" | "NOT_FOUND"> {
    return this.client.$transaction(async (transaction) => {
      if (!await transaction.sizeGuide.findUnique({ where: { id: sizeGuideId }, select: { id: true } })) return "NOT_FOUND";
      if (await transaction.product.count({ where: { sizeGuideId } })) return "IN_USE";
      await transaction.sizeGuide.delete({ where: { id: sizeGuideId } });
      return "DELETED";
    }, { isolationLevel: "Serializable" });
  }
}
