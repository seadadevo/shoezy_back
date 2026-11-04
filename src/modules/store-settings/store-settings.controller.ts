import type { NextFunction, Request, Response } from "express";
import { ok } from "../../common/utils/api-response";
import { StoreSettingsService } from "./store-settings.service";
import type { UpdateStoreSettingsInput } from "./store-settings.validation";

export class StoreSettingsController {
  constructor(private readonly service = new StoreSettingsService()) {}
  getPublic = async (_request: Request, response: Response, next: NextFunction) => { try { response.json(ok(await this.service.getPublic())); } catch (error: unknown) { next(error); } };
  getAdmin = async (_request: Request, response: Response, next: NextFunction) => { try { response.json(ok(await this.service.getAdmin())); } catch (error: unknown) { next(error); } };
  update = async (request: Request, response: Response, next: NextFunction) => { try { const value = await this.service.update(request.validated!.body as UpdateStoreSettingsInput, request.auth!.userId); response.locals.adminAuditRecorded = true; response.json(ok(value)); } catch (error: unknown) { next(error); } };
}
