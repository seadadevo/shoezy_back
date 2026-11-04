import { Prisma, type PrismaClient } from "@prisma/client";
import { prisma } from "../../config/database";
import type { ListAuditLogsQuery } from "./audit-log.validation";

export type AuditEvent = {
  actorUserId: string;
  action: string;
  entityType: string;
  entityId?: string | null;
  metadata?: { status?: { from: string; to: string }; stock?: { from: number; to: number }; categoriesChanged?: boolean; optionsChanged?: boolean; variantsCreated?: number; mediaAdded?: number };
  ipAddress?: string | null;
  userAgent?: string | null;
};

export class AuditLogService {
  constructor(private readonly client: PrismaClient = prisma) {}
  record(event: AuditEvent, transaction?: Prisma.TransactionClient) {
    const db = transaction ?? this.client;
    const status = event.metadata?.status;
    const stock = event.metadata?.stock;
    const safeMetadata = {
      ...(status && /^[A-Z_]+$/.test(status.from) && /^[A-Z_]+$/.test(status.to) ? { status: { from: status.from, to: status.to } } : {}),
      ...(stock && Number.isSafeInteger(stock.from) && Number.isSafeInteger(stock.to) ? { stock: { from: stock.from, to: stock.to } } : {}),
      ...(typeof event.metadata?.categoriesChanged === "boolean" ? { categoriesChanged: event.metadata.categoriesChanged } : {}),
      ...(typeof event.metadata?.optionsChanged === "boolean" ? { optionsChanged: event.metadata.optionsChanged } : {}),
      ...(Number.isSafeInteger(event.metadata?.variantsCreated) && (event.metadata?.variantsCreated ?? -1) >= 0 ? { variantsCreated: event.metadata!.variantsCreated } : {}),
      ...(Number.isSafeInteger(event.metadata?.mediaAdded) && (event.metadata?.mediaAdded ?? -1) >= 0 ? { mediaAdded: event.metadata!.mediaAdded } : {}),
    };
    return db.adminAuditLog.create({ data: {
      actorUserId: event.actorUserId,
      action: event.action,
      entityType: event.entityType,
      entityId: event.entityId ?? null,
      metadata: Object.keys(safeMetadata).length ? safeMetadata : Prisma.JsonNull,
      ipAddress: event.ipAddress?.slice(0, 64) ?? null,
      userAgent: event.userAgent?.slice(0, 512) ?? null,
    } });
  }
  async list(query: ListAuditLogsQuery) {
    const where: Prisma.AdminAuditLogWhereInput = {
      actorUserId: query.actorUserId,
      action: query.action,
      entityType: query.entityType,
      entityId: query.entityId,
      createdAt: query.from || query.to ? { gte: query.from, lte: query.to } : undefined,
    };
    const [items, total] = await this.client.$transaction([
      this.client.adminAuditLog.findMany({ where, skip: (query.page - 1) * query.limit, take: query.limit, orderBy: [{ createdAt: "desc" }, { id: "desc" }], select: {
        id: true, actorUserId: true, action: true, entityType: true, entityId: true, metadata: true, ipAddress: true, userAgent: true, createdAt: true,
        actor: { select: { id: true, firstName: true, lastName: true, email: true } },
      } }),
      this.client.adminAuditLog.count({ where }),
    ]);
    return { items, pagination: { page: query.page, limit: query.limit, total, totalPages: Math.ceil(total / query.limit) } };
  }
}
