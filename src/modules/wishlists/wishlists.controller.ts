import type { NextFunction, Request, Response } from "express"; import { AppError } from "../../common/errors/app-error"; import { ok } from "../../common/utils/api-response"; import { WishlistsService } from "./wishlists.service"; import type { AddWishlistItemInput, ListWishlistQuery } from "./wishlists.validation";
function data(request: Request) { if (!request.validated || !request.auth) throw new AppError(500, "Request context missing", "REQUEST_CONTEXT_MISSING"); return { validated: request.validated, userId: request.auth.userId }; }
export class WishlistsController { constructor(private readonly service = new WishlistsService()) {}
  list = async (r: Request, s: Response, n: NextFunction) => { try { const x = data(r); s.json(ok(await this.service.list(x.userId, x.validated.query as ListWishlistQuery))); } catch (e: unknown) { n(e); } };
  add = async (r: Request, s: Response, n: NextFunction) => { try { const x = data(r); s.status(201).json(ok(await this.service.add(x.userId, x.validated.body as AddWishlistItemInput))); } catch (e: unknown) { n(e); } };
  delete = async (r: Request, s: Response, n: NextFunction) => { try { const x = data(r); await this.service.delete(x.userId, (x.validated.params as { wishlistItemId: string }).wishlistItemId); s.status(204).send(); } catch (e: unknown) { n(e); } };
}
