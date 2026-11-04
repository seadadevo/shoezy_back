import { describe, expect, it, vi } from "vitest";
import { env } from "../../src/config/env";
import { StoreSettingsService } from "../../src/modules/store-settings/store-settings.service";
import { updateStoreSettingsSchema } from "../../src/modules/store-settings/store-settings.validation";

const persisted = {
  id: 1,
  storeName: "Shoozy",
  countryCode: "TN",
  currency: "TND",
  currencyMinorUnit: 3,
  whatsappNumber: null,
  supportPhone: "+21670000000",
  supportEmail: "support@example.com",
  shippingPolicy: "Delivery across Tunisia",
  returnWindowDays: 14,
  exchangeWindowDays: 14,
  whatsappConfirmationEnabled: false,
  createdAt: new Date(),
  updatedAt: new Date(),
};

describe("admin store settings", () => {
  it("loads persisted values without exposing environment-managed secrets", async () => {
    const repository = { get: vi.fn(async () => persisted), update: vi.fn() };
    const result = await new StoreSettingsService(repository as never).getAdmin();
    expect(result).toMatchObject({ storeName: "Shoozy", supportEmail: "support@example.com" });
    expect(result).not.toHaveProperty("SMTP_PASSWORD");
    expect(JSON.stringify(result)).not.toContain(env.SMTP_PASSWORD ?? "never-present-secret");
  });

  it("passes only the validated partial update and actor to persistent storage", async () => {
    const update = vi.fn(async () => ({ ...persisted, storeName: "Shoozy TN" }));
    const service = new StoreSettingsService({ get: vi.fn(), update } as never);
    await service.update({ storeName: "Shoozy TN" }, "admin-id");
    expect(update).toHaveBeenCalledWith({ storeName: "Shoozy TN" }, "admin-id");
  });

  it("rejects unsupported, invalid, and empty setting patches", () => {
    const parse = (body: unknown) => updateStoreSettingsSchema.safeParse({ body, params: {}, query: {} }).success;
    expect(parse({ supportEmail: "not-an-email" })).toBe(false);
    expect(parse({ smtpPassword: "secret" })).toBe(false);
    expect(parse({})).toBe(false);
  });
});

