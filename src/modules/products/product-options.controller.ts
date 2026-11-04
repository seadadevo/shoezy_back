import type { NextFunction, Request, Response } from "express";
import { AppError } from "../../common/errors/app-error";
import { ok } from "../../common/utils/api-response";
import { ProductOptionsService } from "./product-options.service";
import type { CreateOptionInput, CreateOptionValueInput, UpdateOptionInput, UpdateOptionValueInput } from "./product-options.validation";
function data(request: Request) { if (!request.validated) throw new AppError(500, "Validation context missing", "VALIDATION_CONTEXT_MISSING"); return request.validated; }
function ids(request: Request) { return data(request).params as { productId: string; optionId?: string; valueId?: string }; }
export class ProductOptionsController {
  constructor(private readonly service = new ProductOptionsService()) {}
  list = async (r: Request, s: Response, n: NextFunction) => { try { s.json(ok(await this.service.list(ids(r).productId))); } catch (e: unknown) { n(e); } };
  create = async (r: Request, s: Response, n: NextFunction) => { try { s.status(201).json(ok(await this.service.create(ids(r).productId, data(r).body as CreateOptionInput))); } catch (e: unknown) { n(e); } };
  update = async (r: Request, s: Response, n: NextFunction) => { try { s.json(ok(await this.service.update(ids(r).productId, ids(r).optionId!, data(r).body as UpdateOptionInput))); } catch (e: unknown) { n(e); } };
  delete = async (r: Request, s: Response, n: NextFunction) => { try { await this.service.delete(ids(r).productId, ids(r).optionId!); s.status(204).send(); } catch (e: unknown) { n(e); } };
  createValue = async (r: Request, s: Response, n: NextFunction) => { try { s.status(201).json(ok(await this.service.createValue(ids(r).productId, ids(r).optionId!, data(r).body as CreateOptionValueInput))); } catch (e: unknown) { n(e); } };
  updateValue = async (r: Request, s: Response, n: NextFunction) => { try { s.json(ok(await this.service.updateValue(ids(r).productId, ids(r).optionId!, ids(r).valueId!, data(r).body as UpdateOptionValueInput))); } catch (e: unknown) { n(e); } };
  deleteValue = async (r: Request, s: Response, n: NextFunction) => { try { await this.service.deleteValue(ids(r).productId, ids(r).optionId!, ids(r).valueId!); s.status(204).send(); } catch (e: unknown) { n(e); } };
}
