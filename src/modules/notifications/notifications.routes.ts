import { Router } from "express";
import { requireAuth } from "../../common/middlewares/auth.middleware";
import { validate } from "../../common/middlewares/validate.middleware";
import { NotificationsController } from "./notifications.controller";
import { listNotificationsSchema, notificationEmptySchema, notificationIdSchema } from "./notifications.validation";

const router = Router();
const controller = new NotificationsController();
router.get("/", validate(listNotificationsSchema), requireAuth, controller.list);
router.get("/unread-count", validate(notificationEmptySchema), requireAuth, controller.unreadCount);
router.patch("/read-all", validate(notificationEmptySchema), requireAuth, controller.markAllRead);
router.patch("/:notificationId/read", validate(notificationIdSchema), requireAuth, controller.markRead);
router.delete("/:notificationId", validate(notificationIdSchema), requireAuth, controller.delete);
export const NotificationsRoutes = router;
