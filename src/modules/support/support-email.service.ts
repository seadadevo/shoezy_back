import type { OrderEmailMessage } from "../orders/order-email.service";
import { env } from "../../config/env";

type SupportEmailData = {
  conversation: {
    id?: string; reference: string; guestName: string; guestPhone: string; guestEmail: string | null;
    userId: string | null; status: string; order: { orderNumber: string } | null;
  };
  body: string;
  createdAt: Date;
};
const escapeHtml = (value: string) => value.replace(/[&<>"']/g, (character) => ({
  "&": "&amp;", "<": "&lt;", ">": "&gt;", '"': "&quot;", "'": "&#39;",
})[character]!);

export function supportAdminEmail(message: SupportEmailData, recipient: string, newConversation = false): OrderEmailMessage {
  const conversation = message.conversation;
  const inboxUrl = new URL("/admin/support", env.FRONTEND_URL);
  if (conversation.id) inboxUrl.searchParams.set("conversation", conversation.id);
  const heading = `New Shoozy Support ${newConversation ? "Request" : "Message"} #${conversation.reference}`;
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
  return { to: recipient, subject: heading, text,
    html: `<div style="font-family:Arial,sans-serif;white-space:pre-wrap">${escapeHtml(text)}</div>` };
}
