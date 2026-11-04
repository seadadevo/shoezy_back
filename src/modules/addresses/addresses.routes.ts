import { Router } from "express";
import { PERMISSIONS } from "../../common/auth/rbac.constants";
import { requireAuth } from "../../common/middlewares/auth.middleware";
import { requirePermission } from "../../common/middlewares/permission.middleware";
import { validate } from "../../common/middlewares/validate.middleware";
import { AddressesController } from "./addresses.controller";
import {
  addressIdSchema,
  createAddressSchema,
  listAddressesSchema,
  updateAddressSchema,
} from "./addresses.validation";

const router = Router();
const controller = new AddressesController();

router.get("/", validate(listAddressesSchema), requireAuth, requirePermission(PERMISSIONS.ADDRESSES_READ_OWN), controller.list);
router.post("/", validate(createAddressSchema), requireAuth, requirePermission(PERMISSIONS.ADDRESSES_CREATE_OWN), controller.create);
router.get("/:addressId", validate(addressIdSchema), requireAuth, requirePermission(PERMISSIONS.ADDRESSES_READ_OWN), controller.get);
router.patch("/:addressId", validate(updateAddressSchema), requireAuth, requirePermission(PERMISSIONS.ADDRESSES_UPDATE_OWN), controller.update);
router.delete("/:addressId", validate(addressIdSchema), requireAuth, requirePermission(PERMISSIONS.ADDRESSES_DELETE_OWN), controller.delete);
router.post("/:addressId/default", validate(addressIdSchema), requireAuth, requirePermission(PERMISSIONS.ADDRESSES_UPDATE_OWN), controller.setDefault);

export const AddressesRoutes = router;
