import type { PrismaClient } from "@prisma/client";
import { prisma } from "../../config/database";
import type { UpdateStoreSettingsInput } from "./store-settings.validation";
import { AuditLogService } from "../admin-audit/audit-log.service";

export class StoreSettingsRepository {
  constructor(private readonly client: PrismaClient = prisma) {}
  get() { return this.client.storeSettings.findUnique({ where: { id: 1 } }); }
  update(input: UpdateStoreSettingsInput, actorId?: string) {
    if (!actorId) return this.client.storeSettings.upsert({ where: { id: 1 }, create: { id: 1, ...input }, update: input });
    return this.client.$transaction(async (tx) => {
      const value = await tx.storeSettings.upsert({ where: { id: 1 }, create: { id: 1, ...input }, update: input });
      await new AuditLogService().record({ actorUserId: actorId, action: "STORE_SETTINGS_UPDATE", entityType: "STORE_SETTINGS", entityId: "1" }, tx);
      return value;
    });
  }
}
