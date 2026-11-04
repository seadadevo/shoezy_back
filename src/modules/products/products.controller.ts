import type { NextFunction, Request, Response } from "express";
import { AppError } from "../../common/errors/app-error";
import { ok } from "../../common/utils/api-response";
import { ProductsService } from "./products.service";
import { ProductEditorService } from "./product-editor.service";
import type { ProductEditorCreateInput, ProductEditorUpdateInput } from "./product-editor.validation";
import type { CreateProductInput, ListProductsQuery, ReplaceProductCategoriesInput, UpdateProductInput } from "./products.validation";
function data(request: Request) { if (!request.validated) throw new AppError(500, "Validation context missing", "VALIDATION_CONTEXT_MISSING"); return request.validated; }
function id(request: Request) { return (data(request).params as { productId: string }).productId; }
export class ProductsController {
  constructor(private readonly service = new ProductsService(), private readonly editor = new ProductEditorService()) {}
    searchModels = async (r: Request, s: Response, n: NextFunction) => { try { s.json(ok(await this.service.searchModels(data(r).query as { q?: string; excludeProductId?: string }))); } catch (e: unknown) { n(e); } };
  list = async (r: Request, s: Response, n: NextFunction) => { try { s.json(ok(await this.service.list(data(r).query as ListProductsQuery))); } catch (e: unknown) { n(e); } };
  get = async (r: Request, s: Response, n: NextFunction) => { try { s.json(ok(await this.service.get(id(r)))); } catch (e: unknown) { n(e); } };
  formContext = async (_r: Request, s: Response, n: NextFunction) => { try { s.set("Cache-Control", "private, max-age=60").json(ok(await this.editor.formContext())); } catch (e: unknown) { n(e); } };
  create = async (r: Request, s: Response, n: NextFunction) => { try { const body = data(r).body as CreateProductInput | ProductEditorCreateInput; if ("product" in body) { const result = await this.editor.create(body, (r.files as Express.Multer.File[] | undefined) ?? [], r.auth!.userId); s.locals.adminAuditRecorded = true; s.status(201).json(ok(result)); } else s.status(201).json(ok(await this.service.create(body))); } catch (e: unknown) { n(e); } };
  update = async (r: Request, s: Response, n: NextFunction) => { try { const body = data(r).body as UpdateProductInput | ProductEditorUpdateInput; if ("product" in body || "categories" in body || "options" in body || "variants" in body || "media" in body) { const result = await this.editor.update(id(r), body as ProductEditorUpdateInput, (r.files as Express.Multer.File[] | undefined) ?? [], r.auth!.userId); s.locals.adminAuditRecorded = true; s.json(ok(result)); } else s.json(ok(await this.service.update(id(r), body as UpdateProductInput))); } catch (e: unknown) { n(e); } };
  replaceCategories = async (r: Request, s: Response, n: NextFunction) => { try { s.json(ok(await this.service.replaceCategories(id(r), data(r).body as ReplaceProductCategoriesInput))); } catch (e: unknown) { n(e); } };
  delete = async (r: Request, s: Response, n: NextFunction) => { try { await this.service.delete(id(r)); s.status(204).send(); } catch (e: unknown) { n(e); } };
}
