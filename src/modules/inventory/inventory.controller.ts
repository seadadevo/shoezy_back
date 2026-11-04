import type { NextFunction, Request, Response } from "express";
import { ok } from "../../common/utils/api-response";
import { InventoryService } from "./inventory.service";
import type { ListInventoryMovementsQuery } from "./inventory.validation";

export class InventoryController {
  constructor(private readonly service = new InventoryService()) {}
  list = async (request: Request, response: Response, next: NextFunction) => { try { response.json(ok(await this.service.list(request.validated!.query as ListInventoryMovementsQuery))); } catch (error: unknown) { next(error); } };
}
