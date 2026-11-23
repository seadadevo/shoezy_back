import type { OrderDetailRecord } from "../../src/modules/orders/orders.types";
import { afterEach, describe, expect, it, vi } from "vitest";
import { env } from "../../src/config/env";
import { adminOrderEmail, customerOrderEmail, resolveEmailImageUrl } from "../../src/modules/orders/order-email.service";
import { NotificationOutboxProcessor } from "../../src/modules/notifications/notifications.worker";

const originalAdminEmail = env.ORDER_NOTIFICATION_EMAIL;
afterEach(() => { env.ORDER_NOTIFICATION_EMAIL = originalAdminEmail; vi.restoreAllMocks(); });

function order(email: string | null, userId: string | null = null): OrderDetailRecord {
  return {
    id: "11111111-1111-4111-8111-111111111111", orderNumber: "SHZ-ABC123", userId,
    customerFirstName: "Amira <script>", customerLastName: "Ben Ali", customerPhone: "+21620123456", customerEmail: email,
    status: "PENDING", paymentMethod: "COD", paymentStatus: "PENDING", currency: "TND",
    placedAt: new Date("2026-09-26T10:00:00Z"), createdAt: new Date("2026-09-26T10:00:00Z"),
    shippingMethodName: "Express & home", subtotalMinor: 20_000n, discountMinor: 1_000n, shippingMinor: 2_500n, totalMinor: 21_500n,
    address: { recipientName: "Amira", phone: "+21620123456", countryCode: "TN", state: "Tunis", city: "Tunis", area: null, line1: "1 <Rue>", line2: null, postalCode: "1000" },
    items: [{
      productId: "prod-1",
      variantId: "var-1",
      productName: "Shoe <bold>",
      variantName: "Size 40",
      sku: "SKU-40",
      quantity: 2,
      unitPriceMinor: 10_000n,
      discountMinor: 1_000n,
      lineTotalMinor: 19_000n,
      snapshotJson: {
        imageUrl: "/uploads/shoes/sneaker.jpg",
        options: [{ option: "Color", value: "Red & blue" }, { option: "Size", value: "40" }],
      },
    }],
  } as unknown as OrderDetailRecord;
}

describe("order email templates", () => {
  it("resolves email image URLs correctly for email clients", () => {
    const origUpload = env.UPLOAD_BASE_URL;
    const origFrontend = env.FRONTEND_URL;
    const origEnvUpload = process.env.UPLOAD_BASE_URL;
    const origEnvFrontend = process.env.FRONTEND_URL;

    delete process.env.UPLOAD_BASE_URL;
    (env as unknown as Record<string, unknown>).UPLOAD_BASE_URL = undefined;
    delete process.env.FRONTEND_URL;
    env.FRONTEND_URL = "https://shoezy.store";

    expect(resolveEmailImageUrl("https://cdn.example.com/pic.jpg")).toBe("https://cdn.example.com/pic.jpg");
    expect(resolveEmailImageUrl("/uploads/shoes/test.webp")).toBe("https://shoezy.store/uploads/shoes/test.webp");
    expect(resolveEmailImageUrl("uploads/shoes/test.webp")).toBe("https://shoezy.store/uploads/shoes/test.webp");
    expect(resolveEmailImageUrl(null)).toBeNull();
    expect(resolveEmailImageUrl("")).toBeNull();

    env.UPLOAD_BASE_URL = "https://api.shoezy.store/uploads";
    expect(resolveEmailImageUrl("/uploads/shoes/test.webp")).toBe("https://api.shoezy.store/uploads/shoes/test.webp");

    env.UPLOAD_BASE_URL = origUpload;
    env.FRONTEND_URL = origFrontend;
    if (origEnvUpload) process.env.UPLOAD_BASE_URL = origEnvUpload;
    if (origEnvFrontend) process.env.FRONTEND_URL = origEnvFrontend;
  });

  it("uses order snapshots, TND millimes, plain text, and luxury HTML", () => {
    const message = adminOrderEmail(order(null), "orders@example.com");
    expect(message.subject).toBe("New Shoezy Order #SHZ-ABC123");
    expect(message.text).toContain("Amira <script> Ben Ali");
    expect(message.text).toContain("+21620123456");
    expect(message.text).toContain("Shoe <bold> / Size 40, color Red & blue");
    expect(message.text).toContain("Total: 21.500 TND");
    expect(message.text).toContain("COD (PENDING)");
    expect(message.text).toContain("/admin/orders?notificationOrder=11111111-1111-4111-8111-111111111111");
    expect(message.html).toContain("&lt;script&gt;");
    expect(message.html).toContain("Shoe &lt;bold&gt;");
    expect(message.html).not.toContain("<script>");
    expect(message.html).not.toContain("<bold>");
    expect(message.html).toContain("SHOEZY");
    expect(message.html).toContain("View Order in Dashboard");
    expect(message.html).toContain("uploads/shoes/sneaker.jpg");
    expect(customerOrderEmail(order(null))).toBeNull();
    const customerMsg = customerOrderEmail(order("amira@example.com"));
    expect(customerMsg?.text).toContain("Current status: PENDING");
    expect(customerMsg?.html).toContain("Thank You for Your Order");
    expect(customerMsg?.html).toContain("Track &amp; View Your Order");
  });
});

