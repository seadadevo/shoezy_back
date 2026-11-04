import { Router } from "express";
import { validate } from "../../common/middlewares/validate.middleware";
import { ShippingController } from "./shipping.controller";
import { listPublicShippingMethodsSchema } from "./shipping.validation";
const router = Router(); const controller = new ShippingController();
router.get("/", validate(listPublicShippingMethodsSchema), controller.listPublic);
export const ShippingRoutes = router;
