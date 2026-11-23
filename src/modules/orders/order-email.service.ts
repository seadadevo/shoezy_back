import nodemailer from "nodemailer";
import { env } from "../../config/env";
import type { OrderDetailRecord } from "./orders.types";
import { formatTndMinor } from "./whatsapp-order.service";
import {
  resolveEmailImageUrl,
  selectPurchasedImageUrl,
  snapshotImageUrl,
} from "./order-images";
import {
  escapeHtml,
  formatHumanDate,
  renderLuxuryButton,
  renderLuxuryEmailWrapper,
  renderStatusBadge,
  safeSubject,
} from "../../common/mail/luxury-email-template";

export { resolveEmailImageUrl };

export type OrderEmailMessage = { to: string; subject: string; text: string; html: string };

const name = (order: OrderDetailRecord) =>
  [order.customerFirstName, order.customerLastName].filter(Boolean).join(" ") ||
  order.address?.recipientName ||
  "Customer";

const address = (order: OrderDetailRecord) =>
  [
    order.address?.line1,
    order.address?.line2,
    order.address?.area,
    order.address?.city,
    order.address?.state,
    order.address?.postalCode,
    order.address?.countryCode,
  ]
    .filter(Boolean)
    .join(", ");

const itemLines = (order: OrderDetailRecord) =>
  order.items.map((item) => {
    const snapshot = item.snapshotJson;
    const options =
      snapshot && typeof snapshot === "object" && !Array.isArray(snapshot) && "options" in snapshot
        ? (snapshot as { options?: unknown }).options
        : null;
    const color = Array.isArray(options)
      ? options.find(
          (option) =>
            option &&
            typeof option === "object" &&
            "option" in option &&
            String(option.option).toLowerCase() === "color"
        )
      : null;
    const colorLabel =
      color && typeof color === "object" && "value" in color
        ? `, color ${String((color as { value: unknown }).value)}`
        : "";
    return `- ${item.productName} / ${item.variantName}${colorLabel} (SKU: ${item.sku}) x${item.quantity} @ ${formatTndMinor(item.unitPriceMinor)} = ${formatTndMinor(item.lineTotalMinor)}`;
  });

const adminOrderUrl = (orderId: string) => {
  const url = new URL("/admin/orders", env.FRONTEND_URL);
  url.searchParams.set("notificationOrder", orderId);
  return url.toString();
};

function resolveItemImage(item: OrderDetailRecord["items"][number]): string | null {
  const snapUrl = snapshotImageUrl(item.snapshotJson);
  if (snapUrl) return resolveEmailImageUrl(snapUrl);
  const media = [
    ...(item.variant?.media ?? []),
    ...(item.product?.media ?? []),
  ];
  const chosen = selectPurchasedImageUrl(media, item.productId, item.variantId);
  return resolveEmailImageUrl(chosen);
}

function parseItemDetails(item: OrderDetailRecord["items"][number]) {
  const pName = item.productName.trim();
  const vName = item.variantName.trim();
  const isGenericVariant = !vName || /^(default|default title|standard)$/i.test(vName);
  const isDuplicate = pName.toLowerCase() === vName.toLowerCase();
  const subtitle = !isGenericVariant && !isDuplicate ? vName : null;

  let size: string | null = null;
  let color: string | null = null;
  const otherOptions: string[] = [];

  const snapshot = item.snapshotJson;
  if (snapshot && typeof snapshot === "object" && !Array.isArray(snapshot)) {
    const snap = snapshot as Record<string, unknown>;
    const options = Array.isArray(snap.options) ? snap.options : [];
    for (const opt of options) {
      if (!opt || typeof opt !== "object") continue;
      const optName = String((opt as Record<string, unknown>).option ?? "").trim();
      const optVal = String((opt as Record<string, unknown>).value ?? "").trim();
      if (!optName || !optVal) continue;
      const lower = optName.toLowerCase();
      if (lower === "size" || lower === "pointure" || lower === "taille") {
        size = optVal;
      } else if (lower === "color" || lower === "couleur") {
        color = optVal;
      } else {
        otherOptions.push(`${optName}: ${optVal}`);
      }
    }
    if (!size && typeof snap.size === "string") size = snap.size;
    if (!color && typeof snap.color === "string") color = snap.color;
  }

  return { title: pName, subtitle, size, color, otherOptions };
}

