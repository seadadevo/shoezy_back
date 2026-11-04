import { Router } from "express";
import { PERMISSIONS } from "../../common/auth/rbac.constants";
import { requireAuth } from "../../common/middlewares/auth.middleware";
import { requirePermission } from "../../common/middlewares/permission.middleware";
import { validate } from "../../common/middlewares/validate.middleware";
import { InventoryController } from "./inventory.controller";
import { listInventoryMovementsSchema } from "./inventory.validation";
export const AdminInventoryRoutes = Router().get("/movements", validate(listInventoryMovementsSchema), requireAuth, requirePermission(PERMISSIONS.INVENTORY_READ_ANY), new InventoryController().list);
