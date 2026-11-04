import { Router } from "express";
import { PERMISSIONS } from "../../common/auth/rbac.constants";
import { requireAuth } from "../../common/middlewares/auth.middleware";
import { requirePermission } from "../../common/middlewares/permission.middleware";
import { validate } from "../../common/middlewares/validate.middleware";
import { CustomersController } from "./customers.controller";
import { customerIdSchema, listCustomersSchema, updateCustomerStatusSchema } from "./customers.validation";
const controller = new CustomersController();
export const AdminCustomersRoutes = Router()
  .get("/", validate(listCustomersSchema), requireAuth, requirePermission(PERMISSIONS.USERS_READ_ANY), controller.list)
  .get("/:customerId", validate(customerIdSchema), requireAuth, requirePermission(PERMISSIONS.USERS_READ_ANY), controller.get)
  .patch("/:customerId/status", validate(updateCustomerStatusSchema), requireAuth, requirePermission(PERMISSIONS.USERS_MANAGE_ANY), controller.setStatus);
