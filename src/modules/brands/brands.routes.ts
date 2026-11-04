import { Router } from "express";
import { PERMISSIONS } from "../../common/auth/rbac.constants";
import { requireAuth } from "../../common/middlewares/auth.middleware";
import { requirePermission } from "../../common/middlewares/permission.middleware";
import { validate } from "../../common/middlewares/validate.middleware";
import { BrandsController } from "./brands.controller";
import { parseBrandUpload } from "./brands-upload.middleware";
import { brandIdSchema, createBrandSchema, listBrandsSchema, updateBrandSchema } from "./brands.validation";

const router = Router();
const controller = new BrandsController();
const authorize = requirePermission(PERMISSIONS.BRANDS_MANAGE_ANY);

router.get("/", validate(listBrandsSchema), requireAuth, authorize, controller.list);
router.get("/:brandId", validate(brandIdSchema), requireAuth, authorize, controller.get);
router.post("/", requireAuth, authorize, parseBrandUpload, validate(createBrandSchema), controller.create);
router.patch("/:brandId", requireAuth, authorize, parseBrandUpload, validate(updateBrandSchema), controller.update);
router.delete("/:brandId", validate(brandIdSchema), requireAuth, authorize, controller.delete);

export const BrandsRoutes = router;
