import { Router } from "express";
import { validate } from "../../common/middlewares/validate.middleware";
import { requireAuth } from "../../common/middlewares/auth.middleware";
import { AuthController } from "./auth.controller";
import { authRateLimit } from "./auth.rate-limit";
import { PERMISSIONS } from "../../common/auth/rbac.constants";
import { requirePermission } from "../../common/middlewares/permission.middleware";
import { UsersController } from "../users/users.controller";
import { changePasswordSchema } from "../users/users.validation";
import {
  facebookSchema,
  forgotPasswordSchema,
  googleSchema,
  loginSchema,
  logoutSchema,
  refreshSchema,
  registerSchema,
  resendVerificationSchema,
  resetPasswordSchema,
  verifyEmailSchema,
} from "./auth.validation";

const router = Router();
const controller = new AuthController();
const usersController = new UsersController();

router.post("/register", authRateLimit(10), validate(registerSchema), controller.register);
router.post("/verify-email", authRateLimit(20), validate(verifyEmailSchema), controller.verifyEmail);
router.post(
  "/resend-verification",
  authRateLimit(5),
  validate(resendVerificationSchema),
  controller.resendVerification,
);
router.post("/login", authRateLimit(10), validate(loginSchema), controller.login);
router.post("/refresh", authRateLimit(30), validate(refreshSchema), controller.refresh);
router.post("/logout", validate(logoutSchema), requireAuth, controller.logout);
router.post("/logout-all", validate(logoutSchema), requireAuth, controller.logoutAll);
router.post(
  "/change-password",
  authRateLimit(10),
  validate(changePasswordSchema),
  requireAuth,
  requirePermission(PERMISSIONS.PROFILE_UPDATE_OWN),
  usersController.changePassword,
);
router.post(
  "/forgot-password",
  authRateLimit(5),
  validate(forgotPasswordSchema),
  controller.forgotPassword,
);
router.post(
  "/reset-password",
  authRateLimit(10),
  validate(resetPasswordSchema),
  controller.resetPassword,
);
router.post("/google", authRateLimit(10), validate(googleSchema), controller.google);
router.post("/facebook", authRateLimit(10), validate(facebookSchema), controller.facebook);

export const AuthRoutes = router;
