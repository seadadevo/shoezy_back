import { describe, expect, it, vi } from "vitest";
import { SupportRepository } from "../../src/modules/support/support.repository";
import { supportToken, supportTokenHash } from "../../src/modules/support/support.security";

const conversationId = "33333333-3333-4333-8333-333333333333";
const adminId = "22222222-2222-4222-8222-222222222222";

function fixture() {
  const token = supportToken();
  const now = new Date("2026-09-27T00:00:00Z");
  const state = {
    id: conversationId, reference: "SUP-ABC", userId: null, guestName: "Ahmed", guestPhone: "+21620123456", guestEmail: null,
    status: "OPEN", guestAccessTokenHash: supportTokenHash(token), adminUnreadCount: 1, customerUnreadCount: 0,
    adminNotificationGeneration: 0, lastMessageAt: now, createdAt: now, updatedAt: now, closedAt: null,
    order: null,
  };
  const dedupKeys: string[] = [];
  let index = 0;
  const tx = {
    $queryRaw: vi.fn(async () => [{ id: conversationId }]),
    supportConversation: {
      findUnique: vi.fn(async () => ({ ...state })),
      update: vi.fn(async ({ data }: { data: Record<string, unknown> }) => {
        for (const [key, value] of Object.entries(data)) {
          if (typeof value === "object" && value !== null && "increment" in value) {
            (state as unknown as Record<string, number>)[key] += value.increment as number;
          } else (state as unknown as Record<string, unknown>)[key] = value;
        }
        return { ...state };
      }),
    },
    supportMessage: { create: vi.fn(async ({ data }: { data: { senderType: string; body: string; createdAt: Date } }) => ({
      id: `message-${++index}`, conversationId, senderType: data.senderType, body: data.body, createdAt: data.createdAt,
    })) },
    notificationOutbox: { upsert: vi.fn(async ({ where }: { where: { deduplicationKey: string } }) => { dedupKeys.push(where.deduplicationKey); return {}; }) },
  };
  const client = { $transaction: async (callback: (value: unknown) => Promise<unknown>) => callback(tx) };
  return { store: new SupportRepository(client as never), state, token, dedupKeys, tx };
}

describe("support unread cycles", () => {
  it("creates a guest request and outbox entry together while storing only the token hash", async () => {
    let stored: Record<string, unknown> = {};
    const upsert = vi.fn(async () => ({}));
    const transaction = {
      supportConversation: { create: vi.fn(async ({ data }: { data: Record<string, unknown> }) => {
        stored = data;
        const time = new Date();
        return { ...data, id: conversationId, status: "OPEN", adminUnreadCount: 1, customerUnreadCount: 0,
          lastMessageAt: time, createdAt: time, updatedAt: time, closedAt: null, order: null };
      }) },
      supportMessage: { create: vi.fn(async ({ data }: { data: { body: string; createdAt: Date } }) => ({
        id: "message-id", conversationId, senderType: "CUSTOMER", body: data.body, createdAt: data.createdAt,
      })) },
      notificationOutbox: { upsert },
    };
    const client = { $transaction: async (callback: (value: unknown) => Promise<unknown>) => callback(transaction) };
    const store = new SupportRepository(client as never);
    const created = await store.create({ name: "Ahmed", phone: "+21620123456", message: "Help" });
    expect(created.supportAccessToken).toBeTruthy();
    expect(stored.guestAccessTokenHash).toBe(supportTokenHash(created.supportAccessToken!));
    expect(JSON.stringify(stored)).not.toContain(created.supportAccessToken!);
    expect(upsert).toHaveBeenCalledWith(expect.objectContaining({ where: { deduplicationKey: `support:${conversationId}:admin:0` } }));
    expect(created.initialMessage.body).toBe("Help");
    expect(created.initialMessage.senderDisplayName).toBe("Ahmed");
    await expect(store.create({ phone: "+21620123456", message: "Help" })).rejects.toMatchObject({ code: "SUPPORT_CONTACT_REQUIRED" });
    await expect(store.create({ name: "Ahmed", message: "Help" })).rejects.toMatchObject({ code: "SUPPORT_CONTACT_REQUIRED" });
  });

  it("queues once after admin read, suppresses repeats, and resets customer unread after reply", async () => {
    const { store, state, token, dedupKeys, tx } = fixture();
    await store.send(conversationId, "Before read", { guestToken: token });
    expect(state.adminUnreadCount).toBe(2);
    expect(dedupKeys).toEqual([]);
    await store.read(conversationId, { adminId });
    expect(state.adminUnreadCount).toBe(0);
    expect(state.adminNotificationGeneration).toBe(1);
    await store.send(conversationId, "After read", { guestToken: token });
    await store.send(conversationId, "Still unread", { guestToken: token });
    expect(dedupKeys).toEqual([`support:${conversationId}:admin:1`]);
    expect(state.adminUnreadCount).toBe(2);
    expect((await store.send(conversationId, "Admin response", { adminId })).senderDisplayName).toBe("Shoozy Support");
    expect(state.customerUnreadCount).toBe(1);
    expect(state.status).toBe("PENDING");
    await store.read(conversationId, { guestToken: token });
    expect(state.customerUnreadCount).toBe(0);
    expect(tx.supportMessage.create.mock.calls.at(-1)?.[0].data.senderType).toBe("ADMIN");
    await store.read(conversationId, { adminId });
    await store.send(conversationId, "Next cycle", { guestToken: token });
    expect(dedupKeys).toEqual([`support:${conversationId}:admin:1`, `support:${conversationId}:admin:2`]);
  });

  it("rejects wrong guest token and closed customer messages", async () => {
    const { store, token } = fixture();
    await expect(store.send(conversationId, "Denied", { guestToken: supportToken() })).rejects.toMatchObject({ code: "SUPPORT_NOT_FOUND" });
    await store.status(conversationId, "CLOSED");
    await expect(store.send(conversationId, "Denied", { guestToken: token })).rejects.toMatchObject({ code: "SUPPORT_CONVERSATION_CLOSED" });
    await expect(store.status(conversationId, "PENDING")).rejects.toMatchObject({ code: "SUPPORT_INVALID_STATUS_TRANSITION" });
    await store.status(conversationId, "OPEN");
    expect((await store.send(conversationId, "Allowed", { guestToken: token })).body).toBe("Allowed");
  });
});
