import type { NextFunction, Request, Response } from "express";
import { AppError } from "../../common/errors/app-error";
import { ok } from "../../common/utils/api-response";
import { SizeGuidesService } from "./size-guides.service";
import type { CreateSizeGuideEntryInput, CreateSizeGuideInput, ListSizeGuidesQuery, UpdateSizeGuideEntryInput, UpdateSizeGuideInput } from "./size-guides.validation";
function data(request: Request) { if (!request.validated) throw new AppError(500, "Validation context missing", "VALIDATION_CONTEXT_MISSING"); return request.validated; }
function ids(request: Request) { return data(request).params as { sizeGuideId: string; entryId?: string }; }
export class SizeGuidesController {
  constructor(private readonly service = new SizeGuidesService()) {}
  list = async (r: Request, s: Response, n: NextFunction) => { try { s.json(ok(await this.service.list(data(r).query as ListSizeGuidesQuery))); } catch (e: unknown) { n(e); } };
  get = async (r: Request, s: Response, n: NextFunction) => { try { s.json(ok(await this.service.get(ids(r).sizeGuideId))); } catch (e: unknown) { n(e); } };
  create = async (r: Request, s: Response, n: NextFunction) => { try { const input = data(r).body as CreateSizeGuideInput; const result = await this.service.create(input, input.entries === undefined ? undefined : r.auth?.userId); if (input.entries !== undefined) s.locals.adminAuditRecorded = true; s.status(201).json(ok(result)); } catch (e: unknown) { n(e); } };
  update = async (r: Request, s: Response, n: NextFunction) => { try { const input = data(r).body as UpdateSizeGuideInput; const result = await this.service.update(ids(r).sizeGuideId, input, input.entries === undefined ? undefined : r.auth?.userId); if (input.entries !== undefined) s.locals.adminAuditRecorded = true; s.json(ok(result)); } catch (e: unknown) { n(e); } };
  delete = async (r: Request, s: Response, n: NextFunction) => { try { await this.service.delete(ids(r).sizeGuideId); s.status(204).send(); } catch (e: unknown) { n(e); } };
  createEntry = async (r: Request, s: Response, n: NextFunction) => { try { s.status(201).json(ok(await this.service.createEntry(ids(r).sizeGuideId, data(r).body as CreateSizeGuideEntryInput))); } catch (e: unknown) { n(e); } };
  updateEntry = async (r: Request, s: Response, n: NextFunction) => { try { s.json(ok(await this.service.updateEntry(ids(r).sizeGuideId, ids(r).entryId!, data(r).body as UpdateSizeGuideEntryInput))); } catch (e: unknown) { n(e); } };
  deleteEntry = async (r: Request, s: Response, n: NextFunction) => { try { await this.service.deleteEntry(ids(r).sizeGuideId, ids(r).entryId!); s.status(204).send(); } catch (e: unknown) { n(e); } };
}
