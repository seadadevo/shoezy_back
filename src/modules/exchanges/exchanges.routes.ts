import { Router } from "express";
import { PERMISSIONS } from "../../common/auth/rbac.constants";
import { requireAuth } from "../../common/middlewares/auth.middleware";
import { requirePermission } from "../../common/middlewares/permission.middleware";
import { validate } from "../../common/middlewares/validate.middleware";
import { ExchangesController } from "./exchanges.controller";
import { exchangeIdSchema, listOwnExchangesSchema } from "./exchanges.validation";
const controller = new ExchangesController();
export const ExchangesRoutes = Router()
  .get("/", validate(listOwnExchangesSchema), requireAuth, requirePermission(PERMISSIONS.EXCHANGES_READ_OWN), controller.listOwn)
  .get("/:exchangeId", validate(exchangeIdSchema), requireAuth, requirePermission(PERMISSIONS.EXCHANGES_READ_OWN), controller.getOwn);
