import type { RequestHandler } from "express";
import request from "supertest";
import { beforeEach, describe, expect, it, vi } from "vitest";
import { createApp } from "../../src/app";
import { CartsService } from "../../src/modules/carts/carts.service";
import { CheckoutService } from "../../src/modules/checkout/checkout.service";
import { OrdersService } from "../../src/modules/orders/orders.service";

vi.mock("../../src/common/middlewares/auth.middleware", async () => {
  const { AppError } = await import("../../src/common/errors/app-error.js");
  const requireAuth: RequestHandler = (req, _res, next) => req.headers.authorization ? next() : next(new AppError(401, "Authentication required", "AUTH_UNAUTHORIZED"));
  return { requireAuth, createRequireAuth: vi.fn() };
});

const app = createApp();
const tokenA = "A".repeat(43);
const tokenB = "B".repeat(43);
const orderToken = "C".repeat(43);
const variantId = "22222222-2222-4222-8222-222222222222";
const shippingMethodId = "33333333-3333-4333-8333-333333333333";
const orderNumber = `SHZ-${"A".repeat(24)}`;
const address = { firstName: "Amira", lastName: "Ben Ali", phone: "20123456", addressLine1: "Rue 1", city: "Tunis", state: "Tunis", shippingMethodId };

describe("guest commerce routes", () => {
  beforeEach(() => {
    vi.restoreAllMocks();
    vi.spyOn(CartsService.prototype, "createGuestSession").mockResolvedValue(tokenA);
    vi.spyOn(CartsService.prototype, "validGuestSession").mockResolvedValue(true);
    vi.spyOn(CartsService.prototype, "get").mockImplementation(async (owner) => ({ id: typeof owner === "string" ? owner : owner.sessionToken, items: [] }) as never);
    vi.spyOn(CartsService.prototype, "addItem").mockImplementation(async (owner) => ({ id: typeof owner === "string" ? owner : owner.sessionToken, items: [] }) as never);
    vi.spyOn(CartsService.prototype, "addFirstGuestItem").mockResolvedValue({ sessionToken: tokenA, cart: { id: tokenA, items: [] } } as never);
    vi.spyOn(CheckoutService.prototype, "previewGuest").mockResolvedValue({ totals: { grandTotalMinor: "12000" }, shippingZone: { code: "TUNIS" } } as never);
    vi.spyOn(OrdersService.prototype, "placeGuest").mockResolvedValue({ order: { orderNumber, paymentMethod: "COD", paymentStatus: "PENDING" }, idempotentReplay: false, guestAccessToken: orderToken, whatsappConfirmation: { enabled: true, url: "https://wa.me/21620000000" } } as never);
    vi.spyOn(OrdersService.prototype, "getGuest").mockResolvedValue({ orderNumber } as never);
  });

  it("issues an opaque session and keeps guest and authenticated routes separate", async () => {
    const session = await request(app).post("/api/v1/guest/cart/session").send({});
    expect(session.status).toBe(201);
    expect(session.body.data.sessionToken).toBe(tokenA);
    expect((await request(app).get("/api/v1/cart")).status).toBe(401);
    expect((await request(app).get("/api/v1/guest/cart")).status).toBe(401);
    const first = await request(app).get("/api/v1/guest/cart").set("X-Guest-Session", tokenA);
    const second = await request(app).get("/api/v1/guest/cart").set("X-Guest-Session", tokenB);
    expect(first.body.data.id).toBe(tokenA);
    expect(second.body.data.id).toBe(tokenB);
    expect(CartsService.prototype.get).toHaveBeenCalledWith({ sessionToken: tokenB });
  });

  it("rejects client supplied prices and shipping totals", async () => {
    expect((await request(app).post("/api/v1/guest/cart/items").set("X-Guest-Session", tokenA).send({ variantId, quantity: 1, unitPriceMinor: "1" })).status).toBe(422);
    expect((await request(app).post("/api/v1/guest/checkout/preview").set("X-Guest-Session", tokenA).send({ ...address, shippingMinor: "0" })).status).toBe(422);
    expect((await request(app).post("/api/v1/guest/orders").set("X-Guest-Session", tokenA).set("Idempotency-Key", "guest-order-123456").send({ ...address, totalMinor: "1" })).status).toBe(422);
    expect(OrdersService.prototype.placeGuest).not.toHaveBeenCalled();
  });

  it("adds the first item without a separate session request and rejects expired tokens", async () => {
    const first = await request(app).post("/api/v1/guest/cart/items").send({ variantId, quantity: 1 });
    expect(first.status).toBe(201);
    expect(first.body.data.sessionToken).toBe(tokenA);
    const next = await request(app).post("/api/v1/guest/cart/items").set("X-Guest-Session", tokenA).send({ variantId, quantity: 1 });
    expect(next.status).toBe(201);
    expect(CartsService.prototype.addItem).toHaveBeenCalledWith({ sessionToken: tokenA }, { variantId, quantity: 1 });
    vi.mocked(CartsService.prototype.validGuestSession).mockResolvedValue(false);
    expect((await request(app).get("/api/v1/guest/cart").set("X-Guest-Session", tokenA)).status).toBe(401);
  });

  it("uses the same preview and order response shape with normalized Tunisian contact", async () => {
    const preview = await request(app).post("/api/v1/guest/checkout/preview").set("X-Guest-Session", tokenA).send(address);
    expect(preview.status).toBe(200);
    expect(preview.body.data.shippingZone.code).toBe("TUNIS");
    expect(CheckoutService.prototype.previewGuest).toHaveBeenCalledWith(tokenA, expect.objectContaining({ phone: "+21620123456", countryCode: "TN" }));
    const placed = await request(app).post("/api/v1/guest/orders").set("X-Guest-Session", tokenA).set("Idempotency-Key", "guest-order-123456").send(address);
    expect(placed.status).toBe(201);
    expect(placed.body.data).toMatchObject({ order: { paymentMethod: "COD", paymentStatus: "PENDING" }, guestAccessToken: orderToken, whatsappConfirmation: { enabled: true } });
  });

  it("accepts optional email forms and requires guest contact and address", async () => {
    const post = (body: object) => request(app).post("/api/v1/guest/orders").set("X-Guest-Session", tokenA).set("Idempotency-Key", "guest-order-123456").send(body);
    for (const email of [undefined, null, "", "amira@example.com"]) {
      const response = await post({ ...address, ...(email === undefined ? {} : { email }) });
      expect(response.status).toBe(201);
      const supplied = vi.mocked(OrdersService.prototype.placeGuest).mock.lastCall?.[2];
      expect(supplied?.email).toBe(email === "" ? null : email);
    }
    for (const invalid of [
      { ...address, firstName: "" }, { ...address, lastName: "" }, { ...address, phone: "" },
      { ...address, addressLine1: "" }, { ...address, city: "" }, { ...address, state: "" },
      { ...address, email: "not-an-email" },
    ]) expect((await post(invalid)).status).toBe(422);
  });

  it("requires an opaque order token for guest lookup", async () => {
    expect((await request(app).get(`/api/v1/guest/orders/${orderNumber}`)).status).toBe(401);
    expect((await request(app).get(`/api/v1/guest/orders/${orderNumber}`).set("X-Guest-Order-Token", "invalid")).status).toBe(401);
    const found = await request(app).get(`/api/v1/guest/orders/${orderNumber}`).set("X-Guest-Order-Token", orderToken);
    expect(found.status).toBe(200);
    expect(OrdersService.prototype.getGuest).toHaveBeenCalledWith(orderNumber, orderToken);
  });
});
