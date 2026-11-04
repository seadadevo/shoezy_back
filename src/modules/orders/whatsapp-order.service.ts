import type { OrderDetailRecord } from "./orders.types";

export function formatTndMinor(value: bigint): string {
  const negative = value < 0n;
  const positive = negative ? -value : value;
  return `${negative ? "-" : ""}${positive / 1000n}.${(positive % 1000n).toString().padStart(3, "0")} TND`;
}

export class WhatsAppOrderService {
  confirmation(order: OrderDetailRecord): { enabled: boolean; url: string | null } {
    const phone = order.whatsappConfirmationNumber?.replace(/\D/g, "");
    if (!phone || !/^216[2-9]\d{7}$/.test(phone)) return { enabled: false, url: null };
    const address = order.address;
    const lines = [
      order.whatsappStoreName ?? "Shoozy",
      `Order: ${order.orderNumber}`,
      "Products:",
      ...order.items.map((item) => `- ${item.productName} / ${item.variantName}${item.sku ? ` (SKU: ${item.sku})` : ""} x${item.quantity}`),
      `Subtotal: ${formatTndMinor(order.subtotalMinor)}`,
      `Discount: ${formatTndMinor(order.discountMinor)}`,
      `Shipping: ${formatTndMinor(order.shippingMinor)}`,
      `Total on delivery: ${formatTndMinor(order.totalMinor)}`,
      `Recipient: ${address?.recipientName ?? ""}`,
      `Phone: ${address?.phone ?? order.customerPhone}`,
      `Address: ${[address?.line1, address?.line2, address?.area, address?.city, address?.state, address?.countryCode].filter(Boolean).join(", ")}`,
      "Payment: Cash on Delivery",
    ];
    return { enabled: true, url: `https://wa.me/${phone}?text=${encodeURIComponent(lines.join("\n"))}` };
  }
}
