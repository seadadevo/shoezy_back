import { Router } from "express";
import { PERMISSIONS } from "../../common/auth/rbac.constants";
import { requireAuth } from "../../common/middlewares/auth.middleware";
import { requirePermission } from "../../common/middlewares/permission.middleware";
import { validate } from "../../common/middlewares/validate.middleware";
import { ok } from "../../common/utils/api-response";
import { AuditLogService } from "./audit-log.service";
import { listAuditLogsSchema, type ListAuditLogsQuery } from "./audit-log.validation";

const service = new AuditLogService();
export const AuditLogRoutes = Router().get("/", validate(listAuditLogsSchema), requireAuth, requirePermission(PERMISSIONS.AUDIT_LOGS_READ_ANY), async (request, response, next) => {
  try { response.json(ok(await service.list(request.validated!.query as ListAuditLogsQuery))); } catch (error: unknown) { next(error); }
});
