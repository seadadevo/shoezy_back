import { createServer } from "node:http";
import type { AddressInfo } from "node:net";
import type { Prisma } from "@prisma/client";
import { io as createClient, type Socket } from "socket.io-client";
import { afterEach, describe, expect, it, vi } from "vitest";
import { PERMISSIONS } from "../../src/common/auth/rbac.constants";
import { recordStockMovement } from "../../src/modules/inventory/inventory.repository";
import { notificationHub } from "../../src/modules/notifications/notification-hub";
import { enqueueNotification } from "../../src/modules/notifications/notifications.outbox";
import { NotificationsService } from "../../src/modules/notifications/notifications.service";
import { createNotificationSocketServer } from "../../src/modules/notifications/notifications.socket";
import { renderNotification } from "../../src/modules/notifications/notifications.templates";

const customerId = "11111111-1111-4111-8111-111111111111";
const adminId = "22222222-2222-4222-8222-222222222222";
const sessionId = "33333333-3333-4333-8333-333333333333";
const variantId = "44444444-4444-4444-8444-444444444444";
const clients: Socket[] = [];

afterEach(() => {
  for (const client of clients.splice(0)) client.disconnect();
  notificationHub.detach();
});

describe("notification localization and ownership", () => {
  it("renders stable English and Arabic templates", () => {
    expect(renderNotification("ORDER_CONFIRMED", { orderNumber: "SHZ-10" }, "en")).toEqual({ title: "Order #SHZ-10 confirmed", message: "Your order #SHZ-10 has been confirmed." });
    expect(renderNotification("ORDER_CONFIRMED", { orderNumber: "SHZ-10" }, "ar")).toEqual({ title: "تم تأكيد الطلب رقم SHZ-10", message: "تم تأكيد طلبك رقم SHZ-10." });
  });

  it("enforces ownership when reading, marking, and deleting notifications", async () => {
    const repository = {
      list: vi.fn(async (userId: string) => ({ items: [], total: userId === customerId ? 0 : 99 })),
      unreadCount: vi.fn(async () => 0),
      markRead: vi.fn(async () => null),
      markAllRead: vi.fn(async () => 2),
      delete: vi.fn(async () => false),
    };
    const service = new NotificationsService(repository as never);
    expect((await service.list(customerId, { page: 1, limit: 20, unreadOnly: false }, "en")).pagination.total).toBe(0);
    await expect(service.markRead(customerId, variantId, "en")).rejects.toMatchObject({ statusCode: 404, code: "NOTIFICATION_NOT_FOUND" });
    await expect(service.delete(customerId, variantId)).rejects.toMatchObject({ statusCode: 404, code: "NOTIFICATION_NOT_FOUND" });
    expect(repository.markRead).toHaveBeenCalledWith(customerId, variantId, expect.any(Date));
    expect(repository.delete).toHaveBeenCalledWith(customerId, variantId);
  });
});

describe("notification outbox and low-stock deduplication", () => {
  it("uses an outbox upsert with a stable deduplication key", async () => {
    const upsert = vi.fn(async () => ({}));
    await enqueueNotification({ notificationOutbox: { upsert } } as unknown as Prisma.TransactionClient, {
      audience: "ADMIN", recipientPermission: PERMISSIONS.ORDERS_READ_ANY, type: "ORDER_CREATED", entityType: "ORDER", entityId: variantId,
      templateParams: { orderNumber: "SHZ-1" }, deduplicationKey: "order:1:created:admin",
    });
    expect(upsert).toHaveBeenCalledWith(expect.objectContaining({ where: { deduplicationKey: "order:1:created:admin" }, update: {} }));
  });

  it("notifies only when stock crosses the configured threshold", async () => {
    let movement = 0;
    const upsert = vi.fn(async () => ({}));
    const transaction = {
      inventoryMovement: { create: vi.fn(async () => ({ id: `movement-${++movement}` })) },
      productVariant: { findUniqueOrThrow: vi.fn(async () => ({ sku: "SKU-42", productId: customerId })) },
      notificationOutbox: { upsert },
    } as unknown as Prisma.TransactionClient;
    await recordStockMovement(transaction, { variantId, type: "MANUAL_DECREMENT", beforeQuantity: 6, afterQuantity: 5 });
    await recordStockMovement(transaction, { variantId, type: "MANUAL_DECREMENT", beforeQuantity: 5, afterQuantity: 4 });
    expect(upsert).toHaveBeenCalledTimes(1);
    expect(upsert).toHaveBeenCalledWith(expect.objectContaining({ create: expect.objectContaining({ type: "LOW_STOCK", deduplicationKey: "inventory:movement-1:low-stock" }) }));
  });
});

async function socketFixture() {
  const server = createServer();
  const io = createNotificationSocketServer(server, async (token) => {
    if (token === "expired") throw Object.assign(new Error("expired"), { code: "AUTH_UNAUTHORIZED" });
    if (token !== "customer" && token !== "admin") throw new Error("invalid");
    return { userId: token === "admin" ? adminId : customerId, sessionId, roleCodes: [token === "admin" ? "ADMIN" : "CUSTOMER"], permissions: token === "admin" ? [PERMISSIONS.ORDERS_READ_ANY] : [] };
  }, async () => 0);
  await new Promise<void>((resolve) => server.listen(0, "127.0.0.1", resolve));
  const port = (server.address() as AddressInfo).port;
  return { server, io, url: `http://127.0.0.1:${port}` };
}

function connect(url: string, token: string) {
  const client = createClient(url, { auth: { token }, transports: ["websocket"], forceNew: true, reconnection: false });
  clients.push(client);
  return client;
}

describe("private Socket.IO notification delivery", () => {
  it("rejects invalid and expired tokens", async () => {
    const fixture = await socketFixture();
    for (const token of ["invalid", "expired"]) {
      const client = connect(fixture.url, token);
      const error = await new Promise<Error & { data?: { code?: string } }>((resolve) => client.once("connect_error", resolve));
      expect(error.data?.code).toBe("AUTH_UNAUTHORIZED");
    }
    await fixture.io.close();
  });

  it("isolates customer/admin rooms, supports multiple tabs, and ignores arbitrary room requests", async () => {
    const fixture = await socketFixture();
    const customerOne = connect(fixture.url, "customer");
    const customerTwo = connect(fixture.url, "customer");
    const admin = connect(fixture.url, "admin");
    await Promise.all([customerOne, customerTwo, admin].map((client) => new Promise<void>((resolve) => client.once("connect", resolve))));
    const adminEvent = new Promise((resolve) => admin.once("notification:new", resolve));
    let customerEvents = 0;
    customerOne.on("notification:new", () => { customerEvents += 1; });
    customerTwo.on("notification:new", () => { customerEvents += 1; });
    notificationHub.new(adminId, { id: "n1" } as never);
    await adminEvent;
    await new Promise((resolve) => setTimeout(resolve, 20));
    expect(customerEvents).toBe(0);

    const bothTabs = [customerOne, customerTwo].map((client) => new Promise((resolve) => client.once("notification:new", resolve)));
    notificationHub.new(customerId, { id: "n2" } as never);
    await Promise.all(bothTabs);
    customerOne.emit("join", `user:${adminId}`);
    await new Promise((resolve) => setTimeout(resolve, 20));
    const serverSocket = [...fixture.io.sockets.sockets.values()].find((socket) => socket.data.auth.userId === customerId);
    expect(serverSocket?.rooms.has(`user:${adminId}`)).toBe(false);
    await fixture.io.close();
  });
});
