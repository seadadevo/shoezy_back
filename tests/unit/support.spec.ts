import { createServer } from "node:http";
import type { AddressInfo } from "node:net";
import { io as createClient, type Socket } from "socket.io-client";
import request from "supertest";
import { afterEach, describe, expect, it, vi } from "vitest";
import { createApp } from "../../src/app";
import { PERMISSIONS } from "../../src/common/auth/rbac.constants";
import { supportAdminEmail } from "../../src/modules/support/support-email.service";
import { SupportRepository } from "../../src/modules/support/support.repository";
import { normalizedSupportPhone, supportToken, supportTokenHash, validSupportToken } from "../../src/modules/support/support.security";
import { supportHub } from "../../src/modules/support/support.socket-hub";
import { createNotificationSocketServer } from "../../src/modules/notifications/notifications.socket";
import { createSupportSchema, supportSendSchema } from "../../src/modules/support/support.validation";

const customerId = "11111111-1111-4111-8111-111111111111";
const adminId = "22222222-2222-4222-8222-222222222222";
const conversationId = "33333333-3333-4333-8333-333333333333";
const clients: Socket[] = [];
afterEach(() => { clients.splice(0).forEach((client) => client.disconnect()); supportHub.detach(); vi.restoreAllMocks(); });

describe("support security and validation", () => {
  it("uses a 256-bit random guest token, hashed storage, and constant-time verification", () => {
    const raw = supportToken();
    const hash = supportTokenHash(raw);
    expect(Buffer.from(raw, "base64url")).toHaveLength(32);
    expect(hash).toMatch(/^[a-f0-9]{64}$/);
    expect(hash).not.toContain(raw);
    expect(validSupportToken(raw, hash)).toBe(true);
    expect(validSupportToken(supportToken(), hash)).toBe(false);
    expect(validSupportToken(raw, null)).toBe(false);
  });

  it("requires text, rejects sender spoofing and control characters, and permits HTML-like text as data", () => {
    const create = (body: unknown) => createSupportSchema.safeParse({ body, params: {}, query: {} });
    expect(create({ name: "Ahmed", phone: "+21620123456", message: "<script>hello</script>" }).success).toBe(true);
    expect(create({ phone: "+21620123456", message: "hello" }).success).toBe(true); // account profile can supply name
    expect(create({ name: "Ahmed", phone: "+21620123456", message: " " }).success).toBe(false);
    expect(create({ name: "Ahmed", phone: "+21620123456", message: "a".repeat(2001) }).success).toBe(false);
    expect(create({ name: "Ahmed", phone: "+21620123456", message: "a\u0000b" }).success).toBe(false);
    expect(create({ name: "Ahmed\nInjected", phone: "+21620123456", message: "hello" }).success).toBe(false);
    expect(create({ name: "Ahmed", phone: "not a phone", message: "hello" }).success).toBe(false);
    expect(create({ name: "Ahmed", phone: "+21620123456", orderNumber: "arbitrary-id", message: "hello" }).success).toBe(false);
    expect(supportSendSchema.safeParse({ body: { message: "Hi", senderType: "ADMIN" }, params: { conversationId }, query: {} }).success).toBe(false);
    expect(normalizedSupportPhone("+216 20-123-456")).toBe("21620123456");
  });

  it("escapes every customer value in HTML email and excludes token material", () => {
    const email = supportAdminEmail({ conversation: {
      reference: "SUP-ABC", guestName: "<Ahmed>", guestPhone: "+21612345678", guestEmail: "a@example.com", userId: null,
      status: "OPEN", order: { orderNumber: "SHZ-ABC" },
    }, body: "<script>alert(1)</script>", createdAt: new Date("2026-09-27T00:00:00Z") }, "support@example.com");
    expect(email.text).toContain("<script>alert(1)</script>");
    expect(email.html).toContain("&lt;script&gt;");
    expect(email.html).not.toContain("<script>");
    expect(email.html).not.toContain("<Ahmed>");
    expect(email.text).toContain("SHZ-ABC");
  });
});

