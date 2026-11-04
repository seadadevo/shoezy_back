import { Router } from "express"; import { PERMISSIONS } from "../../common/auth/rbac.constants"; import { requireAuth } from "../../common/middlewares/auth.middleware"; import { requirePermission } from "../../common/middlewares/permission.middleware"; import { validate } from "../../common/middlewares/validate.middleware"; import { WishlistsController } from "./wishlists.controller"; import { addWishlistItemSchema, deleteWishlistItemSchema, listWishlistSchema } from "./wishlists.validation";
const router = Router(); const controller = new WishlistsController();
router.get("/", validate(listWishlistSchema), requireAuth, requirePermission(PERMISSIONS.WISHLIST_READ_OWN), controller.list);
router.post("/items", validate(addWishlistItemSchema), requireAuth, requirePermission(PERMISSIONS.WISHLIST_MANAGE_OWN), controller.add);
router.delete("/items/:wishlistItemId", validate(deleteWishlistItemSchema), requireAuth, requirePermission(PERMISSIONS.WISHLIST_MANAGE_OWN), controller.delete);
export const WishlistsRoutes = router;
