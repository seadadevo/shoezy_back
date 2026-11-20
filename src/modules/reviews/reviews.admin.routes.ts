import { Router } from "express";
import { PERMISSIONS } from "../../common/auth/rbac.constants";
import { requireAuth } from "../../common/middlewares/auth.middleware";
import { requirePermission } from "../../common/middlewares/permission.middleware";
import { validate } from "../../common/middlewares/validate.middleware";
import { ReviewsController } from "./reviews.controller";
import { listAdminReviewsSchema, moderateReviewSchema, deleteReviewSchema } from "./reviews.validation";

const router = Router();
const controller = new ReviewsController();

router.get("/", validate(listAdminReviewsSchema), requireAuth, requirePermission(PERMISSIONS.REVIEWS_READ_ANY), controller.listAdmin);
router.post("/:reviewId/moderation", validate(moderateReviewSchema), requireAuth, requirePermission(PERMISSIONS.REVIEWS_MODERATE_ANY), controller.moderate);
router.delete("/:reviewId", validate(deleteReviewSchema), requireAuth, requirePermission(PERMISSIONS.REVIEWS_MODERATE_ANY), controller.deleteAdmin);

export const AdminReviewsRoutes = router;
