import type { NotificationType } from "@prisma/client";

export const SUPPORTED_LOCALES = ["en", "ar"] as const;
export type SupportedLocale = (typeof SUPPORTED_LOCALES)[number];
export type NotificationTemplateKey = NotificationType | "ORDER_CANCELLED_ADMIN";

type Template = { title: (params: Record<string, string>) => string; message: (params: Record<string, string>) => string };

const statusLabels: Record<SupportedLocale, Record<string, string>> = {
  en: {
    APPROVED: "approved", REJECTED: "rejected", RECEIVED_AND_REFUNDED: "received and refunded", COMPLETED: "completed",
  },
  ar: {
    APPROVED: "تمت الموافقة عليه", REJECTED: "تم رفضه", RECEIVED_AND_REFUNDED: "تم استلامه ورد قيمته", COMPLETED: "اكتمل",
  },
};

const templates: Record<SupportedLocale, Record<NotificationTemplateKey, Template>> = {
  en: {
    ORDER_CREATED: { title: (p) => `New order #${p.orderNumber}`, message: () => "A new order has been placed." },
    ORDER_CONFIRMED: { title: (p) => `Order #${p.orderNumber} confirmed`, message: (p) => `Your order #${p.orderNumber} has been confirmed.` },
    ORDER_SHIPPED: { title: (p) => `Order #${p.orderNumber} shipped`, message: (p) => `Your order #${p.orderNumber} has been shipped.` },
    ORDER_DELIVERED: { title: (p) => `Order #${p.orderNumber} delivered`, message: (p) => `Your order #${p.orderNumber} has been delivered.` },
    ORDER_CANCELLED: { title: (p) => `Order #${p.orderNumber} cancelled`, message: (p) => `Your order #${p.orderNumber} has been cancelled.` },
    ORDER_CANCELLED_ADMIN: { title: (p) => `Order #${p.orderNumber} cancelled`, message: () => "An order has been cancelled." },
    RETURN_REQUESTED: { title: (p) => `Return ${p.returnNumber} requested`, message: () => "A customer submitted a return request." },
    RETURN_STATUS_UPDATED: { title: (p) => `Return ${p.returnNumber} updated`, message: (p) => `Your return request is now ${statusLabels.en[p.status] ?? p.status}.` },
    EXCHANGE_REQUESTED: { title: (p) => `Exchange ${p.exchangeNumber} requested`, message: () => "A customer submitted an exchange request." },
    EXCHANGE_STATUS_UPDATED: { title: (p) => `Exchange ${p.exchangeNumber} updated`, message: (p) => `Your exchange request is now ${statusLabels.en[p.status] ?? p.status}.` },
    REVIEW_PENDING: { title: () => "Review awaiting moderation", message: () => "A new product review requires moderation." },
    LOW_STOCK: { title: (p) => `Low stock: ${p.sku}`, message: (p) => `${p.sku} has ${p.stockQuantity} units remaining.` },
    SUPPORT_REQUEST: { title: (p) => `Support #${p.reference} needs attention`, message: () => "A customer sent a support message." },
  },
  ar: {
    ORDER_CREATED: { title: (p) => `طلب جديد رقم ${p.orderNumber}`, message: () => "تم تقديم طلب جديد." },
    ORDER_CONFIRMED: { title: (p) => `تم تأكيد الطلب رقم ${p.orderNumber}`, message: (p) => `تم تأكيد طلبك رقم ${p.orderNumber}.` },
    ORDER_SHIPPED: { title: (p) => `تم شحن الطلب رقم ${p.orderNumber}`, message: (p) => `تم شحن طلبك رقم ${p.orderNumber}.` },
    ORDER_DELIVERED: { title: (p) => `تم توصيل الطلب رقم ${p.orderNumber}`, message: (p) => `تم توصيل طلبك رقم ${p.orderNumber}.` },
    ORDER_CANCELLED: { title: (p) => `تم إلغاء الطلب رقم ${p.orderNumber}`, message: (p) => `تم إلغاء طلبك رقم ${p.orderNumber}.` },
    ORDER_CANCELLED_ADMIN: { title: (p) => `تم إلغاء الطلب رقم ${p.orderNumber}`, message: () => "تم إلغاء أحد الطلبات." },
    RETURN_REQUESTED: { title: (p) => `طلب إرجاع رقم ${p.returnNumber}`, message: () => "قدّم عميل طلب إرجاع." },
    RETURN_STATUS_UPDATED: { title: (p) => `تحديث الإرجاع رقم ${p.returnNumber}`, message: (p) => `طلب الإرجاع الخاص بك ${statusLabels.ar[p.status] ?? p.status}.` },
    EXCHANGE_REQUESTED: { title: (p) => `طلب استبدال رقم ${p.exchangeNumber}`, message: () => "قدّم عميل طلب استبدال." },
    EXCHANGE_STATUS_UPDATED: { title: (p) => `تحديث الاستبدال رقم ${p.exchangeNumber}`, message: (p) => `طلب الاستبدال الخاص بك ${statusLabels.ar[p.status] ?? p.status}.` },
    REVIEW_PENDING: { title: () => "تقييم بانتظار المراجعة", message: () => "يوجد تقييم منتج جديد يحتاج إلى المراجعة." },
    LOW_STOCK: { title: (p) => `مخزون منخفض: ${p.sku}`, message: (p) => `تبقى من ${p.sku} عدد ${p.stockQuantity} وحدات.` },
    SUPPORT_REQUEST: { title: (p) => `طلب الدعم رقم ${p.reference}`, message: () => "أرسل عميل رسالة دعم جديدة." },
  },
};

export function resolveLocale(value: string | undefined): SupportedLocale {
  const requested = value?.split(",")[0]?.trim().toLowerCase();
  return requested?.startsWith("ar") ? "ar" : "en";
}

export function renderNotification(templateKey: string, params: Record<string, string>, locale: SupportedLocale) {
  const template = templates[locale][templateKey as NotificationTemplateKey] ?? templates.en[templateKey as NotificationTemplateKey];
  if (!template) return { title: templateKey, message: templateKey };
  return { title: template.title(params), message: template.message(params) };
}
