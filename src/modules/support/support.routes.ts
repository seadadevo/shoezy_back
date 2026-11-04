import { Router, type RequestHandler } from "express";
import { authenticateAccessToken, requireAuth } from "../../common/middlewares/auth.middleware";
import { requirePermission } from "../../common/middlewares/permission.middleware";
import { commerceMutationRateLimit } from "../../common/middlewares/commerce-rate-limit.middleware";
import { validate } from "../../common/middlewares/validate.middleware";
import { PERMISSIONS } from "../../common/auth/rbac.constants";
import { AppError } from "../../common/errors/app-error";
import { ok } from "../../common/utils/api-response";
import { SupportRepository, type SupportActor } from "./support.repository";
import { createSupportSchema, supportAdminListSchema, supportIdSchema, supportListOwnSchema, supportMessagesSchema, supportSendSchema, supportStatusSchema, type CreateSupportInput, type SupportAdminList, type SupportPage } from "./support.validation";

const customer = Router();
const admin = Router();
const store = new SupportRepository();
const run = (handler: RequestHandler): RequestHandler => (request, response, next) => { Promise.resolve(handler(request, response, next)).catch(next); };
const optionalAuth: RequestHandler = (request, _response, next) => {
  const header = request.headers.authorization;
  if (!header) { next(); return; }
  if (!/^Bearer [^\s]+$/.test(header)) { next(new AppError(401, "Authentication required", "AUTH_UNAUTHORIZED")); return; }
  void authenticateAccessToken(header.slice(7)).then((auth) => { request.auth = auth; next(); }).catch(() => next(new AppError(401, "Invalid or expired access token", "AUTH_UNAUTHORIZED")));
};
function actor(request: Parameters<RequestHandler>[0]): SupportActor {
  if (request.auth) return { userId: request.auth.userId };
  const token = request.header("X-Support-Token");
  if (!token) throw new AppError(401, "Support token required", "SUPPORT_TOKEN_REQUIRED");
  return { guestToken: token };
}
const conversationId = (request: Parameters<RequestHandler>[0]) => (request.validated!.params as { conversationId: string }).conversationId;

customer.post("/conversations", commerceMutationRateLimit(10, "SUPPORT_CREATE_RATE_LIMITED"), validate(createSupportSchema), optionalAuth, run(async (request, response) => {
  response.status(201).json(ok(await store.create(request.validated!.body as CreateSupportInput, request.auth?.userId)));
}));
customer.get("/conversations", validate(supportListOwnSchema), requireAuth, run(async (request, response) => {
  response.json(ok(await store.listOwn(request.auth!.userId, request.validated!.query as SupportPage)));
}));
customer.get("/conversations/:conversationId", validate(supportIdSchema), optionalAuth, run(async (request, response) => {
  response.json(ok(await store.get(conversationId(request), actor(request))));
}));
customer.get("/conversations/:conversationId/messages", validate(supportMessagesSchema), optionalAuth, run(async (request, response) => {
  response.json(ok(await store.messages(conversationId(request), request.validated!.query as SupportPage, actor(request))));
}));
customer.post("/conversations/:conversationId/messages", commerceMutationRateLimit(90, "SUPPORT_MESSAGE_RATE_LIMITED"), validate(supportSendSchema), optionalAuth, run(async (request, response) => {
  response.status(201).json(ok(await store.send(conversationId(request), (request.validated!.body as { message: string }).message, actor(request))));
}));
customer.post("/conversations/:conversationId/read", validate(supportIdSchema), optionalAuth, run(async (request, response) => {
  response.json(ok(await store.read(conversationId(request), actor(request))));
}));

admin.use(requireAuth, requirePermission(PERMISSIONS.SUPPORT_READ_ANY));
admin.get("/conversations", validate(supportAdminListSchema), run(async (request, response) => {
  response.json(ok(await store.listAdmin(request.validated!.query as SupportAdminList)));
}));
admin.get("/conversations/:conversationId", validate(supportIdSchema), run(async (request, response) => {
  response.json(ok(await store.getAdmin(conversationId(request))));
}));
admin.get("/conversations/:conversationId/messages", validate(supportMessagesSchema), run(async (request, response) => {
  response.json(ok(await store.messages(conversationId(request), request.validated!.query as SupportPage)));
}));
admin.post("/conversations/:conversationId/read", validate(supportIdSchema), run(async (request, response) => {
  response.json(ok(await store.read(conversationId(request), { adminId: request.auth!.userId })));
}));
admin.post("/conversations/:conversationId/messages", requirePermission(PERMISSIONS.SUPPORT_MANAGE_ANY), validate(supportSendSchema), run(async (request, response) => {
  response.status(201).json(ok(await store.send(conversationId(request), (request.validated!.body as { message: string }).message, { adminId: request.auth!.userId })));
}));
admin.patch("/conversations/:conversationId/status", requirePermission(PERMISSIONS.SUPPORT_MANAGE_ANY), validate(supportStatusSchema), run(async (request, response) => {
  response.json(ok(await store.status(conversationId(request), (request.validated!.body as { status: "OPEN" | "PENDING" | "CLOSED" }).status)));
}));

export const SupportRoutes = customer;
export const AdminSupportRoutes = admin;
