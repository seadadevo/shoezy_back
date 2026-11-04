import type { NextFunction, Request, Response } from "express";
import { AppError } from "../../common/errors/app-error";
import { ok } from "../../common/utils/api-response";
import { resolveLocale } from "./notifications.templates";
import { NotificationsService } from "./notifications.service";
import type { ListNotificationsQuery } from "./notifications.validation";

function context(request: Request) {
  if (!request.auth || !request.validated) throw new AppError(500, "Request context missing", "REQUEST_CONTEXT_MISSING");
  return { userId: request.auth.userId, validated: request.validated, locale: resolveLocale(request.headers["accept-language"]) };
}

export class NotificationsController {
  constructor(private readonly service = new NotificationsService()) {}
  list = async (request: Request, response: Response, next: NextFunction) => { try { const value = context(request); response.json(ok(await this.service.list(value.userId, value.validated.query as ListNotificationsQuery, value.locale))); } catch (error: unknown) { next(error); } };
  unreadCount = async (request: Request, response: Response, next: NextFunction) => { try { const value = context(request); response.json(ok(await this.service.unreadCount(value.userId))); } catch (error: unknown) { next(error); } };
  markRead = async (request: Request, response: Response, next: NextFunction) => { try { const value = context(request); response.json(ok(await this.service.markRead(value.userId, (value.validated.params as { notificationId: string }).notificationId, value.locale))); } catch (error: unknown) { next(error); } };
  markAllRead = async (request: Request, response: Response, next: NextFunction) => { try { const value = context(request); response.json(ok(await this.service.markAllRead(value.userId))); } catch (error: unknown) { next(error); } };
  delete = async (request: Request, response: Response, next: NextFunction) => { try { const value = context(request); await this.service.delete(value.userId, (value.validated.params as { notificationId: string }).notificationId); response.status(204).send(); } catch (error: unknown) { next(error); } };
}
