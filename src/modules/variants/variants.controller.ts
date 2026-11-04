import type { NextFunction, Request, Response } from "express";
import { AppError } from "../../common/errors/app-error";
import { ok } from "../../common/utils/api-response";
import { VariantsService } from "./variants.service";
import type { CreateVariantInput, ListVariantsQuery, UpdateStockInput, UpdateVariantInput } from "./variants.validation";
function data(request: Request) { if (!request.validated) throw new AppError(500, "Validation context missing", "VALIDATION_CONTEXT_MISSING"); return request.validated; }
function ids(request: Request) { return data(request).params as { productId: string; variantId?: string }; }
export class VariantsController {
  constructor(private readonly service = new VariantsService()) {}
  list = async (r: Request, s: Response, n: NextFunction) => { try { s.json(ok(await this.service.list(ids(r).productId, data(r).query as ListVariantsQuery))); } catch (e: unknown) { n(e); } };
  get = async (r: Request, s: Response, n: NextFunction) => { try { s.json(ok(await this.service.get(ids(r).productId, ids(r).variantId!))); } catch (e: unknown) { n(e); } };
  create = async (r: Request, s: Response, n: NextFunction) => { try { s.status(201).json(ok(await this.service.create(ids(r).productId, data(r).body as CreateVariantInput, r.auth!.userId))); } catch (e: unknown) { n(e); } };
  update = async (r: Request, s: Response, n: NextFunction) => { try { s.json(ok(await this.service.update(ids(r).productId, ids(r).variantId!, data(r).body as UpdateVariantInput))); } catch (e: unknown) { n(e); } };
  delete = async (r: Request, s: Response, n: NextFunction) => { try { await this.service.delete(ids(r).productId, ids(r).variantId!); s.status(204).send(); } catch (e: unknown) { n(e); } };
  stock = async (r: Request, s: Response, n: NextFunction) => { try { const value = await this.service.stock(ids(r).productId, ids(r).variantId!, data(r).body as UpdateStockInput, r.auth!.userId); s.locals.adminAuditRecorded = true; s.json(ok(value)); } catch (e: unknown) { n(e); } };
}
