import type { NextFunction, Request, Response } from "express";
import { AppError } from "../../common/errors/app-error";
import { ok } from "../../common/utils/api-response";
import { CollectionsService } from "./collections.service";
import type {
  CreateCollectionInput,
  ListCollectionsQuery,
  ReplaceCollectionProductsInput,
  UpdateCollectionInput,
} from "./collections.validation";

function validated(request: Request) {
  if (!request.validated) throw new AppError(500, "Validation context missing", "VALIDATION_CONTEXT_MISSING");
  return request.validated;
}
function collectionId(request: Request) {
  return (validated(request).params as { collectionId: string }).collectionId;
}
function uploads(request: Request) {
  const files = request.files as Record<string, Express.Multer.File[]> | undefined;
  return { image: files?.image?.[0], video: files?.video?.[0] };
}

export class CollectionsController {
  constructor(private readonly service = new CollectionsService()) {}
  list = async (request: Request, response: Response, next: NextFunction) => {
    try { response.json(ok(await this.service.list(validated(request).query as ListCollectionsQuery))); }
    catch (error: unknown) { next(error); }
  };
  get = async (request: Request, response: Response, next: NextFunction) => {
    try { response.json(ok(await this.service.get(collectionId(request)))); }
    catch (error: unknown) { next(error); }
  };
  create = async (request: Request, response: Response, next: NextFunction) => {
    try { const input = validated(request).body as CreateCollectionInput; const actorId = input.products === undefined ? undefined : request.auth?.userId; const { image, video } = uploads(request); const result = await (video ? this.service.create(input, actorId, image, video) : this.service.create(input, actorId, image)); if (input.products !== undefined) response.locals.adminAuditRecorded = true; response.status(201).json(ok(result)); }
    catch (error: unknown) { next(error); }
  };
  update = async (request: Request, response: Response, next: NextFunction) => {
    try { const input = validated(request).body as UpdateCollectionInput; const actorId = input.products === undefined ? undefined : request.auth?.userId; const { image, video } = uploads(request); const result = await (video ? this.service.update(collectionId(request), input, actorId, image, video) : this.service.update(collectionId(request), input, actorId, image)); if (input.products !== undefined) response.locals.adminAuditRecorded = true; response.json(ok(result)); }
    catch (error: unknown) { next(error); }
  };
  replaceProducts = async (request: Request, response: Response, next: NextFunction) => {
    try { response.json(ok(await this.service.replaceProducts(collectionId(request), validated(request).body as ReplaceCollectionProductsInput))); }
    catch (error: unknown) { next(error); }
  };
  delete = async (request: Request, response: Response, next: NextFunction) => {
    try { await this.service.delete(collectionId(request)); response.status(204).send(); }
    catch (error: unknown) { next(error); }
  };
}
