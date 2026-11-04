import { Router } from "express";
import { validate } from "../../common/middlewares/validate.middleware";
import { CatalogController } from "./catalog.controller";
import { catalogCollectionSchema, catalogFiltersSchema, catalogProductSlugSchema, catalogSizeGuideSchema, listCatalogEntitiesSchema, listCatalogProductsSchema, listCatalogPromotionsSchema, relatedProductsSchema } from "./catalog.validation";
import { ReviewsController } from "../reviews/reviews.controller";
import { listPublicReviewsSchema } from "../reviews/reviews.validation";
import { shippingPreviewSchema } from "../shipping/shipping-preview.validation";

const router = Router();
const controller = new CatalogController();
const reviewsController = new ReviewsController();

router.get("/products", validate(listCatalogProductsSchema), controller.listProducts);
router.get("/filters", validate(catalogFiltersSchema), controller.listFilters);
router.get("/products/:productId/reviews", validate(listPublicReviewsSchema), reviewsController.listPublic);
router.get("/products/:slug/related", validate(relatedProductsSchema), controller.relatedProducts);
router.post("/products/:slug/shipping-preview", validate(shippingPreviewSchema), controller.previewShipping);
router.get("/products/:slug", validate(catalogProductSlugSchema), controller.getProduct);
router.get("/brands", validate(listCatalogEntitiesSchema), controller.listBrands);
router.get("/promotions", validate(listCatalogPromotionsSchema), controller.listPromotions);
router.get("/categories/tree", validate(listCatalogEntitiesSchema), controller.categoryTree);
router.get("/categories", validate(listCatalogEntitiesSchema), controller.listCategories);
router.get("/collections", validate(listCatalogEntitiesSchema), controller.listCollections);
router.get("/collections/:slug", validate(catalogCollectionSchema), controller.getCollection);
router.get("/size-guides/:sizeGuideId", validate(catalogSizeGuideSchema), controller.getSizeGuide);

export const CatalogRoutes = router;
