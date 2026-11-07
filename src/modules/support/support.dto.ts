import { Prisma } from "@prisma/client";

export const supportConversationSelect = {
  id: true, reference: true, userId: true, guestName: true, guestPhone: true, guestEmail: true,
  status: true, adminUnreadCount: true, customerUnreadCount: true,
  lastMessageAt: true, createdAt: true, updatedAt: true, closedAt: true,
  order: { select: { id: true, orderNumber: true } },
} as const satisfies Prisma.SupportConversationSelect;
export const supportMessageSelect = {
  id: true, conversationId: true, senderType: true, body: true, createdAt: true,
} as const satisfies Prisma.SupportMessageSelect;
type Conversation = Prisma.SupportConversationGetPayload<{ select: typeof supportConversationSelect }>;
type Message = Prisma.SupportMessageGetPayload<{ select: typeof supportMessageSelect }>;

export const supportMessageDto = (item: Message, customerName: string) => ({
  ...item, senderDisplayName: item.senderType === "ADMIN" ? "Shoezy Support" : customerName,
  createdAt: item.createdAt.toISOString(),
});
export const customerConversationDto = (item: Conversation) => ({
  id: item.id, reference: item.reference, status: item.status,
  order: item.order ? { orderNumber: item.order.orderNumber } : null,
  customerUnreadCount: item.customerUnreadCount,
  lastMessageAt: item.lastMessageAt.toISOString(), createdAt: item.createdAt.toISOString(),
  closedAt: item.closedAt?.toISOString() ?? null,
});
export const adminConversationDto = (item: Conversation) => ({
  id: item.id, reference: item.reference, status: item.status,
  customer: { name: item.guestName, phone: item.guestPhone, email: item.guestEmail, isGuest: item.userId === null },
  order: item.order, adminUnreadCount: item.adminUnreadCount, customerUnreadCount: item.customerUnreadCount,
  lastMessageAt: item.lastMessageAt.toISOString(), createdAt: item.createdAt.toISOString(),
  updatedAt: item.updatedAt.toISOString(), closedAt: item.closedAt?.toISOString() ?? null,
});
