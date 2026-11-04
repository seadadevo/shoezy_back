import { Router } from "express";
import { PERMISSIONS } from "../../common/auth/rbac.constants";
import { requireAuth } from "../../common/middlewares/auth.middleware";
import { requirePermission } from "../../common/middlewares/permission.middleware";
import { validate } from "../../common/middlewares/validate.middleware";
import { HomepageController } from "./homepage.controller";
import { parseHomepageBannerUpload } from "./homepage-upload.middleware";
import {
  bannerIdSchema,
  createHomepageBannerSchema,
  listAdminBannersSchema,
  listPublicBannersSchema,
  updateHomepageBannerSchema,
} from "./homepage.validation";

// Public Router (mounted at /api/v1/homepage)
const publicRouter = Router();
const controller = new HomepageController();

publicRouter.get(
  "/banners",
  validate(listPublicBannersSchema),
  controller.listPublic,
);

export const HomepageRoutes = publicRouter;

// Admin Router (mounted at /api/v1/admin/homepage)
const adminRouter = Router();
const readAuthorize = requirePermission(PERMISSIONS.HOMEPAGE_READ_ANY);
const manageAuthorize = requirePermission(PERMISSIONS.HOMEPAGE_MANAGE_ANY);

adminRouter.get(
  "/banners",
  requireAuth,
  readAuthorize,
  validate(listAdminBannersSchema),
  controller.listAdmin,
);

adminRouter.get(
  "/banners/:bannerId",
  requireAuth,
  readAuthorize,
  validate(bannerIdSchema),
  controller.get,
);

adminRouter.post(
  "/banners",
  requireAuth,
  manageAuthorize,
  parseHomepageBannerUpload,
  validate(createHomepageBannerSchema),
  controller.create,
);

adminRouter.patch(
  "/banners/:bannerId",
  requireAuth,
  manageAuthorize,
  parseHomepageBannerUpload,
  validate(updateHomepageBannerSchema),
  controller.update,
);

adminRouter.delete(
  "/banners/:bannerId",
  requireAuth,
  manageAuthorize,
  validate(bannerIdSchema),
  controller.delete,
);

adminRouter.patch(
  "/banners/:bannerId/activate",
  requireAuth,
  manageAuthorize,
  validate(bannerIdSchema),
  controller.activate,
);

adminRouter.patch(
  "/banners/:bannerId/deactivate",
  requireAuth,
  manageAuthorize,
  validate(bannerIdSchema),
  controller.deactivate,
);

export const AdminHomepageRoutes = adminRouter;
