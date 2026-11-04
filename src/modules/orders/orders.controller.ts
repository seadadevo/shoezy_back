import type { NextFunction, Request, Response } from "express";
import { AppError } from "../../common/errors/app-error";
import { ok } from "../../common/utils/api-response";
import { OrdersService } from "./orders.service";
import type { CreateOrderInput, ListAdminOrdersQuery, ListOwnOrdersQuery, OrderTransitionInput, ShipOrderInput } from "./orders.validation";
function context(request: Request) {
  if (!request.auth || !request.validated) throw new AppError(500, "Request context missing", "REQUEST_CONTEXT_MISSING");
  return { userId: request.auth.userId, validated: request.validated };
}
export class OrdersController {
  constructor(private readonly service = new OrdersService()) {}
  place = async (request: Request, response: Response, next: NextFunction) => { try { const value = context(request); if (!request.idempotencyKey) throw new AppError(500, "Idempotency context missing", "REQUEST_CONTEXT_MISSING"); const result = await this.service.place(value.userId, request.idempotencyKey, value.validated.body as CreateOrderInput); response.status(result.idempotentReplay ? 200 : 201).json(ok(result)); } catch (error: unknown) { next(error); } };
  listOwn = async (request: Request, response: Response, next: NextFunction) => { try { const value = context(request); response.json(ok(await this.service.listOwn(value.userId, value.validated.query as ListOwnOrdersQuery))); } catch (error: unknown) { next(error); } };
  getOwn = async (request: Request, response: Response, next: NextFunction) => { try { const value = context(request); response.json(ok(await this.service.getOwn(value.userId, (value.validated.params as { orderId: string }).orderId))); } catch (error: unknown) { next(error); } };
  cancelOwn = async (request: Request, response: Response, next: NextFunction) => { try { const value = context(request); response.json(ok(await this.service.cancelOwn(value.userId, (value.validated.params as { orderId: string }).orderId, value.validated.body as OrderTransitionInput))); } catch (error: unknown) { next(error); } };
  listAny = async (request: Request, response: Response, next: NextFunction) => { try { const value = context(request); response.json(ok(await this.service.listAny(value.validated.query as ListAdminOrdersQuery))); } catch (error: unknown) { next(error); } };
  getAny = async (request: Request, response: Response, next: NextFunction) => { try { const value = context(request); response.json(ok(await this.service.getAny((value.validated.params as { orderId: string }).orderId))); } catch (error: unknown) { next(error); } };
  confirmAny = this.adminTransition("confirmAny");
  cancelAny = this.adminTransition("cancelAny");
  shipAny = async (request: Request, response: Response, next: NextFunction) => { try { const value = context(request); const orderId = (value.validated.params as { orderId: string }).orderId; const result = await this.service.shipAny(value.userId, orderId, value.validated.body as ShipOrderInput); response.locals.adminAuditRecorded = true; response.json(ok(result)); } catch (error: unknown) { next(error); } };
  deliverAny = this.adminTransition("deliverAny");
  private adminTransition(method: "confirmAny" | "cancelAny" | "deliverAny") {
    return async (request: Request, response: Response, next: NextFunction) => { try { const value = context(request); const orderId = (value.validated.params as { orderId: string }).orderId; const result = await this.service[method](value.userId, orderId, value.validated.body as OrderTransitionInput); response.locals.adminAuditRecorded = true; response.json(ok(result)); } catch (error: unknown) { next(error); } };
  }
}
