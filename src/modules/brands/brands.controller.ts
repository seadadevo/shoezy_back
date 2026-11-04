import type { NextFunction, Request, Response } from "express";
import { AppError } from "../../common/errors/app-error";
import { ok } from "../../common/utils/api-response";
import { BrandsService } from "./brands.service";
import type { CreateBrandInput, ListBrandsQuery, UpdateBrandInput } from "./brands.validation";

function validated(request: Request) {
  if (!request.validated) throw new AppError(500, "Validated request data is unavailable", "VALIDATION_CONTEXT_MISSING");
  return request.validated;
}
function brandId(request: Request) { return (validated(request).params as { brandId: string }).brandId; }
function uploadFiles(request: Request) {
  const files = request.files as Record<string, Express.Multer.File[]> | undefined;
  return { logo: files?.image?.[0], showcase: files?.showcaseImage?.[0] };
}

export class BrandsController {
  constructor(private readonly service = new BrandsService()) {}
  list = async (request: Request, response: Response, next: NextFunction) => {
    try { response.json(ok(await this.service.list(validated(request).query as ListBrandsQuery))); } catch (error: unknown) { next(error); }
  };
  get = async (request: Request, response: Response, next: NextFunction) => {
    try { response.json(ok(await this.service.get(brandId(request)))); } catch (error: unknown) { next(error); }
  };
  create = async (request: Request, response: Response, next: NextFunction) => {
    try {
      const files = uploadFiles(request);
      const result = files.showcase
        ? await this.service.create(validated(request).body as CreateBrandInput, files.logo, files.showcase)
        : await this.service.create(validated(request).body as CreateBrandInput, files.logo);
      response.status(201).json(ok(result));
    } catch (error: unknown) { next(error); }
  };
  update = async (request: Request, response: Response, next: NextFunction) => {
    try {
      const files = uploadFiles(request);
      const result = files.showcase
        ? await this.service.update(brandId(request), validated(request).body as UpdateBrandInput, files.logo, files.showcase)
        : await this.service.update(brandId(request), validated(request).body as UpdateBrandInput, files.logo);
      response.json(ok(result));
    } catch (error: unknown) { next(error); }
  };
  delete = async (request: Request, response: Response, next: NextFunction) => {
    try { await this.service.delete(brandId(request)); response.status(204).send(); } catch (error: unknown) { next(error); }
  };
}
