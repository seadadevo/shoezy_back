import type { NextFunction, Request, Response } from "express";
import { AppError } from "../../common/errors/app-error";
import { ok } from "../../common/utils/api-response";
import { DiscountsService } from "./discounts.service";
import type { CreateDiscountInput, ListDiscountsQuery, ReplaceDiscountTargetsInput, UpdateDiscountInput } from "./discounts.validation";
function validated(request: Request) { if (!request.validated) throw new AppError(500, "Validation context missing", "VALIDATION_CONTEXT_MISSING"); return request.validated; }
function id(request: Request) { return (validated(request).params as { discountId: string }).discountId; }
export class DiscountsController {
  constructor(private readonly service = new DiscountsService()) {}
  list = async (request: Request, response: Response, next: NextFunction) => { try { response.json(ok(await this.service.list(validated(request).query as ListDiscountsQuery))); } catch (error: unknown) { next(error); } };
  get = async (request: Request, response: Response, next: NextFunction) => { try { response.json(ok(await this.service.get(id(request)))); } catch (error: unknown) { next(error); } };
  create = async (request: Request, response: Response, next: NextFunction) => { try { response.status(201).json(ok(await this.service.create(validated(request).body as CreateDiscountInput, request.file))); } catch (error: unknown) { next(error); } };
  update = async (request: Request, response: Response, next: NextFunction) => { try { response.json(ok(await this.service.update(id(request), validated(request).body as UpdateDiscountInput, request.file))); } catch (error: unknown) { next(error); } };
  replaceTargets = async (request: Request, response: Response, next: NextFunction) => { try { response.json(ok(await this.service.replaceTargets(id(request), validated(request).body as ReplaceDiscountTargetsInput))); } catch (error: unknown) { next(error); } };
  activate = async (request: Request, response: Response, next: NextFunction) => { try { response.json(ok(await this.service.setActive(id(request), true))); } catch (error: unknown) { next(error); } };
  deactivate = async (request: Request, response: Response, next: NextFunction) => { try { response.json(ok(await this.service.setActive(id(request), false))); } catch (error: unknown) { next(error); } };
  archive = async (request: Request, response: Response, next: NextFunction) => { try { response.json(ok(await this.service.archive(id(request)))); } catch (error: unknown) { next(error); } };
  statistics = async (request: Request, response: Response, next: NextFunction) => { try { response.json(ok(await this.service.statistics(id(request)))); } catch (error: unknown) { next(error); } };
  delete = async (request: Request, response: Response, next: NextFunction) => { try { await this.service.delete(id(request)); response.status(204).send(); } catch (error: unknown) { next(error); } };
}
