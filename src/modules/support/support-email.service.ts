import type { OrderEmailMessage } from "../orders/order-email.service";
import { env } from "../../config/env";
import {
  escapeHtml,
  formatHumanDate,
  renderLuxuryButton,
  renderLuxuryEmailWrapper,
  renderStatusBadge,
} from "../../common/mail/luxury-email-template";

export type SupportEmailData = {
  conversation: {
    id?: string;
    reference: string;
    guestName: string;
    guestPhone: string;
    guestEmail: string | null;
    userId: string | null;
    status: string;
    order: { orderNumber: string } | null;
  };
  body: string;
  createdAt: Date;
};

export function supportAdminEmail(
  message: SupportEmailData,
  recipient: string,
  newConversation = false
): OrderEmailMessage {
  const conversation = message.conversation;
  const inboxUrl = new URL("/admin/support", env.FRONTEND_URL);
  if (conversation.id) inboxUrl.searchParams.set("conversation", conversation.id);
  const heading = `New Shoezy Support ${newConversation ? "Request" : "Message"} #${conversation.reference}`;
  const text = [
    heading,
    `Customer: ${conversation.guestName} (${conversation.userId ? "account" : "guest"})`,
    `Phone: ${conversation.guestPhone}`,
    ...(conversation.guestEmail ? [`Email: ${conversation.guestEmail}`] : []),
    ...(conversation.order ? [`Order: ${conversation.order.orderNumber}`] : []),
    `Status: ${conversation.status}`,
    `Message time: ${message.createdAt.toISOString()}`,
    `Message: ${message.body}`,
    `Admin support inbox: ${inboxUrl.toString()}`,
  ].join("\n");

  const formattedDate = formatHumanDate(message.createdAt);
  const statusBadge = renderStatusBadge(conversation.status);

  const contentHtml = `
    <!-- Header info -->
    <table width="100%" border="0" cellpadding="0" cellspacing="0" style="margin-bottom:20px;">
      <tr>
        <td valign="top">
          <div style="font-size:11px;font-weight:700;color:#71717A;letter-spacing:1px;text-transform:uppercase;">
            Customer Support
          </div>
          <div style="font-size:18px;font-weight:800;color:#111111;margin-top:2px;">
            ${escapeHtml(heading)}
          </div>
          <div style="font-size:12px;color:#71717A;margin-top:2px;">
            Received on ${escapeHtml(formattedDate)}
          </div>
        </td>
        <td align="right" valign="top">
          ${statusBadge}
        </td>
      </tr>
    </table>

    <!-- Customer Card -->
    <table width="100%" border="0" cellpadding="0" cellspacing="0" style="background-color:#F9F9FB;border:1px solid #E4E4E7;border-radius:8px;padding:16px;margin-bottom:20px;">
      <tr>
        <td colspan="2" style="font-size:11px;font-weight:700;color:#71717A;letter-spacing:1px;text-transform:uppercase;padding-bottom:10px;">Customer Info</td>
      </tr>
      <tr>
        <td style="padding:4px 0;font-size:13px;color:#71717A;width:120px;vertical-align:top;">Customer</td>
        <td style="padding:4px 0;font-size:13px;color:#18181B;font-weight:500;">${escapeHtml(conversation.guestName)} ${conversation.userId ? '<span style="font-size:11px;color:#71717A;font-weight:normal;">(Account)</span>' : '<span style="font-size:11px;color:#71717A;font-weight:normal;">(Guest)</span>'}</td>
      </tr>
      <tr>
        <td style="padding:4px 0;font-size:13px;color:#71717A;vertical-align:top;">Phone</td>
        <td style="padding:4px 0;font-size:13px;color:#18181B;"><a href="tel:${escapeHtml(conversation.guestPhone)}" style="color:#111111;text-decoration:underline;">${escapeHtml(conversation.guestPhone)}</a></td>
      </tr>
      ${
        conversation.guestEmail
          ? `
      <tr>
        <td style="padding:4px 0;font-size:13px;color:#71717A;vertical-align:top;">Email</td>
        <td style="padding:4px 0;font-size:13px;color:#18181B;"><a href="mailto:${escapeHtml(conversation.guestEmail)}" style="color:#111111;text-decoration:none;">${escapeHtml(conversation.guestEmail)}</a></td>
      </tr>`
          : ""
      }
      ${
        conversation.order
          ? `
      <tr>
        <td style="padding:4px 0;font-size:13px;color:#71717A;vertical-align:top;">Order Ref</td>
        <td style="padding:4px 0;font-size:13px;color:#18181B;font-weight:600;">#${escapeHtml(conversation.order.orderNumber)}</td>
      </tr>`
          : ""
      }
    </table>

    <!-- Message Body -->
    <div style="font-size:11px;font-weight:700;color:#71717A;letter-spacing:1px;text-transform:uppercase;margin-bottom:8px;">Customer Message</div>
    <div style="background-color:#F9F9FB;border:1px solid #E4E4E7;border-radius:8px;padding:16px;font-size:14px;color:#18181B;line-height:1.6;white-space:pre-wrap;">${escapeHtml(message.body)}</div>

    <!-- CTA Button -->
    <div style="text-align:center;margin-top:24px;">
      ${renderLuxuryButton("Open in Admin Support →", inboxUrl.toString())}
    </div>
  `;

  const html = renderLuxuryEmailWrapper({
    previewText: `${heading} from ${conversation.guestName}`,
    headerBadge: "SUPPORT INBOX",
    title: heading,
    contentHtml,
    footerNote: "This message was received through SHOEZY Customer Support Live Hub.",
  });

  return { to: recipient, subject: heading, text, html };
}