function renderItemsTable(order: OrderDetailRecord): string {
  const rows = order.items
    .map((item) => {
      const imageUrl = resolveItemImage(item);
      const details = parseItemDetails(item);

      const imageCell = imageUrl
        ? `<img src="${escapeHtml(imageUrl)}" alt="${escapeHtml(details.title)}" width="64" height="64" style="width:64px;height:64px;object-fit:cover;border-radius:8px;background-color:#F6F6F6;display:block;border:1px solid #EEEEEE;" />`
        : `<table width="64" height="64" cellpadding="0" cellspacing="0" border="0" style="width:64px;height:64px;background-color:#F6F6F6;border-radius:8px;border:1px solid #EEEEEE;">
             <tr>
               <td align="center" valign="middle" style="font-size:9px;font-weight:700;color:#A1A1AA;letter-spacing:1px;text-transform:uppercase;">
                 SHOEZY
               </td>
             </tr>
           </table>`;

      const badges: string[] = [];
      if (details.size) {
        badges.push(
          `<span style="display:inline-block;background-color:#F4F4F5;color:#27272A;font-size:11px;font-weight:600;padding:2px 7px;border-radius:4px;">Size: ${escapeHtml(details.size)}</span>`
        );
      }
      if (details.color) {
        badges.push(
          `<span style="display:inline-block;color:#71717A;font-size:11px;">Color: ${escapeHtml(details.color)}</span>`
        );
      }
      for (const other of details.otherOptions) {
        badges.push(
          `<span style="display:inline-block;color:#71717A;font-size:11px;">${escapeHtml(other)}</span>`
        );
      }

      return `
        <tr>
          <td style="padding:16px 0;border-bottom:1px solid #F4F4F5;width:64px;vertical-align:top;">
            ${imageCell}
          </td>
          <td style="padding:16px 16px;border-bottom:1px solid #F4F4F5;vertical-align:top;">
            <div style="font-size:14px;font-weight:600;color:#111111;line-height:1.3;">
              ${escapeHtml(details.title)}
            </div>
            ${details.subtitle ? `<div style="font-size:12px;color:#52525B;margin-top:2px;">${escapeHtml(details.subtitle)}</div>` : ""}
            ${badges.length > 0 ? `<div style="margin-top:5px;line-height:1.5;">${badges.join(" &bull; ")}</div>` : ""}
            <div style="font-size:11px;color:#71717A;margin-top:4px;">
              SKU: ${escapeHtml(item.sku)}
            </div>
            <div style="font-size:12px;color:#52525B;margin-top:4px;">
              Qty: <strong>${item.quantity}</strong> &times; ${formatTndMinor(item.unitPriceMinor)}
            </div>
          </td>
          <td align="right" style="padding:16px 0;border-bottom:1px solid #F4F4F5;vertical-align:top;white-space:nowrap;">
            <div style="font-size:14px;font-weight:700;color:#111111;">
              ${formatTndMinor(item.lineTotalMinor)}
            </div>
          </td>
        </tr>
      `;
    })
    .join("");

  return `
    <table width="100%" border="0" cellpadding="0" cellspacing="0" style="margin-top:8px;">
      <thead>
        <tr>
          <th align="left" colspan="2" style="font-size:11px;font-weight:700;color:#71717A;letter-spacing:1px;text-transform:uppercase;padding-bottom:10px;border-bottom:2px solid #F4F4F5;">Item</th>
          <th align="right" style="font-size:11px;font-weight:700;color:#71717A;letter-spacing:1px;text-transform:uppercase;padding-bottom:10px;border-bottom:2px solid #F4F4F5;">Total</th>
        </tr>
      </thead>
      <tbody>
        ${rows}
      </tbody>
    </table>
  `;
}

