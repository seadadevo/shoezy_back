import type { NextFunction, Request, Response } from "express";
import { AppError } from "../../common/errors/app-error";
import { ok } from "../../common/utils/api-response";
import { CategoriesService } from "./categories.service";
import type { CreateCategoryInput, ListCategoriesQuery, UpdateCategoryInput } from "./categories.validation";
function data(request: Request) { if (!request.validated) throw new AppError(500, "Validation context missing", "VALIDATION_CONTEXT_MISSING"); return request.validated; }
function id(request: Request) { return (data(request).params as { categoryId: string }).categoryId; }
function uploads(request: Request) {
  const files = request.files as Record<string, Express.Multer.File[]> | undefined;
  return { image: files?.image?.[0], video: files?.video?.[0] };
}
export class CategoriesController {
  constructor(private readonly service = new CategoriesService()) {}
  list = async (request: Request, response: Response, next: NextFunction) => { try { response.json(ok(await this.service.list(data(request).query as ListCategoriesQuery))); } catch (error: unknown) { next(error); } };
  tree = async (_request: Request, response: Response, next: NextFunction) => { try { response.json(ok(await this.service.tree())); } catch (error: unknown) { next(error); } };
  get = async (request: Request, response: Response, next: NextFunction) => { try { response.json(ok(await this.service.get(id(request)))); } catch (error: unknown) { next(error); } };
  create = async (request: Request, response: Response, next: NextFunction) => { try { const input = data(request).body as CreateCategoryInput; const { image, video } = uploads(request); response.status(201).json(ok(await (video ? this.service.create(input, image, video) : this.service.create(input, image)))); } catch (error: unknown) { next(error); } };
  update = async (request: Request, response: Response, next: NextFunction) => { try { const input = data(request).body as UpdateCategoryInput; const { image, video } = uploads(request); response.json(ok(await (video ? this.service.update(id(request), input, image, video) : this.service.update(id(request), input, image)))); } catch (error: unknown) { next(error); } };
  delete = async (request: Request, response: Response, next: NextFunction) => { try { await this.service.delete(id(request)); response.status(204).send(); } catch (error: unknown) { next(error); } };
}
