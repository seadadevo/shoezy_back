import type { NextFunction, Request, Response } from "express";
import { ok } from "../../common/utils/api-response";
import { CustomersService } from "./customers.service";
import type { ListCustomersQuery } from "./customers.validation";
export class CustomersController {
  constructor(private readonly service = new CustomersService()) {}
  list = async (r: Request, s: Response, n: NextFunction) => { try { s.json(ok(await this.service.list(r.validated!.query as ListCustomersQuery))); } catch (e: unknown) { n(e); } };
  get = async (r: Request, s: Response, n: NextFunction) => { try { s.json(ok(await this.service.get((r.validated!.params as { customerId: string }).customerId))); } catch (e: unknown) { n(e); } };
  setStatus = async (r: Request, s: Response, n: NextFunction) => { try { const value = await this.service.setStatus(r.auth!.userId, (r.validated!.params as { customerId: string }).customerId, (r.validated!.body as { status: "ACTIVE" | "INACTIVE" }).status); s.locals.adminAuditRecorded = true; s.json(ok(value)); } catch (e: unknown) { n(e); } };
}
