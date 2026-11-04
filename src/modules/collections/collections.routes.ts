import { Router } from "express";
import { PERMISSIONS } from "../../common/auth/rbac.constants";
import { requireAuth } from "../../common/middlewares/auth.middleware";
import { requirePermission } from "../../common/middlewares/permission.middleware";
import { validate } from "../../common/middlewares/validate.middleware";
import { CollectionsController } from "./collections.controller";
import { parseCollectionUpload } from "./collections-upload.middleware";
import {
  collectionIdSchema,
  createCollectionSchema,
  listCollectionsSchema,
  replaceCollectionProductsSchema,
  updateCollectionSchema,
} from "./collections.validation";

const router = Router();
const controller = new CollectionsController();
const authorize = requirePermission(PERMISSIONS.COLLECTIONS_MANAGE_ANY);

router.get("/", validate(listCollectionsSchema), requireAuth, authorize, controller.list);
router.get("/:collectionId", validate(collectionIdSchema), requireAuth, authorize, controller.get);
router.post("/", requireAuth, authorize, parseCollectionUpload, validate(createCollectionSchema), controller.create);
router.patch("/:collectionId", requireAuth, authorize, parseCollectionUpload, validate(updateCollectionSchema), controller.update);
router.put("/:collectionId/products", validate(replaceCollectionProductsSchema), requireAuth, authorize, controller.replaceProducts);
router.delete("/:collectionId", validate(collectionIdSchema), requireAuth, authorize, controller.delete);

export const CollectionsRoutes = router;
