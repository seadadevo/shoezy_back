import type { NextFunction, Request, Response } from "express";
import { AppError } from "../../common/errors/app-error";
import { ok } from "../../common/utils/api-response";
import { ShippingService } from "./shipping.service";
import type { CreateShippingMethodInput, ListAdminShippingMethodsQuery, ListPublicShippingMethodsQuery, UpdateOrderShippingInput, UpdateShippingMethodInput } from "./shipping.validation";
function validated(request: Request) { if (!request.validated) throw new AppError(500, "Validated request context missing", "REQUEST_CONTEXT_MISSING"); return request.validated; }
export class ShippingController {
  constructor(private readonly service = new ShippingService()) {}
  listPublic = async (request: Request, response: Response, next: NextFunction) => { try { response.json(ok(await this.service.listPublic(validated(request).query as ListPublicShippingMethodsQuery))); } catch (error: unknown) { next(error); } };
  listAdmin = async (request: Request, response: Response, next: NextFunction) => { try { response.json(ok(await this.service.listAdmin(validated(request).query as ListAdminShippingMethodsQuery))); } catch (error: unknown) { next(error); } };
  getMethod = async (request: Request, response: Response, next: NextFunction) => { try { response.json(ok(await this.service.getMethod((validated(request).params as { shippingMethodId: string }).shippingMethodId))); } catch (error: unknown) { next(error); } };
  createMethod = async (request: Request, response: Response, next: NextFunction) => { try { response.status(201).json(ok(await this.service.createMethod(validated(request).body as CreateShippingMethodInput))); } catch (error: unknown) { next(error); } };
  updateMethod = async (request: Request, response: Response, next: NextFunction) => { try { const value = validated(request); response.json(ok(await this.service.updateMethod((value.params as { shippingMethodId: string }).shippingMethodId, value.body as UpdateShippingMethodInput))); } catch (error: unknown) { next(error); } };
  deleteMethod = async (request: Request, response: Response, next: NextFunction) => { try { await this.service.deleteMethod((validated(request).params as { shippingMethodId: string }).shippingMethodId); response.status(204).send(); } catch (error: unknown) { next(error); } };
  updateOrderShipping = async (request: Request, response: Response, next: NextFunction) => { try { const value = validated(request); response.json(ok(await this.service.updateOrderShipping((value.params as { orderId: string }).orderId, value.body as UpdateOrderShippingInput))); } catch (error: unknown) { next(error); } };
  getOwnShipment = async (request: Request, response: Response, next: NextFunction) => { try { if (!request.auth) throw new AppError(500, "Auth context missing", "REQUEST_CONTEXT_MISSING"); response.json(ok(await this.service.getOwnShipment(request.auth.userId, (validated(request).params as { orderId: string }).orderId))); } catch (error: unknown) { next(error); } };
}
