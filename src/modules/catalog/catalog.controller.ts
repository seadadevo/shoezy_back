import type { NextFunction, Request, Response } from "express";
import { AppError } from "../../common/errors/app-error";
import { ok } from "../../common/utils/api-response";
import { CatalogService } from "./catalog.service";
import type { CatalogCollectionQuery, CatalogSizeGuideQuery, ListCatalogEntitiesQuery, ListCatalogProductsQuery, RelatedProductsQuery } from "./catalog.validation";
import { catalogLocale } from "../../common/localization/catalog-localization";
import { ShippingPreviewService } from "../shipping/shipping-preview.service";
import type { ShippingPreviewInput } from "../shipping/shipping-preview.validation";

function validated(request: Request) {
  if (!request.validated) throw new AppError(500, "Validation context missing", "VALIDATION_CONTEXT_MISSING");
  return request.validated;
}
export class CatalogController {
  constructor(private readonly service = new CatalogService(), private readonly shippingPreview = new ShippingPreviewService()) {}
  listProducts = async (request: Request, response: Response, next: NextFunction) => { try { response.json(ok(await this.service.listProducts(validated(request).query as ListCatalogProductsQuery, catalogLocale(request.headers["accept-language"])))); } catch (error: unknown) { next(error); } };
  listFilters = async (request: Request, response: Response, next: NextFunction) => { try { response.json(ok(await this.service.listFilters(catalogLocale(request.headers["accept-language"])))); } catch (error: unknown) { next(error); } };
  getProduct = async (request: Request, response: Response, next: NextFunction) => { try { response.json(ok(await this.service.getProduct((validated(request).params as { slug: string }).slug, catalogLocale(request.headers["accept-language"])))); } catch (error: unknown) { next(error); } };
  relatedProducts = async (request: Request, response: Response, next: NextFunction) => { try { response.json(ok(await this.service.relatedProducts((validated(request).params as { slug: string }).slug, (validated(request).query as RelatedProductsQuery).limit, catalogLocale(request.headers["accept-language"])))); } catch (error: unknown) { next(error); } };
  previewShipping = async (request: Request, response: Response, next: NextFunction) => { try { response.json(ok(await this.shippingPreview.preview((validated(request).params as { slug: string }).slug, validated(request).body as ShippingPreviewInput))); } catch (error: unknown) { next(error); } };
  listBrands = async (request: Request, response: Response, next: NextFunction) => { try { response.json(ok(await this.service.listBrands(validated(request).query as ListCatalogEntitiesQuery, catalogLocale(request.headers["accept-language"])))); } catch (error: unknown) { next(error); } };
  listPromotions = async (request: Request, response: Response, next: NextFunction) => { try { response.json(ok(await this.service.listPromotions(catalogLocale(request.headers["accept-language"])))); } catch (error: unknown) { next(error); } };
  listCategories = async (request: Request, response: Response, next: NextFunction) => { try { response.json(ok(await this.service.listCategories(validated(request).query as ListCatalogEntitiesQuery, catalogLocale(request.headers["accept-language"])))); } catch (error: unknown) { next(error); } };
  categoryTree = async (request: Request, response: Response, next: NextFunction) => { try { response.json(ok(await this.service.categoryTree(validated(request).query as ListCatalogEntitiesQuery, catalogLocale(request.headers["accept-language"])))); } catch (error: unknown) { next(error); } };
  listCollections = async (request: Request, response: Response, next: NextFunction) => { try { response.json(ok(await this.service.listCollections(validated(request).query as ListCatalogEntitiesQuery, catalogLocale(request.headers["accept-language"])))); } catch (error: unknown) { next(error); } };
  getCollection = async (request: Request, response: Response, next: NextFunction) => { try { response.json(ok(await this.service.getCollection((validated(request).params as { slug: string }).slug, validated(request).query as CatalogCollectionQuery, catalogLocale(request.headers["accept-language"])))); } catch (error: unknown) { next(error); } };
  getSizeGuide = async (request: Request, response: Response, next: NextFunction) => { try { response.json(ok(await this.service.getSizeGuide((validated(request).params as { sizeGuideId: string }).sizeGuideId, validated(request).query as CatalogSizeGuideQuery))); } catch (error: unknown) { next(error); } };
}
