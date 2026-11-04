import { Router } from "express";
import { PERMISSIONS } from "../../common/auth/rbac.constants";
import { requireAuth } from "../../common/middlewares/auth.middleware";
import { requirePermission } from "../../common/middlewares/permission.middleware";
import { validate } from "../../common/middlewares/validate.middleware";
import { ExchangesController } from "./exchanges.controller";
import { decideExchangeSchema, exchangeIdSchema, listAdminExchangesSchema } from "./exchanges.validation";
const controller = new ExchangesController();
export const AdminExchangesRoutes = Router()
  .get("/", validate(listAdminExchangesSchema), requireAuth, requirePermission(PERMISSIONS.EXCHANGES_READ_ANY), controller.listAny)
  .get("/:exchangeId", validate(exchangeIdSchema), requireAuth, requirePermission(PERMISSIONS.EXCHANGES_READ_ANY), controller.getAny)
  .post("/:exchangeId/decision", validate(decideExchangeSchema), requireAuth, requirePermission(PERMISSIONS.EXCHANGES_MANAGE_ANY), controller.decide)
  .post("/:exchangeId/complete", validate(exchangeIdSchema), requireAuth, requirePermission(PERMISSIONS.EXCHANGES_MANAGE_ANY), controller.complete);