describe("order email delivery through the notification outbox", () => {
  it("sends admin for guest orders without customer email and records completion", async () => {
    env.ORDER_NOTIFICATION_EMAIL = "orders@example.com";
    const sent = vi.fn(async () => {});
    const updates: object[] = [];
    const event = { id: "event-1", type: "ORDER_CREATED", entityType: "ORDER", entityId: order(null).id, audience: "ADMIN", recipientPermission: "orders.read.any", adminEmailSentAt: null, customerEmailSentAt: null, attempts: 0 };
    const client = {
      $transaction: async (callback: (tx: unknown) => Promise<unknown>) => callback({ user: { findMany: async () => [] } }),
      order: { findUniqueOrThrow: async () => order(null) },
      notificationOutbox: { update: async (input: { data: object }) => { updates.push(input.data); return {}; } },
    };
    const processor = new NotificationOutboxProcessor(client as never, { send: sent });
    vi.spyOn(processor, "claim").mockResolvedValueOnce([event] as never).mockResolvedValue([]);
    expect(await processor.processBatch()).toBe(1);
    expect(sent).toHaveBeenCalledTimes(1);
    expect(sent).toHaveBeenCalledWith(expect.objectContaining({ to: "orders@example.com" }));
    expect(updates).toEqual([expect.objectContaining({ adminEmailSentAt: expect.any(Date) }), expect.objectContaining({ processedAt: expect.any(Date) })]);
  });

  it("retries only the failed customer send and never logs SMTP error text", async () => {
    env.ORDER_NOTIFICATION_EMAIL = "orders@example.com";
    const sent = vi.fn().mockResolvedValueOnce(undefined).mockRejectedValueOnce(new Error("secret credential text")).mockResolvedValueOnce(undefined);
    const event = { id: "event-2", type: "ORDER_CREATED", entityType: "ORDER", entityId: order("amira@example.com").id, audience: "ADMIN", recipientPermission: "orders.read.any", adminEmailSentAt: null as Date | null, customerEmailSentAt: null as Date | null, attempts: 0 };
    const updates: object[] = [];
    const client = {
      $transaction: async (callback: (tx: unknown) => Promise<unknown>) => callback({ user: { findMany: async () => [] } }),
      order: { findUniqueOrThrow: async () => order("amira@example.com", "user-id") },
      notificationOutbox: { update: async (input: { data: Record<string, unknown> }) => {
        updates.push(input.data);
        if (input.data.adminEmailSentAt) event.adminEmailSentAt = input.data.adminEmailSentAt as Date;
        if (input.data.customerEmailSentAt) event.customerEmailSentAt = input.data.customerEmailSentAt as Date;
        if (input.data.attempts) event.attempts += 1;
        return {};
      } },
    };
    const errorLog = vi.spyOn(console, "error").mockImplementation(() => {});
    const processor = new NotificationOutboxProcessor(client as never, { send: sent });
    const claim = vi.spyOn(processor, "claim").mockResolvedValueOnce([event] as never).mockResolvedValueOnce([]);
    expect(await processor.processBatch()).toBe(0);
    expect(updates).toContainEqual(expect.objectContaining({ attempts: { increment: 1 } }));
    expect(JSON.stringify(updates)).not.toContain("secret credential text");
    expect(JSON.stringify(errorLog.mock.calls)).not.toContain("secret credential text");
    claim.mockResolvedValueOnce([event] as never).mockResolvedValueOnce([]);
    expect(await processor.processBatch()).toBe(1);
    expect(sent).toHaveBeenCalledTimes(3);
    expect(sent.mock.calls.map((call) => call[0].to)).toEqual(["orders@example.com", "amira@example.com", "amira@example.com"]);
    expect(updates).toContainEqual(expect.objectContaining({ customerEmailSentAt: expect.any(Date) }));
  });

  it("stops retrying after the bounded final attempt", async () => {
    env.ORDER_NOTIFICATION_EMAIL = "orders@example.com";
    const event = { id: "event-final", type: "ORDER_CREATED", entityType: "ORDER", entityId: order(null).id, audience: "ADMIN", recipientPermission: "orders.read.any", adminEmailSentAt: null, customerEmailSentAt: null, attempts: 7 };
    const updates: Array<Record<string, unknown>> = [];
    const client = {
      $transaction: async (callback: (tx: unknown) => Promise<unknown>) => callback({ user: { findMany: async () => [] } }),
      order: { findUniqueOrThrow: async () => order(null) },
      notificationOutbox: { update: async (input: { data: Record<string, unknown> }) => { updates.push(input.data); return {}; } },
    };
    const processor = new NotificationOutboxProcessor(client as never, { send: vi.fn(async () => { throw new Error("smtp unavailable"); }) });
    const errorLog = vi.spyOn(console, "error").mockImplementation(() => {});
    vi.spyOn(processor, "claim").mockResolvedValueOnce([event] as never).mockResolvedValueOnce([]);
    expect(await processor.processBatch()).toBe(0);
    expect(updates).toContainEqual(expect.objectContaining({ attempts: { increment: 1 }, processedAt: null, lockedAt: null, lastError: "Notification processing failed (Error)" }));
    expect(JSON.stringify(updates)).not.toContain("smtp unavailable");
    expect(errorLog).toHaveBeenCalledWith("Notification outbox terminal failure", expect.objectContaining({
      eventId: "event-final", eventType: "ORDER_CREATED", attempts: 8, lastError: "Notification processing failed (Error)",
      failedAt: expect.any(String), adminEmailSent: false, customerEmailSent: false,
    }));
  });
});
