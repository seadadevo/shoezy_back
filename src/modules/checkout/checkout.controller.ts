import type { NextFunction, Request, Response } from "express";
import { AppError } from "../../common/errors/app-error";
import { ok } from "../../common/utils/api-response";
import { CheckoutService } from "./checkout.service";
import type { CheckoutPreviewInput } from "./checkout.validation";
export class CheckoutController {
  constructor(private readonly service = new CheckoutService()) {}
  preview = async (request: Request, response: Response, next: NextFunction) => {
    try {
      if (!request.auth || !request.validated) throw new AppError(500, "Request context missing", "REQUEST_CONTEXT_MISSING");
      response.json(ok(await this.service.preview(request.auth.userId, request.validated.body as CheckoutPreviewInput)));
    } catch (error: unknown) { next(error); }
  };
}
