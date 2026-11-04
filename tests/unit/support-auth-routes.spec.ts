import request from "supertest";
import { afterEach, beforeEach, describe, expect, it, vi } from "vitest";
import { createApp } from "../../src/app";
import { createSessionTokenPair } from "../../src/common/auth/auth.security";
import { AuthGuardRepository } from "../../src/common/auth/auth-guard.repository";
import { RbacRepository } from "../../src/common/auth/rbac.repository";
import { PERMISSIONS, type PermissionCode } from "../../src/common/auth/rbac.constants";
import { SupportRepository } from "../../src/modules/support/support.repository";
import { AuditLogService } from "../../src/modules/admin-audit/audit-log.service";

const userId = "11111111-1111-4111-8111-111111111111";
const sessionId = "22222222-2222-4222-8222-222222222222";
const conversationId = "33333333-3333-4333-8333-333333333333";
const authorization = `Bearer ${createSessionTokenPair(userId, sessionId).accessToken}`;
let permissions: PermissionCode[] = [];

beforeEach(() => {
  permissions = [];
  vi.spyOn(AuditLogService.prototype, "record").mockResolvedValue({} as never);
  vi.spyOn(AuthGuardRepository.prototype, "findSession").mockResolvedValue({
    id: sessionId, userId, expiresAt: new Date(Date.now() + 60_000), revokedAt: null,
    user: { status: "ACTIVE", deletedAt: null },
  });
  vi.spyOn(RbacRepository.prototype, "getUserAuthorizationSnapshot").mockImplementation(async () => ({ roleCodes: permissions.length ? ["ADMIN"] : ["CUSTOMER"], permissions }));
});
afterEach(() => vi.restoreAllMocks());

describe("authenticated support routes and admin RBAC", () => {
  it("links account identity server-side and blocks customer from admin inbox", async () => {
    const create = vi.spyOn(SupportRepository.prototype, "create").mockResolvedValue({ id: conversationId } as never);
    const get = vi.spyOn(SupportRepository.prototype, "get").mockResolvedValue({ id: conversationId } as never);
    const app = createApp();
    const created = await request(app).post("/api/v1/support/conversations").set("Authorization", authorization).send({ message: "Help", phone: "+21620123456" });
    expect(created.status).toBe(201);
    expect(create).toHaveBeenCalledWith(expect.objectContaining({ message: "Help" }), userId);
    const detail = await request(app).get(`/api/v1/support/conversations/${conversationId}`).set("Authorization", authorization);
    expect(detail.status).toBe(200);
    expect(get).toHaveBeenCalledWith(conversationId, { userId });
    expect((await request(app).get("/api/v1/admin/support/conversations").set("Authorization", authorization)).status).toBe(403);
    expect((await request(app).patch(`/api/v1/admin/support/conversations/${conversationId}/status`).set("Authorization", authorization).send({ status: "CLOSED" })).status).toBe(403);
  });

  it("enforces read/manage permissions, validates filters, and derives admin sender", async () => {
    permissions = [PERMISSIONS.SUPPORT_READ_ANY];
    const list = vi.spyOn(SupportRepository.prototype, "listAdmin").mockResolvedValue({ items: [], pagination: { page: 1, limit: 20, total: 0, totalPages: 0 } });
    const send = vi.spyOn(SupportRepository.prototype, "send").mockResolvedValue({ id: "message", senderType: "ADMIN" } as never);
    const status = vi.spyOn(SupportRepository.prototype, "status").mockResolvedValue({ id: conversationId, status: "CLOSED" } as never);
    const app = createApp();
    const inbox = await request(app).get("/api/v1/admin/support/conversations?status=OPEN&unreadOnly=true&page=1&limit=20").set("Authorization", authorization);
    expect(inbox.status).toBe(200);
    expect(list).toHaveBeenCalledWith(expect.objectContaining({ status: "OPEN", unreadOnly: true, page: 1, limit: 20 }));
    expect((await request(app).get("/api/v1/admin/support/conversations?limit=101").set("Authorization", authorization)).status).toBe(422);
    expect((await request(app).post(`/api/v1/admin/support/conversations/${conversationId}/messages`).set("Authorization", authorization).send({ message: "Reply" })).status).toBe(403);
    permissions = [PERMISSIONS.SUPPORT_READ_ANY, PERMISSIONS.SUPPORT_MANAGE_ANY];
    const reply = await request(app).post(`/api/v1/admin/support/conversations/${conversationId}/messages`).set("Authorization", authorization).send({ message: "Reply" });
    expect(reply.status).toBe(201);
    expect(send).toHaveBeenCalledWith(conversationId, "Reply", { adminId: userId });
    const changed = await request(app).patch(`/api/v1/admin/support/conversations/${conversationId}/status`).set("Authorization", authorization).send({ status: "CLOSED" });
    expect(changed.status).toBe(200);
    expect(status).toHaveBeenCalledWith(conversationId, "CLOSED");
  });
});