function renderTotalsBreakdown(order: OrderDetailRecord): string {
  return `
    <table width="100%" border="0" cellpadding="0" cellspacing="0" style="background-color:#F9F9FB;border:1px solid #E4E4E7;border-radius:8px;padding:16px;margin-top:20px;">
      <tr>
        <td style="padding:4px 0;font-size:13px;color:#71717A;">Subtotal</td>
        <td align="right" style="padding:4px 0;font-size:13px;color:#18181B;font-weight:500;">${formatTndMinor(order.subtotalMinor)}</td>
      </tr>
      ${
        order.discountMinor > 0n
          ? `
      <tr>
        <td style="padding:4px 0;font-size:13px;color:#16A34A;">Discount</td>
        <td align="right" style="padding:4px 0;font-size:13px;color:#16A34A;font-weight:600;">-${formatTndMinor(order.discountMinor)}</td>
      </tr>`
          : ""
      }
      <tr>
        <td style="padding:4px 0;font-size:13px;color:#71717A;">Shipping (${escapeHtml(order.shippingMethodName ?? order.shippingMethodCode ?? "Standard Delivery")})</td>
        <td align="right" style="padding:4px 0;font-size:13px;color:#18181B;font-weight:500;">${formatTndMinor(order.shippingMinor)}</td>
      </tr>
      <tr>
        <td colspan="2" style="padding:8px 0 6px 0;">
          <div style="height:1px;background-color:#E4E4E7;"></div>
        </td>
      </tr>
      <tr>
        <td style="padding:4px 0;font-size:15px;font-weight:700;color:#111111;">Total</td>
        <td align="right" style="padding:4px 0;font-size:16px;font-weight:800;color:#111111;">${formatTndMinor(order.totalMinor)}</td>
      </tr>
    </table>
  `;
}

