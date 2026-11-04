import { afterEach, describe, expect, it, vi } from "vitest";
import { env } from "../../src/config/env";
import { NotificationOutboxProcessor } from "../../src/modules/notifications/notifications.worker";

const originalSupport = env.SUPPORT_NOTIFICATION_EMAIL;
const originalOrder = env.ORDER_NOTIFICATION_EMAIL;
afterEach(() => { env.SUPPORT_NOTIFICATION_EMAIL = originalSupport; env.ORDER_NOTIFICATION_EMAIL = originalOrder; vi.restoreAllMocks(); });

function fixture() {
  const event = { id: "event", type: "SUPPORT_REQUEST", entityType: "SUPPORT_MESSAGE", entityId: "message", audience: "ADMIN", recipientPermission: "support.read.any", deduplicationKey: "support:conversation:admin:0", adminEmailSentAt: null as Date | null, attempts: 0 };
  const updates: Record<string, unknown>[] = [];
  const client = {
    $transaction: async (work: (tx: unknown) => Promise<unknown>) => work({ user: { findMany: async () => [] } }),
    supportMessage: { findUniqueOrThrow: vi.fn(async () => ({ body: "Help", createdAt: new Date("2026-09-27T00:00:00Z"), conversation: {
      id: "11111111-1111-4111-8111-111111111111", reference: "SUP-ABC", guestName: "Ahmed", guestPhone: "+21620123456", guestEmail: null, userId: null, status: "OPEN", order: null,
    } })) },
    notificationOutbox: { update: vi.fn(async ({ data }: { data: Record<string, unknown> }) => {
      updates.push(data);
      if (data.adminEmailSentAt) event.adminEmailSentAt = data.adminEmailSentAt as Date;
      if (data.attempts) event.attempts += 1;
      return {};
    }) },
  };
  return { client, event, updates };
}

describe("support email through existing outbox worker", () => {
  it("uses support recipient, records delivery, and does not resend delivered email", async () => {
    env.SUPPORT_NOTIFICATION_EMAIL = "support@example.com";
    env.ORDER_NOTIFICATION_EMAIL = "orders@example.com";
    const { client, event, updates } = fixture();
    const send = vi.fn(async () => {});
    const worker = new NotificationOutboxProcessor(client as never, { send });
    vi.spyOn(worker, "claim").mockResolvedValueOnce([event] as never).mockResolvedValueOnce([]);
    expect(await worker.processBatch()).toBe(1);
    expect(send).toHaveBeenCalledWith(expect.objectContaining({ to: "support@example.com", subject: "New Shoozy Support Request #SUP-ABC" }));
    expect(send).toHaveBeenCalledWith(expect.objectContaining({ text: expect.stringContaining("/admin/support?conversation=11111111-1111-4111-8111-111111111111") }));
    expect(updates).toContainEqual(expect.objectContaining({ adminEmailSentAt: expect.any(Date) }));
    vi.spyOn(worker, "claim").mockResolvedValueOnce([event] as never).mockResolvedValueOnce([]);
    expect(await worker.processBatch()).toBe(1);
    expect(send).toHaveBeenCalledTimes(1);
  });

  it("falls back to order inbox, retries SMTP failure, and hides SMTP error text", async () => {
    env.SUPPORT_NOTIFICATION_EMAIL = undefined;
    env.ORDER_NOTIFICATION_EMAIL = "orders@example.com";
    const { client, event, updates } = fixture();
    event.deduplicationKey = "support:conversation:admin:1";
    const send = vi.fn().mockRejectedValueOnce(new Error("secret SMTP password")).mockResolvedValueOnce(undefined);
    const log = vi.spyOn(console, "error").mockImplementation(() => {});
    const worker = new NotificationOutboxProcessor(client as never, { send });
    vi.spyOn(worker, "claim").mockResolvedValueOnce([event] as never).mockResolvedValueOnce([]);
    expect(await worker.processBatch()).toBe(0);
    expect(updates).toContainEqual(expect.objectContaining({ attempts: { increment: 1 }, lockedAt: null }));
    expect(JSON.stringify(log.mock.calls)).not.toContain("secret SMTP password");
    vi.spyOn(worker, "claim").mockResolvedValueOnce([event] as never).mockResolvedValueOnce([]);
    expect(await worker.processBatch()).toBe(1);
    expect(send).toHaveBeenCalledTimes(2);
    expect(send).toHaveBeenCalledWith(expect.objectContaining({ to: "orders@example.com", subject: "New Shoozy Support Message #SUP-ABC" }));
  });
});