describe("public support routes", () => {
  it("creates without account or email and rejects missing guest contact or initial text", async () => {
    const create = vi.spyOn(SupportRepository.prototype, "create").mockImplementation(async (input) => {
      if (!input.name || !input.phone) throw Object.assign(new Error("Contact required"), { statusCode: 422, code: "SUPPORT_CONTACT_REQUIRED" });
      return { id: conversationId, supportAccessToken: "one-time-token" } as never;
    });
    const app = createApp();
    const valid = await request(app).post("/api/v1/support/conversations").send({ name: "Ahmed", phone: "+21620123456", message: "Help" });
    expect(valid.status).toBe(201);
    expect(valid.body.data.supportAccessToken).toBe("one-time-token");
    expect(create).toHaveBeenCalledWith(expect.not.objectContaining({ email: expect.anything() }), undefined);
    expect((await request(app).post("/api/v1/support/conversations").send({ phone: "+21620123456", message: " " })).status).toBe(422);
  });

  it("requires a guest token for follow-up and protects admin routes", async () => {
    const get = vi.spyOn(SupportRepository.prototype, "get").mockResolvedValue({ id: conversationId } as never);
    const app = createApp();
    expect((await request(app).get(`/api/v1/support/conversations/${conversationId}`)).status).toBe(401);
    const response = await request(app).get(`/api/v1/support/conversations/${conversationId}`).set("X-Support-Token", "secret");
    expect(response.status).toBe(200);
    expect(get).toHaveBeenCalledWith(conversationId, { guestToken: "secret" });
    expect((await request(app).get("/api/v1/admin/support/conversations")).status).toBe(401);
  });
});

async function socketFixture() {
  const server = createServer();
  const support = {
    authorized: vi.fn(async (id: string, actor: { userId?: string; guestToken?: string }) => {
      if (id !== conversationId || (actor.guestToken !== "guest-secret" && actor.userId !== customerId)) throw new Error("denied");
      return { userId: actor.guestToken ? null : customerId };
    }),
    getAdmin: vi.fn(async (id: string) => { if (id !== conversationId) throw new Error("missing"); return { id }; }),
  };
  const io = createNotificationSocketServer(server, async (token) => {
    if (token !== "admin" && token !== "customer" && token !== "stranger") throw new Error("invalid");
    return { userId: token === "admin" ? adminId : token === "customer" ? customerId : "44444444-4444-4444-8444-444444444444", sessionId: customerId,
      roleCodes: [token === "admin" ? "ADMIN" : "CUSTOMER"], permissions: token === "admin" ? [PERMISSIONS.SUPPORT_READ_ANY] : [] };
  }, async () => 0, support as never);
  await new Promise<void>((resolve) => server.listen(0, "127.0.0.1", resolve));
  return { io, url: `http://127.0.0.1:${(server.address() as AddressInfo).port}` };
}
function connect(url: string, auth: object) {
  const client = createClient(url, { auth, transports: ["websocket"], forceNew: true, reconnection: false });
  clients.push(client);
  return client;
}
const connected = (client: Socket) => new Promise<void>((resolve) => client.once("connect", resolve));
const join = (client: Socket, id: string) => new Promise<{ ok: boolean }>((resolve) => client.emit("support:join", id, resolve));

describe("shared Socket.IO support authorization", () => {
  it("rejects invalid guests and foreign users, then delivers only to authorized rooms", async () => {
    const fixture = await socketFixture();
    try {
      const denied = connect(fixture.url, { supportToken: "wrong", conversationId });
      const error = await new Promise<Error & { data?: { code: string } }>((resolve) => denied.once("connect_error", resolve));
      expect(error.data?.code).toBe("SUPPORT_ACCESS_DENIED");
      const guest = connect(fixture.url, { supportToken: "guest-secret", conversationId });
      const customer = connect(fixture.url, { token: "customer" });
      const stranger = connect(fixture.url, { token: "stranger" });
      const admin = connect(fixture.url, { token: "admin" });
      await Promise.all([guest, customer, stranger, admin].map(connected));
      expect(await join(customer, conversationId)).toEqual({ ok: true });
      expect(await join(stranger, conversationId)).toEqual({ ok: false });
      const received = [guest, customer, admin].map((client) => new Promise((resolve) => client.once("support:message:new", resolve)));
      supportHub.message(conversationId, { id: "message", conversationId, senderType: "CUSTOMER", senderDisplayName: "Ahmed", body: "Help", createdAt: new Date().toISOString() });
      expect((await Promise.all(received)).map((item) => (item as { body: string; senderDisplayName: string }).senderDisplayName)).toEqual(["Ahmed", "Ahmed", "Ahmed"]);
      expect([...fixture.io.sockets.sockets.values()].find((socket) => socket.data.auth?.userId === "44444444-4444-4444-8444-444444444444")?.rooms.has(`support:conversation:${conversationId}`)).toBe(false);
    } finally { await fixture.io.close(); }
  });
});
