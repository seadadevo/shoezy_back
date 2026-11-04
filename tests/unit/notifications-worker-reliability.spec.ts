import { afterEach, describe, expect, it, vi } from "vitest";
import { MAX_NOTIFICATION_ATTEMPTS, notificationRetryDelaySeconds } from "../../src/modules/notifications/notifications.policy";
import { requeueExhaustedNotification } from "../../src/modules/notifications/notifications.recovery";
import { NotificationOutboxProcessor } from "../../src/modules/notifications/notifications.worker";

afterEach(() => {
  vi.useRealTimers();
  vi.restoreAllMocks();
});

function retryFixture(attempts: number) {
  const updates: Array<Record<string, unknown>> = [];
  const client = {
    notificationOutbox: {
      update: vi.fn(async ({ data }: { data: Record<string, unknown> }) => {
        updates.push(data);
        return {};
      }),
    },
  };
  const event = {
    id: `event-${attempts}`,
    type: "ORDER_CREATED",
    attempts,
    adminEmailSentAt: null,
    customerEmailSentAt: null,
  };
  const worker = new NotificationOutboxProcessor(client as never, { send: vi.fn() });
  const retry = (worker as unknown as {
    retry: (value: unknown, error: unknown) => Promise<{ attempts: number; terminal: boolean; lastError: string; failedAt: Date }>;
  }).retry.bind(worker);
  return { event, retry, updates };
}

describe("notification outbox retry policy", () => {
  it.each([0, 1, 2, 3, 4, 5, 6])("keeps failure from attempt %i retryable with bounded backoff", async (previousAttempts) => {
    const now = new Date("2026-10-10T10:00:00.000Z");
    vi.useFakeTimers();
    vi.setSystemTime(now);
    const { event, retry, updates } = retryFixture(previousAttempts);

    const result = await retry(event, Object.assign(new Error("secret SMTP response"), { name: "SMTPError" }));

    expect(result).toMatchObject({ attempts: previousAttempts + 1, terminal: false, lastError: "Notification processing failed (SMTPError)" });
    expect(updates).toEqual([expect.objectContaining({
      attempts: { increment: 1 },
      processedAt: null,
      lockedAt: null,
      lastError: "Notification processing failed (SMTPError)",
      availableAt: new Date(now.getTime() + notificationRetryDelaySeconds(previousAttempts + 1) * 1000),
    })]);
    expect(JSON.stringify(updates)).not.toContain("secret SMTP response");
  });

  it("caps the retry delay", () => {
    expect(notificationRetryDelaySeconds(1)).toBe(2);
    expect(notificationRetryDelaySeconds(1_000)).toBe(256);
    expect(notificationRetryDelaySeconds(1_000)).toBeLessThanOrEqual(300);
  });

  it("keeps the eighth failure terminal, visible, unlocked, and unprocessed", async () => {
    const now = new Date("2026-10-10T10:00:00.000Z");
    vi.useFakeTimers();
    vi.setSystemTime(now);
    const { event, retry, updates } = retryFixture(MAX_NOTIFICATION_ATTEMPTS - 1);

    const result = await retry(event, new Error("must not be persisted"));

    expect(result).toMatchObject({ attempts: MAX_NOTIFICATION_ATTEMPTS, terminal: true, lastError: "Notification processing failed (Error)", failedAt: now });
    expect(updates).toEqual([expect.objectContaining({
      attempts: { increment: 1 },
      processedAt: null,
      lockedAt: null,
      lastError: "Notification processing failed (Error)",
      availableAt: now,
    })]);
    expect(JSON.stringify(updates)).not.toContain("must not be persisted");
  });

  it("claims only non-exhausted rows while retaining concurrent worker safety", async () => {
    const queryRaw = vi.fn(async () => []);
    const client = { $transaction: async (work: (transaction: unknown) => Promise<unknown>) => work({ $queryRaw: queryRaw }) };
    const worker = new NotificationOutboxProcessor(client as never, { send: vi.fn() });

    expect(await worker.claim(17)).toEqual([]);

    const [strings, ...parameters] = queryRaw.mock.calls[0] as unknown as [TemplateStringsArray, ...unknown[]];
    const sql = strings.join("?");
    expect(sql).toContain('"attempts" < ?');
    expect(sql).toContain("FOR UPDATE SKIP LOCKED");
    expect(sql).toContain("INTERVAL '5 minutes'");
    expect(sql).toContain('ORDER BY "created_at", "id"');
    expect(parameters).toEqual([MAX_NOTIFICATION_ATTEMPTS, 17]);
  });

  it("marks successful work processed and clears its previous error", async () => {
    const updates: Array<Record<string, unknown>> = [];
    const event = {
      id: "event-success", type: "LOW_STOCK", entityType: "PRODUCT_VARIANT", entityId: "variant",
      audience: "USER", recipientUserId: null, recipientPermission: null, deduplicationKey: "low-stock:variant:1",
      templateKey: "low-stock", templateParams: {}, metadata: null, createdAt: new Date(), attempts: 2,
      lastError: "Notification processing failed (Error)", adminEmailSentAt: null, customerEmailSentAt: null,
    };
    const client = {
      $transaction: async (work: (transaction: unknown) => Promise<unknown>) => work({}),
      notificationOutbox: { update: vi.fn(async ({ data }: { data: Record<string, unknown> }) => { updates.push(data); return {}; }) },
    };
    const worker = new NotificationOutboxProcessor(client as never, { send: vi.fn() });
    vi.spyOn(worker, "claim").mockResolvedValueOnce([event] as never).mockResolvedValue([]);

    expect(await worker.processBatch()).toBe(1);
    expect(updates).toEqual([expect.objectContaining({ processedAt: expect.any(Date), lockedAt: null, lastError: null })]);
  });
});

