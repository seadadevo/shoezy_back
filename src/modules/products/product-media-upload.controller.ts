import type { NextFunction, Request, Response } from "express";
import { ok } from "../../common/utils/api-response";
import { ProductMediaUploadService } from "./product-media-upload.service";
import type { UploadProductMediaInput } from "./product-media-upload.validation";

export class ProductMediaUploadController {
  constructor(private readonly service = new ProductMediaUploadService()) {}
  upload = async (request: Request, response: Response, next: NextFunction) => {
    try {
      const { productId } = request.validated!.params as { productId: string };
      response.status(201).json(ok(await this.service.upload(productId, request.validated!.body as UploadProductMediaInput, request.file)));
    } catch (error: unknown) { next(error); }
  };
}
