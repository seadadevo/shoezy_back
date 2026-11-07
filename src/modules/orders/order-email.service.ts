import nodemailer from "nodemailer";
import { env } from "../../config/env";
import type { OrderDetailRecord } from "./orders.types";
import { formatTndMinor } from "./whatsapp-order.service";

export type OrderEmailMessage = { to: string; subject: string; text: string; html: string };

const escapeHtml = (value: string) => value.replace(/[&<>"']/g, (character) => ({
  "&": "&amp;", "<": "&lt;", ">": "&gt;", '"': "&quot;", "'": "&#39;",
})[character]!);
const safeSubject = (value: string) => [...value].map((character) => character.charCodeAt(0) < 32 || character.charCodeAt(0) === 127 ? " " : character).join("");
const name = (order: OrderDetailRecord) => [order.customerFirstName, order.customerLastName].filter(Boolean).join(" ") || order.address?.recipientName || "Customer";
const address = (order: OrderDetailRecord) => [
  order.address?.line1, order.address?.line2, order.address?.area, order.address?.city,
  order.address?.state, order.address?.postalCode, order.address?.countryCode,
].filter(Boolean).join(", ");
const itemLines = (order: OrderDetailRecord) => order.items.map((item) => {
  const snapshot = item.snapshotJson;
  const options = snapshot && typeof snapshot === "object" && !Array.isArray(snapshot) && "options" in snapshot ? snapshot.options : null;
  const color = Array.isArray(options) ? options.find((option) => option && typeof option === "object" && "option" in option && String(option.option).toLowerCase() === "color") : null;
  const colorLabel = color && typeof color === "object" && "value" in color ? `, color ${String(color.value)}` : "";
  return `- ${item.productName} / ${item.variantName}${colorLabel} (SKU: ${item.sku}) x${item.quantity} @ ${formatTndMinor(item.unitPriceMinor)} = ${formatTndMinor(item.lineTotalMinor)}`;
});
const html = (text: string) => `<div style="font-family:Arial,sans-serif;white-space:pre-wrap">${escapeHtml(text)}</div>`;
const adminOrderUrl = (orderId: string) => {
  const url = new URL("/admin/orders", env.FRONTEND_URL);
  url.searchParams.set("notificationOrder", orderId);
  return url.toString();
};

export function adminOrderEmail(order: OrderDetailRecord, to: string): OrderEmailMessage {
  const text = [
    `New Shoezy Order #${order.orderNumber}`,
    `Placed: ${(order.placedAt ?? order.createdAt).toISOString()}`,
    `Status: ${order.status}`,
    `Customer: ${name(order)} (${order.userId ? "account" : "guest"})`,
    `Phone: ${order.customerPhone}`,
    ...(order.customerEmail ? [`Email: ${order.customerEmail}`] : []),
    `Shipping address: ${address(order)}`,
    `Shipping method: ${order.shippingMethodName ?? order.shippingMethodCode ?? "Unknown"}`,
    "Items:", ...itemLines(order),
    `Subtotal: ${formatTndMinor(order.subtotalMinor)}`,
    `Discount: ${formatTndMinor(order.discountMinor)}`,
    `Shipping: ${formatTndMinor(order.shippingMinor)}`,
    `Total: ${formatTndMinor(order.totalMinor)}`,
    `Payment: ${order.paymentMethod} (${order.paymentStatus})`,
    `Admin order details: ${adminOrderUrl(order.id)}`,
  ].join("\n");
  return { to, subject: safeSubject(`New Shoezy Order #${order.orderNumber}`), text, html: html(text) };
}

export function customerOrderEmail(order: OrderDetailRecord): OrderEmailMessage | null {
  if (!order.customerEmail) return null;
  const text = [
    `Hello ${name(order)},`,
    `Thank you for your Shoezy order #${order.orderNumber}.`,
    `Current status: ${order.status}`,
    "Items:", ...itemLines(order),
    `Total: ${formatTndMinor(order.totalMinor)}`,
    `Shipping address: ${address(order)}`,
    `Shipping method: ${order.shippingMethodName ?? order.shippingMethodCode ?? "Unknown"}`,
    `Payment: ${order.paymentMethod} (${order.paymentStatus})`,
  ].join("\n");
  return { to: order.customerEmail, subject: safeSubject(`Shoezy Order Confirmation #${order.orderNumber}`), text, html: html(text) };
}

export interface OrderEmailSender { send(message: OrderEmailMessage): Promise<void> }

export class SmtpOrderEmailSender implements OrderEmailSender {
  async send(message: OrderEmailMessage): Promise<void> {
    if (!env.SMTP_HOST || !env.MAIL_FROM) throw new Error("Order email transport is not configured");
    const transport = nodemailer.createTransport({
      host: env.SMTP_HOST, port: env.SMTP_PORT, secure: env.SMTP_SECURE,
      auth: env.SMTP_USER && env.SMTP_PASSWORD ? { user: env.SMTP_USER, pass: env.SMTP_PASSWORD } : undefined,
      connectionTimeout: 20_000, greetingTimeout: 20_000, socketTimeout: 30_000,
    });
    await transport.sendMail({
      from: { name: env.MAIL_FROM_NAME ?? "Shoezy", address: env.MAIL_FROM },
      to: message.to, subject: message.subject, text: message.text, html: message.html,
    });
  }
}
