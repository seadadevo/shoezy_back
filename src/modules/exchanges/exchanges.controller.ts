import type { NextFunction, Request, Response } from "express";
import { AppError } from "../../common/errors/app-error";
import { ok } from "../../common/utils/api-response";
import { ExchangesService } from "./exchanges.service";
import type { CreateExchangeInput, ListAdminExchangesQuery, ListOwnExchangesQuery } from "./exchanges.validation";
function ctx(r: Request) { if (!r.auth || !r.validated) throw new AppError(500, "Request context missing", "REQUEST_CONTEXT_MISSING"); return { userId: r.auth.userId, v: r.validated }; }
export class ExchangesController {
  constructor(private readonly service = new ExchangesService()) {}
  create = async (r: Request, s: Response, n: NextFunction) => { try { const x = ctx(r); s.status(201).json(ok(await this.service.create(x.userId, (x.v.params as { orderId: string }).orderId, x.v.body as CreateExchangeInput))); } catch (e: unknown) { n(e); } };
  listOwn = async (r: Request, s: Response, n: NextFunction) => { try { const x = ctx(r); s.json(ok(await this.service.listOwn(x.userId, x.v.query as ListOwnExchangesQuery))); } catch (e: unknown) { n(e); } };
  getOwn = async (r: Request, s: Response, n: NextFunction) => { try { const x = ctx(r); s.json(ok(await this.service.getOwn(x.userId, (x.v.params as { exchangeId: string }).exchangeId))); } catch (e: unknown) { n(e); } };
  listAny = async (r: Request, s: Response, n: NextFunction) => { try { const x = ctx(r); s.json(ok(await this.service.listAny(x.v.query as ListAdminExchangesQuery))); } catch (e: unknown) { n(e); } };
  getAny = async (r: Request, s: Response, n: NextFunction) => { try { const x = ctx(r); s.json(ok(await this.service.getAny((x.v.params as { exchangeId: string }).exchangeId))); } catch (e: unknown) { n(e); } };
  decide = async (r: Request, s: Response, n: NextFunction) => { try { const x = ctx(r); const value = await this.service.decide((x.v.params as { exchangeId: string }).exchangeId, (x.v.body as { status: "APPROVED" | "REJECTED" }).status, new Date(), x.userId); s.locals.adminAuditRecorded = true; s.json(ok(value)); } catch (e: unknown) { n(e); } };
  complete = async (r: Request, s: Response, n: NextFunction) => { try { const x = ctx(r); const value = await this.service.complete(x.userId, (x.v.params as { exchangeId: string }).exchangeId); s.locals.adminAuditRecorded = true; s.json(ok(value)); } catch (e: unknown) { n(e); } };
}
