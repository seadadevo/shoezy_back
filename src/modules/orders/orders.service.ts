import { AppError } from "../../common/errors/app-error";
import { toOrderDetailDto, toOrderListDto } from "./orders.dto";
import { OrdersRepository } from "./orders.repository";
import { WhatsAppOrderService } from "./whatsapp-order.service";
import { SmtpOrderEmailSender, adminOrderEmail, customerOrderEmail } from "./order-email.service";
import { env } from "../../config/env";
import type { OrderStatus } from "@prisma/client";
import type { CreateOrderInput, ListAdminOrdersQuery, ListOwnOrdersQuery, OrderTransitionInput, ShipOrderInput } from "./orders.validation";
import type { GuestCreateOrderInput } from "../checkout/guest-checkout.validation";
import type { PlaceOrderResult, OrderDetailRecord } from "./orders.types";
export const ORDER_TRANSITIONS: Readonly<Record<"CUSTOMER_CANCEL" | "ADMIN_CONFIRM" | "ADMIN_CANCEL" | "ADMIN_SHIP" | "ADMIN_DELIVER", { target: OrderStatus; allowedFrom: readonly OrderStatus[] }>> = {
  CUSTOMER_CANCEL: { target: "CANCELLED", allowedFrom: ["PENDING", "CONFIRMED"] },
  ADMIN_CONFIRM: { target: "CONFIRMED", allowedFrom: ["PENDING"] },
  ADMIN_CANCEL: { target: "CANCELLED", allowedFrom: ["PENDING", "CONFIRMED"] },
  ADMIN_SHIP: { target: "SHIPPED", allowedFrom: ["CONFIRMED"] },
  ADMIN_DELIVER: { target: "DELIVERED", allowedFrom: ["SHIPPED"] },
};
const emailSender = new SmtpOrderEmailSender();

async function sendOrderEmails(rawOrder: OrderDetailRecord) {
  try {
    if (env.ORDER_NOTIFICATION_EMAIL) {
      const msg = adminOrderEmail(rawOrder, env.ORDER_NOTIFICATION_EMAIL);
      await emailSender.send(msg);
    }
  } catch (err) {
    console.error("[OrderEmail] Failed to send admin notification email:", err);
  }
  try {
    const msg = customerOrderEmail(rawOrder);
    if (msg) await emailSender.send(msg);
  } catch (err) {
    console.error("[OrderEmail] Failed to send customer confirmation email:", err);
  }
}

