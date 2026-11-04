import { Router } from "express";
import { PERMISSIONS } from "../../common/auth/rbac.constants";
import { requireAuth } from "../../common/middlewares/auth.middleware";
import { requirePermission } from "../../common/middlewares/permission.middleware";
import { validate } from "../../common/middlewares/validate.middleware";
import { CartsController } from "./carts.controller";
import { addCartItemSchema, deleteCartItemSchema, getCartSchema, setCartDiscountCodeSchema, updateCartItemSchema } from "./carts.validation";

const router = Router();
const controller = new CartsController();
router.use(requireAuth);
router.get("/", validate(getCartSchema), requirePermission(PERMISSIONS.CART_READ_OWN), controller.get);
router.post("/items", validate(addCartItemSchema), requirePermission(PERMISSIONS.CART_MANAGE_OWN), controller.addItem);
router.patch("/items/:cartItemId", validate(updateCartItemSchema), requirePermission(PERMISSIONS.CART_MANAGE_OWN), controller.updateItem);
router.delete("/items/:cartItemId", validate(deleteCartItemSchema), requirePermission(PERMISSIONS.CART_MANAGE_OWN), controller.deleteItem);
router.delete("/", validate(getCartSchema), requirePermission(PERMISSIONS.CART_MANAGE_OWN), controller.clear);
router.put("/discount-code", validate(setCartDiscountCodeSchema), requirePermission(PERMISSIONS.CART_MANAGE_OWN), controller.setDiscountCode);
router.delete("/discount-code", validate(getCartSchema), requirePermission(PERMISSIONS.CART_MANAGE_OWN), controller.removeDiscountCode);
export const CartsRoutes = router;