describe("manual notification recovery", () => {
  it("requeues one eligible event without erasing delivery timestamps or deduplication state", async () => {
    const adminEmailSentAt = new Date("2026-10-09T10:00:00.000Z");
    const customerEmailSentAt = new Date("2026-10-09T10:01:00.000Z");
    const availableAt = new Date("2026-10-10T11:00:00.000Z");
    const updateMany = vi.fn(async (_input: { data: Record<string, unknown> }) => ({ count: 1 }));
    const transaction = {
      notificationOutbox: {
        findUnique: vi.fn(async () => ({
          id: "11111111-1111-4111-8111-111111111111", type: "ORDER_CREATED", attempts: 8,
          processedAt: null, lockedAt: null, lastError: "Notification processing failed (SMTPError)",
          adminEmailSentAt, customerEmailSentAt,
        })),
        updateMany,
      },
    };
    const client = { $transaction: async (work: (value: unknown) => Promise<unknown>) => work(transaction) };

    const result = await requeueExhaustedNotification(client as never, "11111111-1111-4111-8111-111111111111", availableAt);

    expect(result).toMatchObject({ adminEmailSent: true, customerEmailSent: true, previousAttempts: 8, availableAt });
    expect(updateMany).toHaveBeenCalledWith({
      where: { id: "11111111-1111-4111-8111-111111111111", processedAt: null, attempts: { gte: 8 }, lockedAt: null },
      data: { attempts: 0, availableAt, lockedAt: null },
    });
    const update = updateMany.mock.calls[0]![0];
    expect(update.data).not.toHaveProperty("adminEmailSentAt");
    expect(update.data).not.toHaveProperty("customerEmailSentAt");
    expect(update.data).not.toHaveProperty("deduplicationKey");
  });

  it.each([
    ["processed", { attempts: 8, processedAt: new Date(), lockedAt: null }],
    ["not exhausted", { attempts: 7, processedAt: null, lockedAt: null }],
    ["locked", { attempts: 8, processedAt: null, lockedAt: new Date() }],
  ])("rejects an event that is %s", async (_label, state) => {
    const transaction = { notificationOutbox: {
      findUnique: vi.fn(async () => ({ id: "event", type: "ORDER_CREATED", lastError: null, adminEmailSentAt: null, customerEmailSentAt: null, ...state })),
      updateMany: vi.fn(),
    } };
    const client = { $transaction: async (work: (value: unknown) => Promise<unknown>) => work(transaction) };
    await expect(requeueExhaustedNotification(client as never, "event")).rejects.toThrow();
    expect(transaction.notificationOutbox.updateMany).not.toHaveBeenCalled();
  });
});
