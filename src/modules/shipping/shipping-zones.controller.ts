import type { NextFunction, Request, Response } from "express";
import { ok } from "../../common/utils/api-response";
import { ShippingZonesService } from "./shipping-zones.service";
import type { CreateZoneAreaInput, CreateZoneInput, ListZonesQuery, UpdateZoneAreaInput, UpdateZoneInput, UpsertZoneRateInput } from "./shipping-zones.validation";

export class ShippingZonesController {
  constructor(private readonly service = new ShippingZonesService()) {}
  private handle(fn: (request: Request) => Promise<unknown>, status = 200, auditedInTransaction = false) { return async (request: Request, response: Response, next: NextFunction) => { try { const result = await fn(request); if (auditedInTransaction) response.locals.adminAuditRecorded = true; if (status === 204) response.status(204).send(); else response.status(status).json(ok(result)); } catch (error: unknown) { next(error); } }; }
  list = this.handle((r) => this.service.list(r.validated!.query as ListZonesQuery));
  formContext = this.handle(() => this.service.formContext());
  get = this.handle((r) => this.service.get((r.validated!.params as { zoneId: string }).zoneId));
  create = async (r: Request, s: Response, n: NextFunction) => { try { const input = r.validated!.body as CreateZoneInput; const aggregate = input.areas !== undefined || input.rates !== undefined; const result = await this.service.create(input, aggregate ? r.auth?.userId : undefined); if (aggregate) s.locals.adminAuditRecorded = true; s.status(201).json(ok(result)); } catch (e: unknown) { n(e); } };
  update = async (r: Request, s: Response, n: NextFunction) => { try { const input = r.validated!.body as UpdateZoneInput; const aggregate = input.areas !== undefined || input.rates !== undefined; const result = await this.service.update((r.validated!.params as { zoneId: string }).zoneId, input, aggregate ? r.auth?.userId : undefined); if (aggregate) s.locals.adminAuditRecorded = true; s.json(ok(result)); } catch (e: unknown) { n(e); } };
  delete = this.handle((r) => this.service.delete((r.validated!.params as { zoneId: string }).zoneId), 204);
  addArea = this.handle((r) => this.service.addArea((r.validated!.params as { zoneId: string }).zoneId, r.validated!.body as CreateZoneAreaInput), 201);
  updateArea = this.handle((r) => { const p = r.validated!.params as { zoneId: string; areaId: string }; return this.service.updateArea(p.zoneId, p.areaId, r.validated!.body as UpdateZoneAreaInput, r.auth!.userId); }, 200, true);
  deleteArea = this.handle((r) => { const p = r.validated!.params as { zoneId: string; areaId: string }; return this.service.deleteArea(p.zoneId, p.areaId); }, 204);
  upsertRate = this.handle((r) => { const p = r.validated!.params as { zoneId: string; shippingMethodId: string }; return this.service.upsertRate(p.zoneId, p.shippingMethodId, r.validated!.body as UpsertZoneRateInput, r.auth!.userId); }, 200, true);
  deleteRate = this.handle((r) => { const p = r.validated!.params as { zoneId: string; shippingMethodId: string }; return this.service.deleteRate(p.zoneId, p.shippingMethodId); }, 204);
}