function renderCustomerDeliveryCard(order: OrderDetailRecord): string {
  const customerName = name(order);
  const shippingAddress = address(order);
  return `
    <table width="100%" border="0" cellpadding="0" cellspacing="0" style="background-color:#F9F9FB;border:1px solid #E4E4E7;border-radius:8px;padding:16px;margin-bottom:20px;">
      <tr>
        <td colspan="2" style="font-size:11px;font-weight:700;color:#71717A;letter-spacing:1px;text-transform:uppercase;padding-bottom:12px;">Customer & Delivery Details</td>
      </tr>
      <tr>
        <td style="padding:4px 0;font-size:13px;color:#71717A;width:130px;vertical-align:top;">Customer</td>
        <td style="padding:4px 0;font-size:13px;color:#18181B;font-weight:500;">${escapeHtml(customerName)} ${order.userId ? '<span style="font-size:11px;color:#71717A;font-weight:normal;">(Account)</span>' : '<span style="font-size:11px;color:#71717A;font-weight:normal;">(Guest)</span>'}</td>
      </tr>
      <tr>
        <td style="padding:4px 0;font-size:13px;color:#71717A;vertical-align:top;">Phone</td>
        <td style="padding:4px 0;font-size:13px;color:#18181B;font-weight:500;"><a href="tel:${escapeHtml(order.customerPhone)}" style="color:#111111;text-decoration:underline;">${escapeHtml(order.customerPhone)}</a></td>
      </tr>
      ${
        order.customerEmail
          ? `
      <tr>
        <td style="padding:4px 0;font-size:13px;color:#71717A;vertical-align:top;">Email</td>
        <td style="padding:4px 0;font-size:13px;color:#18181B;"><a href="mailto:${escapeHtml(order.customerEmail)}" style="color:#111111;text-decoration:none;">${escapeHtml(order.customerEmail)}</a></td>
      </tr>`
          : ""
      }
      <tr>
        <td style="padding:4px 0;font-size:13px;color:#71717A;vertical-align:top;">Shipping Address</td>
        <td style="padding:4px 0;font-size:13px;color:#18181B;">${escapeHtml(shippingAddress || "N/A")}</td>
      </tr>
      <tr>
        <td style="padding:4px 0;font-size:13px;color:#71717A;vertical-align:top;">Shipping Method</td>
        <td style="padding:4px 0;font-size:13px;color:#18181B;">${escapeHtml(order.shippingMethodName ?? order.shippingMethodCode ?? "Standard Delivery")}</td>
      </tr>
      <tr>
        <td style="padding:4px 0;font-size:13px;color:#71717A;vertical-align:top;">Payment Method</td>
        <td style="padding:4px 0;font-size:13px;color:#18181B;font-weight:600;">${escapeHtml(order.paymentMethod)} <span style="font-size:11px;font-weight:normal;color:#71717A;">(${escapeHtml(order.paymentStatus)})</span></td>
      </tr>
      ${
        order.notes
          ? `
      <tr>
        <td style="padding:4px 0;font-size:13px;color:#71717A;vertical-align:top;">Notes</td>
        <td style="padding:4px 0;font-size:13px;color:#18181B;font-style:italic;">${escapeHtml(order.notes)}</td>
      </tr>`
          : ""
      }
    </table>
  `;
}

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
    "Items:",
    ...itemLines(order),
    `Subtotal: ${formatTndMinor(order.subtotalMinor)}`,
    `Discount: ${formatTndMinor(order.discountMinor)}`,
    `Shipping: ${formatTndMinor(order.shippingMinor)}`,
    `Total: ${formatTndMinor(order.totalMinor)}`,
    `Payment: ${order.paymentMethod} (${order.paymentStatus})`,
    `Admin order details: ${adminOrderUrl(order.id)}`,
  ].join("\n");

  const formattedDate = formatHumanDate(order.placedAt ?? order.createdAt);
  const statusBadge = renderStatusBadge(order.status);

  const contentHtml = `
    <!-- Order Info Header -->
    <table width="100%" border="0" cellpadding="0" cellspacing="0" style="margin-bottom:20px;">
      <tr>
        <td valign="top">
          <div style="font-size:11px;font-weight:700;color:#71717A;letter-spacing:1px;text-transform:uppercase;">
            Order Notification
          </div>
          <div style="font-size:20px;font-weight:800;color:#111111;margin-top:2px;">
            Order #${escapeHtml(order.orderNumber)}
          </div>
          <div style="font-size:12px;color:#71717A;margin-top:2px;">
            Placed on ${escapeHtml(formattedDate)}
          </div>
        </td>
        <td align="right" valign="top">
          ${statusBadge}
        </td>
      </tr>
    </table>

    <!-- Customer & Delivery Card -->
    ${renderCustomerDeliveryCard(order)}

    <!-- Ordered Items -->
    ${renderItemsTable(order)}

    <!-- Totals Breakdown -->
    ${renderTotalsBreakdown(order)}

    <!-- Primary CTA Button -->
    <div style="text-align:center;margin-top:24px;">
      ${renderLuxuryButton("View Order in Dashboard →", adminOrderUrl(order.id))}
    </div>
  `;

  const html = renderLuxuryEmailWrapper({
    previewText: `New Shoezy Order #${order.orderNumber} - Total: ${formatTndMinor(order.totalMinor)}`,
    headerBadge: "ADMIN NOTIFICATION",
    title: `New Shoezy Order #${order.orderNumber}`,
    contentHtml,
    footerNote: "This is an automated notification from the SHOEZY store admin system.",
  });

  return { to, subject: safeSubject(`New Shoezy Order #${order.orderNumber}`), text, html };
}

