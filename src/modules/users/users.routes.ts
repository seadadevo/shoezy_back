import { Router } from "express";
import { PERMISSIONS } from "../../common/auth/rbac.constants";
import { requireAuth } from "../../common/middlewares/auth.middleware";
import { requirePermission } from "../../common/middlewares/permission.middleware";
import { validate } from "../../common/middlewares/validate.middleware";
import { UsersController } from "./users.controller";
import { getProfileSchema, updateProfileSchema } from "./users.validation";

const router = Router();
const controller = new UsersController();

router.get(
  "/me",
  validate(getProfileSchema),
  requireAuth,
  requirePermission(PERMISSIONS.PROFILE_READ_OWN),
  controller.me,
);
router.patch(
  "/me",
  validate(updateProfileSchema),
  requireAuth,
  requirePermission(PERMISSIONS.PROFILE_UPDATE_OWN),
  controller.updateMe,
);

export const UsersRoutes = router;
