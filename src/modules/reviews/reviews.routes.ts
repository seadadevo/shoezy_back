import { Router } from "express";
import { PERMISSIONS } from "../../common/auth/rbac.constants";
import { requireAuth } from "../../common/middlewares/auth.middleware";
import { requirePermission } from "../../common/middlewares/permission.middleware";
import { validate } from "../../common/middlewares/validate.middleware";
import { commerceMutationRateLimit } from "../../common/middlewares/commerce-rate-limit.middleware";
import { ReviewsController } from "./reviews.controller";
import { checkEligibilitySchema, createReviewSchema, deleteReviewSchema, updateReviewSchema } from "./reviews.validation";
import { parseReviewUpload } from "./reviews-upload.middleware";

const router = Router();
const controller = new ReviewsController();

router.get("/:productId/reviews/eligibility", validate(checkEligibilitySchema), requireAuth, requirePermission(PERMISSIONS.REVIEWS_CREATE_OWN), controller.checkEligibility);
router.post("/:productId/reviews", parseReviewUpload, validate(createReviewSchema), requireAuth, requirePermission(PERMISSIONS.REVIEWS_CREATE_OWN), commerceMutationRateLimit(20, "REVIEW_RATE_LIMITED"), controller.create);
router.patch("/:productId/reviews/:reviewId", validate(updateReviewSchema), requireAuth, requirePermission(PERMISSIONS.REVIEWS_UPDATE_OWN), controller.update);
router.delete("/:productId/reviews/:reviewId", validate(deleteReviewSchema), requireAuth, requirePermission(PERMISSIONS.REVIEWS_DELETE_OWN), controller.delete);

export const ReviewsRoutes = router;
