# Shoozy frontend integration: notifications, localization, promotions

All REST paths below are relative to `/api/v1`. Existing response envelopes, JWT cookies/bearer authentication, pagination fields, stable IDs, slugs, SKUs, and price fields remain unchanged.

## Notifications

### Socket.IO

Connect to the backend origin (not `/api/v1`) on the default Socket.IO path. Send the current access token only in the authentication handshake:

```ts
io(BACKEND_URL, {
  auth: { token: accessToken },
  withCredentials: true,
  transports: ["websocket", "polling"],
});
```

The server validates the JWT, session, user status, and permissions. It assigns `user:<authenticated-user-id>` internally; clients cannot select rooms. Administrative events are expanded to the currently authorized users and delivered to their private rooms, so customers cannot receive them.

Server events are:

- `notification:new`: the complete notification DTO.
- `notification:updated`: the complete notification DTO after a read-state change.
- `notification:deleted`: `{ id: string }`.
- `notification:unread-count`: `{ count: number }`, also emitted immediately after connection.

A notification DTO contains `id`, `type`, `entityType`, `entityId`, `templateKey`, safe `templateParams`, localized `title` and `message`, safe `metadata`, `readAt`, `createdAt`, and `updatedAt`. Socket payloads currently render English text and always include `templateKey` plus parameters; clients may render those keys locally. Stable IDs allow event deduplication.

On token refresh, update `socket.auth.token`, disconnect, and reconnect. After every initial connection or reconnection, use the REST inbox as the authoritative missed-event synchronization source. Socket delivery is best effort, not exactly once.

### REST inbox

- `GET /notifications?page=1&limit=20&unreadOnly=true&type=ORDER_CONFIRMED`
- `GET /notifications/unread-count`
- `PATCH /notifications/:notificationId/read`
- `PATCH /notifications/read-all`
- `DELETE /notifications/:notificationId` (204)

All routes require authentication and enforce ownership. `Accept-Language: ar` or `en` controls REST titles and messages; unsupported or absent values use English. Supported types are order created/confirmed/shipped/delivered/cancelled, return requested/status updated, exchange requested/status updated, review pending, and low stock.

## Catalog localization

Supported locales are `ar` and `en`. Public catalog endpoints read `Accept-Language`; selection is requested locale, then English, then the legacy canonical field. Read operations never create or change translations. Search checks legacy and both translated product/brand text before pagination, regardless of display locale.

Localized entities and fields:

- Product: `name`, `shortDescription`, `description`, `material`, `seoTitle`, `seoDescription`.
- Brand, category, collection: `name`, `description`.
- Product option: `name`.
- Product option value: `displayValue`.
- Promotion: `name`, `description`.

Admin create/update bodies accept a `translations` map alongside all existing legacy fields:

```json
{
  "name": "Legacy/default name",
  "translations": {
    "ar": { "name": "حذاء رياضي", "description": "الوصف العربي" },
    "en": { "name": "Sports shoe", "description": "English description" }
  }
}
```

When supplied on create, the translation map contains both `ar` and `en` for product, brand, category, collection, and promotion schemas. Update accepts either locale independently. Omitting `translations` preserves all stored translations. Existing canonical fields remain accepted and returned for backward compatibility. Admin DTOs expose all translations as `{ ar?: {...}, en?: {...} }` (options use the same shape in their existing DTOs).

The aggregate product editor accepts translations under `product.translations`, `options[].translations`, and `options[].values[].translations`. Update places the same fields in the existing option/value upsert objects. Multipart media indexes and relationships are unchanged, and the entire aggregate remains transactional.

Public product/category/brand/collection DTOs retain their current shape but return localized display fields. IDs, canonical slugs, SKUs, inventory, relationships, and prices are shared across languages and never localized.

## Promotions

The existing `/admin/discounts` API remains the only administrative promotion API and still requires `DISCOUNTS_MANAGE_ANY`.

Routes:

- `GET /admin/discounts` and `GET /admin/discounts/:discountId`
- `POST /admin/discounts`
- `PATCH /admin/discounts/:discountId`
- `PUT /admin/discounts/:discountId/targets`
- `POST /admin/discounts/:discountId/activate`
- `POST /admin/discounts/:discountId/deactivate`
- `POST /admin/discounts/:discountId/archive`
- `GET /admin/discounts/:discountId/statistics`
- `DELETE /admin/discounts/:discountId` (retained; promotions with redemptions cannot be deleted)

Create/update example:

```json
{
  "name": "Weekend Sale",
  "description": "Selected footwear",
  "translations": {
    "ar": { "name": "عروض نهاية الأسبوع", "description": "أحذية مختارة" },
    "en": { "name": "Weekend Sale", "description": "Selected footwear" }
  },
  "code": null,
  "type": "PERCENTAGE",
  "scope": "PRODUCT",
  "priority": 20,
  "value": "3000",
  "currency": null,
  "minOrderMinor": null,
  "maxDiscountMinor": null,
  "usageLimit": 500,
  "perCustomerLimit": 1,
  "startsAt": "2026-09-25T00:00:00.000Z",
  "endsAt": "2026-09-28T00:00:00.000Z",
  "isActive": true,
  "combinable": false,
  "targets": [{ "productId": "uuid" }]
}
```

Scopes and target shapes are:

- `PRODUCT`: one or more `{ productId }`.
- `VARIANT`: one or more `{ variantId }`.
- `CATEGORY`: one or more `{ categoryId }`.
- `COLLECTION`: one or more `{ collectionId }`.
- `CATALOG`: empty targets.
- Existing `ORDER`: empty targets (also used by free shipping).

Each target object contains exactly one stable UUID. Target replacement is atomic and duplicate targets are rejected. `code: null` means `AUTOMATIC`; a non-null normalized code means `COUPON`. Percentage `value` is basis points (`3000` = 30%). Fixed values and all response money values are integer TND minor units (TND uses three decimal places in commerce). Authoritative calculations use `bigint`, never floating point.

Status is calculated as `SCHEDULED`, `ACTIVE`, `EXPIRED`, `DISABLED`, or `ARCHIVED`. No scheduler is required. Lower numeric priority has precedence. If the winning promotion is not combinable, only it applies. If it is combinable, all eligible combinable promotions apply in priority order to the remaining amount. A coupon rejected by those precedence rules is reported ineligible. A promotion is never applied twice and totals cannot become negative.

Catalog product lists add optional `minimumEffectivePriceMinor` and `promotionalPricing`. Product-detail variants add optional `promotionalPricing`:

```json
{
  "originalPriceMinor": "120000",
  "effectivePriceMinor": "84000",
  "discountMinor": "36000",
  "discountPercentageBasisPoints": "3000",
  "promotions": [{
    "discountId": "uuid",
    "name": "Weekend Sale",
    "type": "PERCENTAGE",
    "value": "3000",
    "amountMinor": "36000",
    "endsAt": "2026-09-28T00:00:00.000Z"
  }]
}
```

These fields are additive; original price fields are unchanged. Promotion names follow `Accept-Language`. Catalog pricing batches variants and promotion candidates, avoiding per-product promotion queries. Coupons and order-only discounts are not advertised as automatic catalog prices.

Cart, guest cart, checkout preview, authenticated order placement, and guest order placement use the same engine. Only eligible lines are discounted. Order placement locks promotion rows, checks global/per-customer usage in the transaction, creates one redemption per promotion/order, and snapshots original line price, final price, contribution, promotion ID/name/code/type/value. COD usage is consumed at order placement and released on cancellation while its historical redemption remains. Refunds/returns do not restore usage; statistics subtract refunds from associated paid revenue where recorded.

Statistics return `usageCount`, `associatedOrders`, `totalDiscountGrantedMinor`, and `revenueMinor`; the detail endpoint supplies status and schedule dates. Cancelled/released redemptions are excluded. Revenue is recorded paid amount less recorded refunds and is never inferred for unpaid orders.

## Deployment and frontend checklist

Apply migrations in order with the normal release database credentials, never against a test command: notifications, catalog localization, then advanced promotions. The deployment sequence is `prisma migrate deploy`, generate/build, then start the application. The localization migration enables `pg_trgm` and repeatably backfills existing canonical text into English translation rows; it does not invent Arabic text or remove legacy columns.

The notification outbox worker runs in the application process. One Railway web instance needs no broker. With multiple instances, database claiming remains safe, but real-time emission reaches only sockets on the processing instance; add a shared Socket.IO Redis adapter before horizontal scaling. Configure the production `CORS_ORIGINS` to include the exact frontend origin and optionally set `LOW_STOCK_THRESHOLD` (default `5`).

Frontend work is limited to connecting/reconnecting Socket.IO, synchronizing the REST inbox, sending `Accept-Language`, editing translation maps, rendering optional promotional pricing, and continuing to trust server cart/checkout/order totals. No frontend code is changed by this backend release.