export function customerOrderEmail(order: OrderDetailRecord): OrderEmailMessage | null {
  if (!order.customerEmail) return null;
  const text = [
    `Hello ${name(order)},`,
    `Thank you for your Shoezy order #${order.orderNumber}.`,
    `Current status: ${order.status}`,
    "Items:",
    ...itemLines(order),
    `Total: ${formatTndMinor(order.totalMinor)}`,
    `Shipping address: ${address(order)}`,
    `Shipping method: ${order.shippingMethodName ?? order.shippingMethodCode ?? "Unknown"}`,
    `Payment: ${order.paymentMethod} (${order.paymentStatus})`,
  ].join("\n");

  const customerName = name(order);
  const formattedDate = formatHumanDate(order.placedAt ?? order.createdAt);
  const statusBadge = renderStatusBadge(order.status);
  const ordersUrl = `${env.FRONTEND_URL}/account/orders`;

  const contentHtml = `
    <!-- Thank you header -->
    <div style="text-align:center;margin-bottom:24px;">
      <div style="font-size:22px;font-weight:800;color:#111111;line-height:1.2;">
        Thank You for Your Order
      </div>
      <div style="font-size:14px;color:#52525B;margin-top:6px;">
        Hello ${escapeHtml(customerName)}, we have received your order and are preparing it for delivery.
      </div>
    </div>

    <!-- Order Info Header -->
    <table width="100%" border="0" cellpadding="0" cellspacing="0" style="background-color:#F9F9FB;border:1px solid #E4E4E7;border-radius:8px;padding:14px 16px;margin-bottom:20px;">
      <tr>
        <td valign="middle">
          <div style="font-size:11px;font-weight:700;color:#71717A;letter-spacing:1px;text-transform:uppercase;">
            Order Reference
          </div>
          <div style="font-size:16px;font-weight:800;color:#111111;margin-top:2px;">
            #${escapeHtml(order.orderNumber)}
          </div>
          <div style="font-size:11px;color:#71717A;margin-top:2px;">
            ${escapeHtml(formattedDate)}
          </div>
        </td>
        <td align="right" valign="middle">
          ${statusBadge}
        </td>
      </tr>
    </table>

    <!-- Delivery Card -->
    ${renderCustomerDeliveryCard(order)}

    <!-- Ordered Items -->
    ${renderItemsTable(order)}

    <!-- Totals Breakdown -->
    ${renderTotalsBreakdown(order)}

    <!-- Customer CTA -->
    <div style="text-align:center;margin-top:24px;">
      ${renderLuxuryButton("Track & View Your Order →", ordersUrl)}
    </div>
  `;

  const html = renderLuxuryEmailWrapper({
    previewText: `Thank you for your Shoezy order #${order.orderNumber}!`,
    headerBadge: "ORDER CONFIRMATION",
    title: `Shoezy Order Confirmation #${order.orderNumber}`,
    contentHtml,
    footerNote: "If you have any questions about your order, simply reply to this email or contact customer support.",
  });

  return {
    to: order.customerEmail,
    subject: safeSubject(`Shoezy Order Confirmation #${order.orderNumber}`),
    text,
    html,
  };
}

export interface OrderEmailSender {
  send(message: OrderEmailMessage): Promise<void>;
}

export class SmtpOrderEmailSender implements OrderEmailSender {
  async send(message: OrderEmailMessage): Promise<void> {
    if (!env.SMTP_HOST || !env.MAIL_FROM) throw new Error("Order email transport is not configured");
    const transport = nodemailer.createTransport({
      host: env.SMTP_HOST,
      port: env.SMTP_PORT,
      secure: env.SMTP_SECURE,
      auth:
        env.SMTP_USER && env.SMTP_PASSWORD
          ? { user: env.SMTP_USER, pass: env.SMTP_PASSWORD }
          : undefined,
      connectionTimeout: 20_000,
      greetingTimeout: 20_000,
      socketTimeout: 30_000,
    });
    await transport.sendMail({
      from: { name: env.MAIL_FROM_NAME ?? "Shoezy", address: env.MAIL_FROM },
      to: message.to,
      subject: message.subject,
      text: message.text,
      html: message.html,
    });
  }
}
