import { randomUUID } from "node:crypto";
import { PrismaPg } from "@prisma/adapter-pg";
import { PrismaClient } from "@prisma/client";
import { afterAll, describe, expect, it } from "vitest";
import { SupportRepository } from "../../src/modules/support/support.repository";
import { supportTokenHash } from "../../src/modules/support/support.security";

const testDatabaseUrl = process.env.TEST_DATABASE_URL;
const describeDatabase = testDatabaseUrl ? describe : describe.skip;

describeDatabase("support persistence and unread-cycle deduplication in disposable PostgreSQL", () => {
  if (!testDatabaseUrl) return;
  const name = new URL(testDatabaseUrl).pathname.slice(1);
  if (name !== "shoe_store_tasks13_26_validation") throw new Error(`Unsafe TEST_DATABASE_URL database: ${name}`);
  const prisma = new PrismaClient({ adapter: new PrismaPg({ connectionString: testDatabaseUrl }) });
  const store = new SupportRepository(prisma);
  afterAll(async () => { await prisma.$disconnect(); });

  it("persists secure guest messages, rejects cross-token access, and queues one email per unread cycle under concurrency", async () => {
    const created: string[] = [];
    try {
      const first = await store.create({ name: "Guest One", phone: "+216 20 123 456", message: "First" });
      created.push(first.id);
      const second = await store.create({ name: "Guest Two", phone: "+216 20 999 999", message: "Second" });
      created.push(second.id);
      const raw = first.supportAccessToken!;
      const row = await prisma.supportConversation.findUniqueOrThrow({ where: { id: first.id } });
      expect(row.guestAccessTokenHash).toBe(supportTokenHash(raw));
      expect(JSON.stringify(row)).not.toContain(raw);
      await expect(store.get(second.id, { guestToken: raw })).rejects.toMatchObject({ code: "SUPPORT_NOT_FOUND" });
      await expect(store.get(first.id, { guestToken: "wrong" })).rejects.toMatchObject({ code: "SUPPORT_NOT_FOUND" });
      expect((await store.get(first.id, { guestToken: raw })).id).toBe(first.id);
      await Promise.all([store.send(first.id, "More one", { guestToken: raw }), store.send(first.id, "More two", { guestToken: raw })]);
      expect((await prisma.supportConversation.findUniqueOrThrow({ where: { id: first.id } })).adminUnreadCount).toBe(3);
      expect(await prisma.notificationOutbox.count({ where: { deduplicationKey: { startsWith: `support:${first.id}:admin:` } } })).toBe(1);
      await store.read(first.id, { adminId: randomUUID() });
      expect((await prisma.supportConversation.findUniqueOrThrow({ where: { id: first.id } })).adminUnreadCount).toBe(0);
      await Promise.all([store.send(first.id, "Next cycle one", { guestToken: raw }), store.send(first.id, "Next cycle two", { guestToken: raw })]);
      expect(await prisma.notificationOutbox.count({ where: { deduplicationKey: { startsWith: `support:${first.id}:admin:` } } })).toBe(2);
      const messages = await store.messages(first.id, { page: 1, limit: 20 }, { guestToken: raw });
      expect(messages.items).toHaveLength(5);
      expect(messages.items.map((item) => item.body).sort()).toEqual(["First", "More one", "More two", "Next cycle one", "Next cycle two"].sort());
      await store.status(first.id, "CLOSED");
      await expect(store.send(first.id, "After close", { guestToken: raw })).rejects.toMatchObject({ code: "SUPPORT_CONVERSATION_CLOSED" });
      await store.status(first.id, "OPEN");
    } finally {
      await prisma.notificationOutbox.deleteMany({ where: { OR: created.map((id) => ({ deduplicationKey: { startsWith: `support:${id}:admin:` } })) } });
      await prisma.supportConversation.deleteMany({ where: { id: { in: created } } });
    }
  });

  it("checks account ownership and guest order snapshots without changing orders", async () => {
    const userId = randomUUID();
    const otherId = randomUUID();
    const ownNumber = `SHZ-${randomUUID().replaceAll("-", "").slice(0, 24).toUpperCase()}`;
    const guestNumber = `SHZ-${randomUUID().replaceAll("-", "").slice(0, 24).toUpperCase()}`;
    const conversationIds: string[] = [];
    try {
      await prisma.user.createMany({ data: [
        { id: userId, email: `${userId}@example.com`, firstName: "Ahmed", lastName: "Ali", phone: "+21620123456" },
        { id: otherId, email: `${otherId}@example.com`, firstName: "Other", lastName: "Buyer", phone: "+21620999999" },
      ] });
      await prisma.order.createMany({ data: [
        { orderNumber: ownNumber, userId, customerPhone: "+21620123456", subtotalMinor: 1000n, totalMinor: 1000n },
        { orderNumber: guestNumber, customerPhone: "+216 21 123 456", subtotalMinor: 2000n, totalMinor: 2000n },
      ] });
      const before = await prisma.order.findMany({ where: { orderNumber: { in: [ownNumber, guestNumber] } }, select: { id: true, updatedAt: true } });
      const own = await store.create({ message: "My order", orderNumber: ownNumber }, userId);
      conversationIds.push(own.id);
      expect(own).not.toHaveProperty("supportAccessToken");
      expect((await prisma.supportConversation.findUniqueOrThrow({ where: { id: own.id } })).userId).toBe(userId);
      await expect(store.get(own.id, { userId: otherId })).rejects.toMatchObject({ code: "SUPPORT_NOT_FOUND" });
      await expect(store.create({ message: "Wrong owner", orderNumber: ownNumber }, otherId)).rejects.toMatchObject({ code: "SUPPORT_ORDER_NOT_VERIFIED" });
      await expect(store.create({ name: "Guest", phone: "+21621999999", message: "Wrong phone", orderNumber: guestNumber })).rejects.toMatchObject({ code: "SUPPORT_ORDER_NOT_VERIFIED" });
      await expect(store.create({ name: "Guest", phone: "+21621999999", message: "Unknown", orderNumber: "SHZ-UNKNOWN" })).rejects.toMatchObject({ code: "SUPPORT_ORDER_NOT_VERIFIED" });
      const guest = await store.create({ name: "Guest", phone: "+21621123456", message: "My guest order", orderNumber: guestNumber });
      conversationIds.push(guest.id);
      const ownOrderId = (await prisma.supportConversation.findUniqueOrThrow({ where: { id: own.id } })).orderId;
      expect((await prisma.supportConversation.findUniqueOrThrow({ where: { id: guest.id } })).orderId).toBe(before.find((item) => item.id !== ownOrderId)?.id);
      const adminReply = await store.send(guest.id, "We can help", { adminId: otherId });
      expect(adminReply.senderType).toBe("ADMIN");
      expect((await prisma.supportConversation.findUniqueOrThrow({ where: { id: guest.id } })).customerUnreadCount).toBe(1);
      await store.read(guest.id, { guestToken: guest.supportAccessToken! });
      expect((await prisma.supportConversation.findUniqueOrThrow({ where: { id: guest.id } })).customerUnreadCount).toBe(0);
      const after = await prisma.order.findMany({ where: { orderNumber: { in: [ownNumber, guestNumber] } }, select: { id: true, updatedAt: true } });
      expect(after).toEqual(before);
    } finally {
      await prisma.notificationOutbox.deleteMany({ where: { OR: conversationIds.map((id) => ({ deduplicationKey: { startsWith: `support:${id}:admin:` } })) } });
      await prisma.supportConversation.deleteMany({ where: { id: { in: conversationIds } } });
      await prisma.order.deleteMany({ where: { orderNumber: { in: [ownNumber, guestNumber] } } });
      await prisma.user.deleteMany({ where: { id: { in: [userId, otherId] } } });
    }
  });
});