export class OrdersService {
  constructor(private readonly repository = new OrdersRepository(), private readonly whatsApp = new WhatsAppOrderService()) {}
  async place(userId: string, idempotencyKey: string, input: CreateOrderInput, now = new Date()) {
    return this.toPlaceResult(await this.repository.place(userId, idempotencyKey, input, now));
  }
  async placeGuest(sessionToken: string, idempotencyKey: string, input: GuestCreateOrderInput, now = new Date()) {
    return this.toPlaceResult(await this.repository.placeGuest(sessionToken, idempotencyKey, input, now), true);
  }
  private async toPlaceResult(result: PlaceOrderResult, guest = false) {
    if (result.kind === "IDEMPOTENCY_CONFLICT") throw new AppError(409, "Idempotency-Key is already owned by another operation", "ORDER_IDEMPOTENCY_CONFLICT");
    if (result.kind === "USER_NOT_FOUND") throw new AppError(401, "Authenticated user is unavailable", "AUTH_UNAUTHORIZED");
    if (result.kind === "ADDRESS_NOT_FOUND") throw new AppError(404, "Address not found", "ADDRESS_NOT_FOUND");
    if (result.kind === "SHIPPING_METHOD_NOT_FOUND") throw new AppError(404, "Shipping method not found", "SHIPPING_METHOD_NOT_FOUND");
    if (result.kind === "SHIPPING_RATE_NOT_AVAILABLE") throw new AppError(409, "No shipping rate is available for this address and method", "SHIPPING_RATE_NOT_AVAILABLE");
    if (result.kind === "CART_EMPTY") throw new AppError(409, "Cart is empty", "ORDER_CART_EMPTY");
    if (result.kind === "CURRENCY_MISMATCH") throw new AppError(409, "Cart and shipping currencies do not match", "ORDER_CURRENCY_MISMATCH");
    if (result.kind === "ITEM_UNAVAILABLE") throw new AppError(409, "One or more Cart items are unavailable", "ORDER_ITEM_UNAVAILABLE");
    if (result.kind === "INSUFFICIENT_STOCK") throw new AppError(409, "Cart quantity exceeds current stock", "ORDER_INSUFFICIENT_STOCK");
    if (result.kind === "DISCOUNT_NOT_ELIGIBLE" || result.kind === "DISCOUNT_LIMIT_CHANGED") throw new AppError(409, "Cart discount is no longer eligible", "ORDER_DISCOUNT_CHANGED");
    if (result.kind === "WRITE_CONFLICT") throw new AppError(409, "Order state changed concurrently; retry with the same Idempotency-Key", "ORDER_WRITE_CONFLICT");
    const dto = toOrderDetailDto(result.order);
    // Fire-and-forget order emails — never block order placement
    if (env.SMTP_HOST && env.MAIL_FROM) {
      void sendOrderEmails(result.order);
    }
    return { order: dto, idempotentReplay: result.kind === "REPLAYED", whatsappConfirmation: this.whatsApp.confirmation(result.order), ...(guest ? { guestAccessToken: result.guestAccessToken } : {}) };
  }
  async getGuest(orderNumber: string, token: string) {
    const order = await this.repository.findGuest(orderNumber, token);
    if (!order) throw new AppError(404, "Order not found", "ORDER_NOT_FOUND");
    return toOrderDetailDto(order);
  }
  async listOwn(userId: string, query: ListOwnOrdersQuery) {
    const result = await this.repository.listOwn(userId, query);
    return { items: result.items.map(toOrderListDto), pagination: { page: query.page, limit: query.limit, total: result.total, totalPages: Math.ceil(result.total / query.limit) } };
  }
  async getOwn(userId: string, orderId: string) {
    const order = await this.repository.findOwn(userId, orderId);
    if (!order) throw new AppError(404, "Order not found", "ORDER_NOT_FOUND");
    return toOrderDetailDto(order);
  }
  private async transition(orderId: string, actorId: string, policy: keyof typeof ORDER_TRANSITIONS, input: OrderTransitionInput, ownerId?: string, now = new Date()) {
    const rule = ORDER_TRANSITIONS[policy];
    const result = await this.repository.transition(orderId, actorId, rule.target, [...rule.allowedFrom], input.reason ?? null, ownerId, now, policy === "ADMIN_SHIP" ? input as ShipOrderInput : undefined);
    if (result.kind === "NOT_FOUND") throw new AppError(404, "Order not found", "ORDER_NOT_FOUND");
    if (result.kind === "INVALID_TRANSITION") throw new AppError(409, "Order status transition is not allowed", "ORDER_TRANSITION_INVALID");
    if (result.kind === "SHIPPING_DETAILS_REQUIRED") throw new AppError(409, "A shipping provider is required before shipping", "ORDER_SHIPPING_DETAILS_REQUIRED");
    if (result.kind === "RESTORE_OVERFLOW") throw new AppError(409, "Inventory cannot be restored without integer overflow", "ORDER_STOCK_RESTORE_OVERFLOW");
    return { order: toOrderDetailDto(result.order), idempotentReplay: result.kind === "REPLAYED" };
  }
  cancelOwn(userId: string, orderId: string, input: OrderTransitionInput, now = new Date()) { return this.transition(orderId, userId, "CUSTOMER_CANCEL", input, userId, now); }
  confirmAny(actorId: string, orderId: string, input: OrderTransitionInput, now = new Date()) { return this.transition(orderId, actorId, "ADMIN_CONFIRM", input, undefined, now); }
  cancelAny(actorId: string, orderId: string, input: OrderTransitionInput, now = new Date()) { return this.transition(orderId, actorId, "ADMIN_CANCEL", input, undefined, now); }
  shipAny(actorId: string, orderId: string, input: ShipOrderInput, now = new Date()) { return this.transition(orderId, actorId, "ADMIN_SHIP", input, undefined, now); }
  deliverAny(actorId: string, orderId: string, input: OrderTransitionInput, now = new Date()) { return this.transition(orderId, actorId, "ADMIN_DELIVER", input, undefined, now); }
  async listAny(query: ListAdminOrdersQuery) {
    const result = await this.repository.listAny(query);
    return { items: result.items.map(toOrderListDto), pagination: { page: query.page, limit: query.limit, total: result.total, totalPages: Math.ceil(result.total / query.limit) } };
  }
  async getAny(orderId: string) {
    const order = await this.repository.findAny(orderId);
    if (!order) throw new AppError(404, "Order not found", "ORDER_NOT_FOUND");
    return toOrderDetailDto(order);
  }
}
