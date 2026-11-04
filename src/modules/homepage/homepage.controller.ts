import type { NextFunction, Request, Response } from "express";
import { AppError } from "../../common/errors/app-error";
import { ok } from "../../common/utils/api-response";
import { catalogLocale } from "../../common/localization/catalog-localization";
import { HomepageService, type HomepageUploadedFiles } from "./homepage.service";
import type {
  CreateHomepageBannerInput,
  ListAdminBannersQuery,
  ListPublicBannersQuery,
  UpdateHomepageBannerInput,
} from "./homepage.validation";

function data(request: Request) {
  if (!request.validated) throw new AppError(500, "Validation context missing", "VALIDATION_CONTEXT_MISSING");
  return request.validated;
}

function id(request: Request) {
  return (data(request).params as { bannerId: string }).bannerId;
}

export class HomepageController {
  constructor(private readonly service = new HomepageService()) {}

  listPublic = async (request: Request, response: Response, next: NextFunction) => {
    try {
      const query = (data(request).query as ListPublicBannersQuery);
      const locale = catalogLocale(request.headers["accept-language"]);
      const banners = await this.service.listPublic(query.placement, locale);
      response.json(ok(banners));
    } catch (error: unknown) {
      next(error);
    }
  };

  listAdmin = async (request: Request, response: Response, next: NextFunction) => {
    try {
      const query = data(request).query as ListAdminBannersQuery;
      const result = await this.service.listAdmin(query);
      response.json(ok(result.items, { pagination: result.pagination }));
    } catch (error: unknown) {
      next(error);
    }
  };

  get = async (request: Request, response: Response, next: NextFunction) => {
    try {
      const banner = await this.service.getAdmin(id(request));
      response.json(ok(banner));
    } catch (error: unknown) {
      next(error);
    }
  };

  create = async (request: Request, response: Response, next: NextFunction) => {
    try {
      const input = data(request).body as CreateHomepageBannerInput;
      const files = request.files as HomepageUploadedFiles | undefined;
      const banner = await this.service.create(input, files);
      response.status(201).json(ok(banner));
    } catch (error: unknown) {
      next(error);
    }
  };

  update = async (request: Request, response: Response, next: NextFunction) => {
    try {
      const input = data(request).body as UpdateHomepageBannerInput;
      const files = request.files as HomepageUploadedFiles | undefined;
      const banner = await this.service.update(id(request), input, files);
      response.json(ok(banner));
    } catch (error: unknown) {
      next(error);
    }
  };

  delete = async (request: Request, response: Response, next: NextFunction) => {
    try {
      await this.service.delete(id(request));
      response.status(204).send();
    } catch (error: unknown) {
      next(error);
    }
  };

  activate = async (request: Request, response: Response, next: NextFunction) => {
    try {
      const banner = await this.service.toggleActive(id(request), true);
      response.json(ok(banner));
    } catch (error: unknown) {
      next(error);
    }
  };

  deactivate = async (request: Request, response: Response, next: NextFunction) => {
    try {
      const banner = await this.service.toggleActive(id(request), false);
      response.json(ok(banner));
    } catch (error: unknown) {
      next(error);
    }
  };
}
