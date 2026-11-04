import type { Request, RequestHandler } from "express";
import { AuditLogService, type AuditEvent } from "./audit-log.service";

const ENTITY_TYPES: Record<string, string> = {
  "store-settings": "STORE_SETTINGS", products: "PRODUCT", categories: "CATEGORY", brands: "BRAND",
  collections: "COLLECTION", discounts: "DISCOUNT", "shipping-methods": "SHIPPING_METHOD",
  "shipping-zones": "SHIPPING_ZONE", orders: "ORDER", returns: "RETURN", exchanges: "EXCHANGE", customers: "CUSTOMER",
  homepage: "HOMEPAGE_BANNER", support: "SUPPORT_CONVERSATION",
};
const ID_PARAMS = ["mediaId", "variantId", "areaId", "valueId", "optionId", "shippingMethodId", "zoneId", "productId", "categoryId", "brandId", "collectionId", "discountId", "orderId", "returnId", "exchangeId", "customerId", "bannerId", "conversationId"];

export function describeAdminMutation(request: Request, body?: unknown): Pick<AuditEvent, "action" | "entityType" | "entityId"> | null {
  if (!["POST", "PUT", "PATCH", "DELETE"].includes(request.method)) return null;
  const path = request.originalUrl.split("?")[0] ?? "";
  const parts = path.split("/admin/")[1]?.split("/").filter(Boolean) ?? [];
  const group = parts[0];
  if (!group || !ENTITY_TYPES[group]) return null;
  let entityType = ENTITY_TYPES[group];
  if (group === "products" && parts.includes("variants")) entityType = "PRODUCT_VARIANT";
  else if (group === "products" && parts.includes("media")) entityType = "PRODUCT_MEDIA";
  else if (group === "shipping-zones" && parts.includes("areas")) entityType = "SHIPPING_ZONE_AREA";
  else if (group === "shipping-zones" && parts.includes("rates")) entityType = "SHIPPING_ZONE_RATE";
  else if (group === "support" && parts.includes("messages")) entityType = "SUPPORT_MESSAGE";
  const suffix = parts.at(-1);
  const operation = suffix === "stock" ? "STOCK_UPDATE"
    : suffix === "status" ? "STATUS_UPDATE"
    : suffix === "upload" ? "UPLOAD"
    : ["confirm", "cancel", "ship", "deliver", "decision", "receive", "complete"].includes(suffix ?? "") ? suffix!.toUpperCase()
    : suffix === "targets" || suffix === "categories" || suffix === "products" ? "REPLACE"
    : request.method === "POST" ? "CREATE" : request.method === "PATCH" ? "UPDATE" : request.method === "PUT" ? "UPSERT" : "DELETE";
  const params = request.validated?.params as Record<string, string> | undefined;
  const data = body && typeof body === "object" && "data" in body ? (body as { data: unknown }).data : null;
  const responseData = data && typeof data === "object" ? data as Record<string, unknown> : null;
  const parameterId = ID_PARAMS.map((name) => params?.[name]).find(Boolean);
  const responseId = responseData?.id ?? (responseData?.order && typeof responseData.order === "object" ? (responseData.order as { id?: unknown }).id : null);
  const entityId = typeof responseId === "string" ? responseId : parameterId;
  return { action: `${entityType}_${operation}`, entityType, entityId: entityId ?? null };
}

export function createAuditAdminMutation(service = new AuditLogService()): RequestHandler {
  return (request, response, next) => {
    if (!["POST", "PUT", "PATCH", "DELETE"].includes(request.method)) return next();
    const originalJson = response.json.bind(response);
    const originalSend = response.send.bind(response);
    let handled = false;
    const audit = (body: unknown, send: () => void) => {
      if (handled) return send();
      handled = true;
      const success = response.statusCode >= 200 && response.statusCode < 300
        && (body === undefined || (typeof body === "object" && body !== null && "success" in body && body.success === true));
      const replay = typeof body === "object" && body !== null && "data" in body && typeof body.data === "object" && body.data !== null && "idempotentReplay" in body.data && body.data.idempotentReplay === true;
      const event = success && !replay && !response.locals.adminAuditRecorded && request.auth ? describeAdminMutation(request, body) : null;
      if (!event) return send();
      void service.record({ actorUserId: request.auth!.userId, ...event, ipAddress: request.ip, userAgent: request.get("User-Agent") }).then(send).catch(next);
    };
    response.json = ((body: unknown) => { audit(body, () => { originalJson(body); }); return response; }) as typeof response.json;
    response.send = ((body?: unknown) => { audit(body, () => { originalSend(body); }); return response; }) as typeof response.send;
    next();
  };
}

export const auditAdminMutation = createAuditAdminMutation();
