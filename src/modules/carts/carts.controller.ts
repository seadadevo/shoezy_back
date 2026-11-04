import type { NextFunction, Request, Response } from "express";
import { AppError } from "../../common/errors/app-error";
import { ok } from "../../common/utils/api-response";
import { CartsService } from "./carts.service";
import type { AddCartItemInput, SetCartDiscountCodeInput, UpdateCartItemInput } from "./carts.validation";

function context(request: Request) {
  if (!request.auth || !request.validated) throw new AppError(500, "Request context missing", "REQUEST_CONTEXT_MISSING");
  return { userId: request.auth.userId, validated: request.validated };
}

export class CartsController {
  constructor(private readonly service = new CartsService()) {}
  get = async (request: Request, response: Response, next: NextFunction) => { try { const value = context(request); response.json(ok(await this.service.get(value.userId))); } catch (error: unknown) { next(error); } };
  addItem = async (request: Request, response: Response, next: NextFunction) => { try { const value = context(request); response.status(201).json(ok(await this.service.addItem(value.userId, value.validated.body as AddCartItemInput))); } catch (error: unknown) { next(error); } };
  updateItem = async (request: Request, response: Response, next: NextFunction) => { try { const value = context(request); const itemId = (value.validated.params as { cartItemId: string }).cartItemId; response.json(ok(await this.service.updateItem(value.userId, itemId, value.validated.body as UpdateCartItemInput))); } catch (error: unknown) { next(error); } };
  deleteItem = async (request: Request, response: Response, next: NextFunction) => { try { const value = context(request); const itemId = (value.validated.params as { cartItemId: string }).cartItemId; response.json(ok(await this.service.deleteItem(value.userId, itemId))); } catch (error: unknown) { next(error); } };
  clear = async (request: Request, response: Response, next: NextFunction) => { try { const value = context(request); await this.service.clear(value.userId); response.status(204).send(); } catch (error: unknown) { next(error); } };
  setDiscountCode = async (request: Request, response: Response, next: NextFunction) => { try { const value = context(request); response.json(ok(await this.service.setDiscountCode(value.userId, value.validated.body as SetCartDiscountCodeInput))); } catch (error: unknown) { next(error); } };
  removeDiscountCode = async (request: Request, response: Response, next: NextFunction) => { try { const value = context(request); response.json(ok(await this.service.removeDiscountCode(value.userId))); } catch (error: unknown) { next(error); } };
}
