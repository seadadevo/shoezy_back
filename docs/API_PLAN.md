# Shoozy API v1

This file inventories the routes currently mounted below `/api/v1`. It is a
description of implemented behavior, not a roadmap.

## Conventions

- JSON request objects are strict: unknown body, path, and query fields return
  `422`.
- Lists default to `page=1&limit=20`, cap `limit` at `100`, and return
  `{ items, pagination: { page, limit, total, totalPages } }`.
- `BigInt` money is always an integer minor-unit string at the API boundary.
  Product `Decimal` major-unit fields are also strings. Clients never submit
  authoritative prices, discounts, stock decisions, or totals.
- Authentication uses `Authorization: Bearer <access-token>`. The refresh token
  is an HttpOnly cookie scoped to `/api/v1/auth`.
- Stable domain conflicts return `409`; strict validation returns `422`; foreign
  owned-resource identifiers are normally indistinguishable from missing (`404`).

## Authentication, profile, and addresses

Public auth routes are `POST /auth/register`, `/auth/login`, `/auth/refresh`,
`/auth/verify-email`, `/auth/resend-verification`, `/auth/forgot-password`,
`/auth/reset-password`, `/auth/google`, and `/auth/facebook`. Authenticated routes
are `POST /auth/logout`, `/auth/logout-all`, and `/auth/change-password`. Auth
mutations use dedicated 15-minute rate limits.

`GET /users/me` and `PATCH /users/me` require `profile.read.own` and
`profile.update.own`. Address list/create/detail/update/delete and
`POST /addresses/:addressId/default` use the corresponding `addresses.*.own`
permission and always derive the owner from the authenticated user.

## Administrative catalog

All routes below require authentication and their explicit administrative
permission.

- `/admin/brands`: paginated CRUD; `brands.manage.any`.
- `/admin/categories`: paginated CRUD and `GET /tree`;
  `categories.manage.any`.
- `/admin/size-guides`: paginated CRUD plus nested entry CRUD;
  `size-guides.manage.any`.
- `/admin/products`: paginated core CRUD and
  `PUT /:productId/categories`; `products.read.any`, `products.create.any`,
  `products.update.any`, or `products.delete.any` by action.
- `/admin/products/:productId/options`: option/value CRUD;
  `products.read.any` or `products.update.any`.
- `/admin/products/:productId/variants`: Variant CRUD and
  `PATCH /:variantId/stock`; `variants.manage.any`.
- `/admin/products/:productId/media`: URL-metadata list/create/update/delete;
  `products.read.any` or `products.update.any`. Bodies support the schema fields
  `url`, optional `altText`, nonnegative `position`, `isPrimary`, `mediaType`, and
  nullable `variantId`. Variant ownership is checked against the parent Product.
- `/admin/collections`: paginated CRUD and
  `PUT /:collectionId/products`; `collections.manage.any`. Assignment body is
  `{ products: [{ productId, position }] }`, is unique, and replaces membership
  transactionally.

Collection and Product slugs use the shared Unicode-safe normalizer. Duplicate
slugs and single-primary conflicts are stable `409` responses. Media management
stores URL metadata only; it performs no upload or remote deletion.

## Public catalog and shipping choices

Anonymous routes are:

- `GET /catalog/products` and `/catalog/products/:slug`.
- `GET /catalog/products/:slug/related?limit=8` (limit 1–20).
- `POST /catalog/products/:slug/shipping-preview` with `countryCode`, `state`,
  `city`, and optional `area`; returns `available` and configured methods.
- `GET /catalog/brands`.
- `GET /catalog/categories` and `/catalog/categories/tree`.
- `GET /catalog/collections` and `/catalog/collections/:slug`.
- `GET /catalog/size-guides/:sizeGuideId`.
- `GET /shipping-methods`.
- `GET /catalog/products/:productId/reviews`.

Product detail adds numeric `ratingSummary.average`, `count`, and all five
`distribution` buckets with counts and percentages. Existing public review
`aggregate.averageRating` and `aggregate.count` remain; distribution is added.
Related items use the regular catalog card DTO. Shipping preview uses string
`priceMinor` amounts and returns an empty methods array for unsupported
destinations.

Product queries support `search`, `brand`, `category`, `collection`, `gender`,
`season`, `size`, `color`, `minPriceMinor`, `maxPriceMinor`, `inStock`, and the
allowlisted sorts `newest`, `nameAsc`, `nameDesc`, `basePriceAsc`, and
`basePriceDesc`. Price filters use active Variant `priceMinor`; base-price sorts
use the Product's Decimal `basePrice`. Size/color filters use option values.

Only published, active, non-deleted Products with an active Brand, at least one
active Category, and at least one active/non-deleted Variant are visible. A
zero-stock Variant remains visible. Public DTOs omit `costMinor`, deletion fields,
and administrative state.

## Discounts

`/admin/discounts` provides paginated CRUD and
`PUT /:discountId/targets`, guarded by `discounts.manage.any`. Bodies use
`PERCENTAGE`, `FIXED_AMOUNT`, or `FREE_SHIPPING`; `ORDER`, `PRODUCT`, or
`CATEGORY`; a unique nonnegative `priority`; integer-string values and optional
minor-unit bounds; optional uppercase coupon code; time bounds, limits,
`isActive`, `combinable`, and schema-supported Product/Category targets.

