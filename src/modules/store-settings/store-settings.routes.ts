import { Router } from "express";
import { PERMISSIONS } from "../../common/auth/rbac.constants";
import { requireAuth } from "../../common/middlewares/auth.middleware";
import { requirePermission } from "../../common/middlewares/permission.middleware";
import { validate } from "../../common/middlewares/validate.middleware";
import { StoreSettingsController } from "./store-settings.controller";
import { readStoreSettingsSchema, updateStoreSettingsSchema } from "./store-settings.validation";

const controller = new StoreSettingsController();
export const StoreSettingsRoutes = Router().get("/", validate(readStoreSettingsSchema), controller.getPublic);
export const AdminStoreSettingsRoutes = Router()
  .get("/", validate(readStoreSettingsSchema), requireAuth, requirePermission(PERMISSIONS.STORE_SETTINGS_MANAGE_ANY), controller.getAdmin)
  .patch("/", validate(updateStoreSettingsSchema), requireAuth, requirePermission(PERMISSIONS.STORE_SETTINGS_MANAGE_ANY), controller.update);
