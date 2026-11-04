import type { NextFunction, Request, Response } from "express";
import { AppError } from "../../common/errors/app-error";
import { ok } from "../../common/utils/api-response";
import { ProductMediaService } from "./product-media.service";
import type {
  CreateProductMediaInput,
  ListProductMediaQuery,
  UpdateProductMediaInput,
} from "./product-media.validation";

function validated(request: Request) {
  if (!request.validated) {
    throw new AppError(500, "Validated request data is unavailable", "VALIDATION_CONTEXT_MISSING");
  }
  return request.validated;
}

function ids(request: Request): { productId: string; mediaId?: string } {
  return validated(request).params as { productId: string; mediaId?: string };
}

export class ProductMediaController {
  constructor(private readonly service = new ProductMediaService()) {}

  list = async (request: Request, response: Response, next: NextFunction) => {
    try {
      response.json(ok(await this.service.list(ids(request).productId, validated(request).query as ListProductMediaQuery)));
    } catch (error: unknown) { next(error); }
  };

  create = async (request: Request, response: Response, next: NextFunction) => {
    try {
      response.status(201).json(ok(await this.service.create(ids(request).productId, validated(request).body as CreateProductMediaInput)));
    } catch (error: unknown) { next(error); }
  };

  update = async (request: Request, response: Response, next: NextFunction) => {
    try {
      const { productId, mediaId } = ids(request);
      if (!mediaId) throw new AppError(500, "Media identifier missing", "VALIDATION_CONTEXT_MISSING");
      response.json(ok(await this.service.update(productId, mediaId, validated(request).body as UpdateProductMediaInput)));
    } catch (error: unknown) { next(error); }
  };

  delete = async (request: Request, response: Response, next: NextFunction) => {
    try {
      const { productId, mediaId } = ids(request);
      if (!mediaId) throw new AppError(500, "Media identifier missing", "VALIDATION_CONTEXT_MISSING");
      await this.service.delete(productId, mediaId);
      response.status(204).send();
    } catch (error: unknown) { next(error); }
  };
}