Eligibility uses server time with a half-open interval
`startsAt <= now < endsAt`. Percentage values are basis points and round half-up
to the nearest minor unit. Fixed allocations are deterministic and never reduce a
line below zero. Lowest numeric priority wins. If that winner is non-combinable,
only it applies; if combinable, all eligible combinable discounts apply in
priority order. Checkout and Orders share this exact engine.

## Wishlist and Cart

`GET /wishlist`, `POST /wishlist/items`, and
`DELETE /wishlist/items/:wishlistItemId` use `wishlist.read.own` or
`wishlist.manage.own`. Add body is `{ productId }`; duplicate concurrent adds are
idempotent. Listing uses public-safe Product data and marks unavailable entries.

Cart routes use `cart.read.own` and `cart.manage.own`:

- `GET /cart`, `DELETE /cart`.
- `POST /cart/items` with `{ variantId, quantity }`.
- `PATCH|DELETE /cart/items/:cartItemId`.
- `PUT|DELETE /cart/discount-code`.

The same Variant atomically increments one line. Mutations validate current stock
but do not reserve it. Cart reads recalculate live server pricing and return exact
minor-unit strings; Cart snapshots are not authoritative for an Order.

## Checkout and Orders

`POST /checkout/preview` requires `cart.read.own`, accepts `{ addressId,
shippingMethodId }`, and is rate-limited. It validates the owned Address, Cart,
sellability, stock, discounts, and active ShippingMethod without writing or
reserving inventory.

`POST /orders` requires `orders.create.own`, `{ addressId, shippingMethodId,
notes? }`, and a unique 16-128 character `Idempotency-Key` header. It supports COD
only. One Serializable transaction recalculates all values, creates immutable
Order/Address/Item/history snapshots, conditionally decrements stock, records
discount redemptions, and marks the Cart `ORDERED`. A committed key replays the
same Order; reuse by another operation returns `409`.

`GET /orders`, `GET /orders/:orderId`, and
`POST /orders/:orderId/cancel` require own-scope Order permissions. Customer
cancellation is only `PENDING -> CANCELLED` and restores stock exactly once.

Admin Order routes require `orders.read.any` or `orders.manage.any`:

- `GET /admin/orders` and `/admin/orders/:orderId`.
- `POST /admin/orders/:orderId/confirm|cancel|ship|deliver` with optional
  `{ reason }`.

Transitions are `PENDING -> CONFIRMED`, `PENDING|CONFIRMED -> CANCELLED`,
`CONFIRMED -> SHIPPED`, and `SHIPPED -> DELIVERED`. Every change writes history in
the same transaction. COD is marked paid only on delivery. Invalid transitions
return `409`.

## Shipping

`/admin/shipping-methods` is paginated CRUD guarded by `shipping.manage.any`.
Money inputs such as `basePriceMinor` are integer strings. The schema has no
Shipment model or carrier API. Admins set the existing Order fields with
`PATCH /admin/orders/:orderId/shipping`; customers read their derived shipment
view with `GET /orders/:orderId/shipment`. Shipping/delivery state changes use the
explicit Order transitions and history, never the tracking patch.

## Reviews

Authenticated customer routes are `POST /products/:productId/reviews` and
`PATCH|DELETE /products/:productId/reviews/:reviewId`, guarded by the matching
`reviews.*.own` permission. Create body is `{ orderItemId, rating, title?, body? }`
and rating is an integer from 1 through 5. Eligibility is derived from an owned,
delivered OrderItem for that Product. The schema guarantees one Review per
OrderItem, not one per customer/Product.

New/edited Reviews are `PENDING`. `/admin/reviews` and
`POST /admin/reviews/:reviewId/moderation` require `reviews.read.any` or
`reviews.moderate.any`. Only `APPROVED` Reviews are public or aggregated.

## Returns

`POST /orders/:orderId/returns` requires `returns.create.own`, is rate-limited,
and accepts `{ reasonCode, reasonDetails?, items: [{ orderItemId, quantity,
reasonCode? }] }`. Only an owned delivered Order is eligible. The Order row is
locked while active/terminal returned quantity is checked, so concurrent requests
cannot exceed purchased quantity.

`GET /returns` and `/returns/:returnId` require `returns.read.own`. Admin list,
detail, `POST /:returnId/decision`, and `POST /:returnId/receive` live below
`/admin/returns` and require `returns.read.any` or `returns.manage.any`. Workflow
is `REQUESTED -> APPROVED|REJECTED` and
`APPROVED -> RECEIVED_AND_REFUNDED`. Receipt accepts schema-supported manual
refund metadata and restockable ReturnItem IDs. Stock restores exactly once at
receipt. A fully returned Order moves to `RETURNED` with Order history; partial
returns remain `DELIVERED`. No gateway refund occurs.

## Operational dashboard

`GET /admin/dashboard/overview`, `/orders`, and `/inventory` require
`dashboard.read.any`. Activity ranges are explicit UTC-offset instants, half-open,
and at most 366 days. Lists are bounded. Overview separates placed Order value,
delivered Order value, collected COD value, pending COD, stock state, and pending
Returns. Amounts are minor-unit strings and are not labeled accounting revenue or
profit. Low-stock threshold is a bounded query parameter (default `5`), not a
persisted Product field.
