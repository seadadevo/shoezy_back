import { Router } from "express";
import { AuthRoutes } from "../modules/auth/auth.routes";
import { UsersRoutes } from "../modules/users/users.routes";
import { AddressesRoutes } from "../modules/addresses/addresses.routes";
import { AdminRoutes } from "../modules/admin/admin.routes";
import { CatalogRoutes } from "../modules/catalog/catalog.routes";
import { WishlistsRoutes } from "../modules/wishlists/wishlists.routes";
import { CartsRoutes } from "../modules/carts/carts.routes";
import { CheckoutRoutes } from "../modules/checkout/checkout.routes";
import { ShippingRoutes } from "../modules/shipping/shipping.routes";
import { OrdersRoutes } from "../modules/orders/orders.routes";
import { ReviewsRoutes } from "../modules/reviews/reviews.routes";
import { ReviewsController } from "../modules/reviews/reviews.controller";
import { deleteReviewSchema } from "../modules/reviews/reviews.validation";
import { requireAuth } from "../common/middlewares/auth.middleware";
import { requirePermission } from "../common/middlewares/permission.middleware";
import { PERMISSIONS } from "../common/auth/rbac.constants";
import { validate } from "../common/middlewares/validate.middleware";
import { ReturnsRoutes } from "../modules/returns/returns.routes";
import { StoreSettingsRoutes } from "../modules/store-settings/store-settings.routes";
import { ExchangesRoutes } from "../modules/exchanges/exchanges.routes";
import { GuestRoutes } from "../modules/checkout/guest.routes";
import { NotificationsRoutes } from "../modules/notifications/notifications.routes";
import { HomepageRoutes } from "../modules/homepage/homepage.routes";
import { SupportRoutes } from "../modules/support/support.routes";

export const apiRouter = Router();

apiRouter.use("/auth", AuthRoutes);
apiRouter.use("/users", UsersRoutes);
apiRouter.use("/addresses", AddressesRoutes);
apiRouter.use("/admin", AdminRoutes);
apiRouter.use("/catalog", CatalogRoutes);
apiRouter.use("/wishlist", WishlistsRoutes);
apiRouter.use("/cart", CartsRoutes);
apiRouter.use("/checkout", CheckoutRoutes);
apiRouter.use("/shipping-methods", ShippingRoutes);
apiRouter.use("/orders", OrdersRoutes);
apiRouter.use("/products", ReviewsRoutes);

const reviewsController = new ReviewsController();
const standaloneReviewsRouter = Router();
standaloneReviewsRouter.delete(
  "/:reviewId",
  validate(deleteReviewSchema),
  requireAuth,
  requirePermission(PERMISSIONS.REVIEWS_DELETE_OWN),
  reviewsController.delete,
);
apiRouter.use("/reviews", standaloneReviewsRouter);
apiRouter.use("/returns", ReturnsRoutes);
apiRouter.use("/store-settings", StoreSettingsRoutes);
apiRouter.use("/exchanges", ExchangesRoutes);
apiRouter.use("/guest", GuestRoutes);
apiRouter.use("/notifications", NotificationsRoutes);
apiRouter.use("/homepage", HomepageRoutes);
apiRouter.use("/support", SupportRoutes);
