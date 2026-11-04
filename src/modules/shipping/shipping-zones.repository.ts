import type { Prisma, PrismaClient } from "@prisma/client";
import { prisma } from "../../config/database";
import { AppError } from "../../common/errors/app-error";
import { isSerializableTransactionConflict } from "../../common/utils/prisma-transaction";
import { locationKey } from "./shipping-zone-pricing";
import type { CreateZoneAreaInput, CreateZoneInput, ListZonesQuery, UpdateZoneAreaInput, UpdateZoneInput, UpsertZoneRateInput } from "./shipping-zones.validation";
import { AuditLogService } from "../admin-audit/audit-log.service";

const detail = { areas: { orderBy: { stateKey: "asc" as const } }, rates: { orderBy: { shippingMethodId: "asc" as const } } };
export class ShippingZonesRepository {
  constructor(private readonly client: PrismaClient = prisma) {}
  private async serializable<T>(work: (tx: Prisma.TransactionClient) => Promise<T>) { for (let attempt = 1; attempt <= 3; attempt += 1) { try { return await this.client.$transaction(work, { isolationLevel: "Serializable" }); } catch (error: unknown) { if (!isSerializableTransactionConflict(error) || attempt === 3) throw error; } } throw new Error("Serializable retry exhausted"); }
  formContext() { return this.client.shippingMethod.findMany({ where: { currency: "TND", isActive: true }, select: { id: true, code: true, name: true }, orderBy: { name: "asc" } }); }
  private areaData(input: { state: string; city?: string | null; area?: string | null }) { return { countryCode: "TN", state: input.state, city: input.city ?? null, area: input.area ?? null, stateKey: locationKey(input.state), cityKey: locationKey(input.city), areaKey: locationKey(input.area) }; }
  private async putRate(tx: Prisma.TransactionClient, zoneId: string, input: NonNullable<CreateZoneInput["rates"]>[number]) {
    const method = await tx.shippingMethod.findUnique({ where: { id: input.shippingMethodId }, select: { currency: true } });
    if (!method) throw new AppError(404, "Shipping method not found", "SHIPPING_METHOD_NOT_FOUND");
    if (method.currency !== "TND") throw new AppError(409, "Shipping method currency must be TND", "SHIPPING_CURRENCY_MISMATCH");
    const current = await tx.shippingZoneRate.findUnique({ where: { zoneId_shippingMethodId: { zoneId, shippingMethodId: input.shippingMethodId } }, select: { estimatedMinDays: true, estimatedMaxDays: true } });
    const minimum = input.estimatedMinDays === undefined ? current?.estimatedMinDays ?? null : input.estimatedMinDays;
    const maximum = input.estimatedMaxDays === undefined ? current?.estimatedMaxDays ?? null : input.estimatedMaxDays;
    if (minimum !== null && maximum !== null && minimum > maximum) throw new AppError(422, "Invalid delivery estimate range", "SHIPPING_ESTIMATE_RANGE_INVALID");
    const { shippingMethodId, ...fields } = input;
    const data = { ...fields, priceMinor: BigInt(fields.priceMinor), currency: "TND" };
    await tx.shippingZoneRate.upsert({ where: { zoneId_shippingMethodId: { zoneId, shippingMethodId } }, create: { zoneId, shippingMethodId, ...data }, update: data });
  }
  async list(query: ListZonesQuery) {
    const [items, total] = await this.client.$transaction([
      this.client.shippingZone.findMany({ skip: (query.page - 1) * query.limit, take: query.limit, orderBy: [{ name: "asc" }, { id: "asc" }], include: detail }),
      this.client.shippingZone.count(),
    ]);
    return { items, total };
  }
  get(zoneId: string) { return this.client.shippingZone.findUnique({ where: { id: zoneId }, include: detail }); }
  create(input: CreateZoneInput, actorId?: string) {
    const { areas, rates, ...zone } = input;
    if (areas === undefined && rates === undefined) return this.client.shippingZone.create({ data: zone, include: detail });
    return this.serializable(async (tx) => {
      const created = await tx.shippingZone.create({ data: zone });
      if (areas?.length) await tx.shippingZoneArea.createMany({ data: areas.map((area) => ({ zoneId: created.id, ...this.areaData(area) })) });
      for (const rate of rates ?? []) await this.putRate(tx, created.id, rate);
      if (actorId) await new AuditLogService().record({ actorUserId: actorId, action: "SHIPPING_ZONE_CREATE", entityType: "SHIPPING_ZONE", entityId: created.id }, tx);
      return tx.shippingZone.findUniqueOrThrow({ where: { id: created.id }, include: detail });
    });
  }
  update(zoneId: string, input: UpdateZoneInput, actorId?: string) {
    const { areas, rates, ...zone } = input;
    if (areas === undefined && rates === undefined) return this.client.shippingZone.update({ where: { id: zoneId }, data: zone, include: detail });
    return this.serializable(async (tx) => {
      if (!await tx.shippingZone.findUnique({ where: { id: zoneId }, select: { id: true } })) throw new AppError(404, "Shipping zone not found", "SHIPPING_ZONE_NOT_FOUND");
      if (Object.keys(zone).length) await tx.shippingZone.update({ where: { id: zoneId }, data: zone });
      if (areas) {
        const ids = new Set<string>();
        for (const item of areas.upsert) {
          if (item.id) {
            if (ids.has(item.id)) throw new AppError(422, "Duplicate area ID", "SHIPPING_ZONE_AREA_DUPLICATE");
            ids.add(item.id);
            const current = await tx.shippingZoneArea.findFirst({ where: { id: item.id, zoneId } });
            if (!current) throw new AppError(404, "Shipping area not found", "SHIPPING_ZONE_AREA_NOT_FOUND");
            const state = item.state ?? current.state, city = item.city === undefined ? current.city : item.city, area = item.area === undefined ? current.area : item.area;
            if (area && !city) throw new AppError(422, "City is required when area is specified", "SHIPPING_ZONE_CITY_REQUIRED");
            await tx.shippingZoneArea.update({ where: { id: item.id }, data: this.areaData({ state, city, area }) });
          } else {
            if (!item.state) throw new AppError(422, "State is required", "SHIPPING_ZONE_STATE_REQUIRED");
            if (item.area && !item.city) throw new AppError(422, "City is required when area is specified", "SHIPPING_ZONE_CITY_REQUIRED");
            await tx.shippingZoneArea.create({ data: { zoneId, ...this.areaData({ state: item.state, city: item.city, area: item.area }) } });
          }
        }
        if (areas.deleteIds.some((id) => ids.has(id))) throw new AppError(422, "Area cannot be updated and deleted", "SHIPPING_ZONE_AREA_CONFLICT");
        const deleted = await tx.shippingZoneArea.deleteMany({ where: { zoneId, id: { in: areas.deleteIds } } });
        if (deleted.count !== areas.deleteIds.length) throw new AppError(404, "Shipping area not found", "SHIPPING_ZONE_AREA_NOT_FOUND");
      }
      if (rates) {
        const methodIds = rates.upsert.map((rate) => rate.shippingMethodId);
        if (new Set(methodIds).size !== methodIds.length || rates.deleteMethodIds.some((id) => methodIds.includes(id))) throw new AppError(422, "Conflicting shipping rates", "SHIPPING_ZONE_RATE_CONFLICT");
        for (const rate of rates.upsert) await this.putRate(tx, zoneId, rate);
        const deleted = await tx.shippingZoneRate.deleteMany({ where: { zoneId, shippingMethodId: { in: rates.deleteMethodIds } } });
        if (deleted.count !== rates.deleteMethodIds.length) throw new AppError(404, "Shipping rate not found", "SHIPPING_ZONE_RATE_NOT_FOUND");
      }
      if (actorId) await new AuditLogService().record({ actorUserId: actorId, action: "SHIPPING_ZONE_UPDATE", entityType: "SHIPPING_ZONE", entityId: zoneId }, tx);
      return tx.shippingZone.findUniqueOrThrow({ where: { id: zoneId }, include: detail });
    });
  }
  delete(zoneId: string) { return this.client.shippingZone.deleteMany({ where: { id: zoneId } }); }
  addArea(zoneId: string, input: CreateZoneAreaInput) {
    return this.client.shippingZoneArea.create({ data: { zoneId, countryCode: "TN", state: input.state, city: input.city ?? null, area: input.area ?? null, stateKey: locationKey(input.state), cityKey: locationKey(input.city), areaKey: locationKey(input.area) } });
  }
  updateArea(zoneId: string, areaId: string, input: UpdateZoneAreaInput, actorId?: string) {
    return this.client.$transaction(async (tx) => {
      const current = await tx.shippingZoneArea.findFirst({ where: { id: areaId, zoneId } });
      if (!current) return null;
      const state = input.state ?? current.state;
      const city = input.city === undefined ? current.city : input.city;
      const area = input.area === undefined ? current.area : input.area;
      if (area && !city) return "CITY_REQUIRED" as const;
      const value = await tx.shippingZoneArea.update({ where: { id: areaId }, data: { state, city, area, stateKey: locationKey(state), cityKey: locationKey(city), areaKey: locationKey(area) } });
      if (actorId) await new AuditLogService().record({ actorUserId: actorId, action: "SHIPPING_ZONE_AREA_UPDATE", entityType: "SHIPPING_ZONE_AREA", entityId: areaId }, tx);
      return value;
    });
  }
  deleteArea(zoneId: string, areaId: string) { return this.client.shippingZoneArea.deleteMany({ where: { id: areaId, zoneId } }); }
  async upsertRate(zoneId: string, shippingMethodId: string, input: UpsertZoneRateInput, actorId?: string) {
    return this.client.$transaction(async (tx) => {
      const [zone, method] = await Promise.all([tx.shippingZone.findUnique({ where: { id: zoneId }, select: { id: true } }), tx.shippingMethod.findUnique({ where: { id: shippingMethodId }, select: { currency: true } })]);
      if (!zone) return "ZONE_NOT_FOUND" as const;
      if (!method) return "METHOD_NOT_FOUND" as const;
      if (method.currency !== "TND") return "CURRENCY_MISMATCH" as const;
      const current = await tx.shippingZoneRate.findUnique({ where: { zoneId_shippingMethodId: { zoneId, shippingMethodId } }, select: { estimatedMinDays: true, estimatedMaxDays: true } });
      const minimum = input.estimatedMinDays === undefined ? current?.estimatedMinDays ?? null : input.estimatedMinDays;
      const maximum = input.estimatedMaxDays === undefined ? current?.estimatedMaxDays ?? null : input.estimatedMaxDays;
      if (minimum !== null && maximum !== null && minimum > maximum) return "ESTIMATE_RANGE_INVALID" as const;
      const data = { ...input, priceMinor: BigInt(input.priceMinor), currency: "TND" };
      const value = await tx.shippingZoneRate.upsert({ where: { zoneId_shippingMethodId: { zoneId, shippingMethodId } }, create: { zoneId, shippingMethodId, ...data }, update: data });
      if (actorId) await new AuditLogService().record({ actorUserId: actorId, action: current ? "SHIPPING_ZONE_RATE_UPDATE" : "SHIPPING_ZONE_RATE_CREATE", entityType: "SHIPPING_ZONE_RATE", entityId: value.id }, tx);
      return value;
    });
  }
  deleteRate(zoneId: string, shippingMethodId: string) { return this.client.shippingZoneRate.deleteMany({ where: { zoneId, shippingMethodId } }); }
}
