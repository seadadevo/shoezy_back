# Role-Based Access Control

## Authority

Runtime authorization is loaded from current database state on every protected
request:

`User -> UserRole -> Role -> RolePermission -> Permission`

The legacy `users.role` enum is used only by seed backfill. It never authorizes a
request. Access JWTs contain only identity/session claims; role or permission
claims are neither issued nor trusted.

## System roles and catalog

Permission codes are explicit `resource.action.scope` strings from
`src/common/auth/rbac.constants.ts`. Wildcards and implicit ADMIN bypasses do not
exist.

- `CUSTOMER`: 18 own-scope profile, address, cart, order, return, wishlist, and
  review permissions.
- `ADMIN`: all 40 explicit permissions, including `dashboard.read.any`.

Administrative permissions are `users.read.any`, `users.manage.any`,
`brands.manage.any`, `categories.manage.any`, `size-guides.manage.any`,
`products.read.any`, `products.create.any`, `products.update.any`,
`products.delete.any`, `variants.manage.any`, `collections.manage.any`,
`discounts.manage.any`, `orders.read.any`, `orders.manage.any`,
`shipping.manage.any`, `returns.read.any`, `returns.manage.any`,
`reviews.read.any`, `reviews.moderate.any`, `dashboard.read.any`,
`rbac.read.any`, and `rbac.manage.any`.

## Request enforcement

`requireAuth` verifies the access token, active AuthSession, and active/non-deleted
User, then loads active roles and permissions from RBAC joins. Routes compose
`requirePermission` or `requireAnyPermission`. Anonymous access to a protected
route returns `401`; an authenticated user without permission receives `403`.
Removing a database assignment takes effect immediately for an existing token.

Own-scope permission is only the first gate. Repositories scope Address, Wishlist,
Cart, Order, shipment view, Review, and Return operations through the authenticated
owner/root relation. Cross-customer identifiers return `404` where practical.

## Route matrix

| Group | Anonymous | CUSTOMER | ADMIN |
| --- | --- | --- | --- |
| Public catalog/shipping/reviews | Allowed | Allowed | Allowed |
| Profile, Address, Wishlist, Cart, Checkout | Denied | Own scope | No implicit own grant |
| Customer Order/Return/Review mutations | Denied | Own scope | No implicit own grant |
| Admin catalog/discount/order/shipping/review/return/dashboard | Denied | Denied | Explicit permission |

An account holding multiple roles receives the union of active explicit
permissions. The automated route suites exercise anonymous, CUSTOMER, and ADMIN
paths; database suites exercise cross-owner denial.

## Seed

`prisma/seeds/rbac.seed.ts` upserts both roles and all permissions, replaces the
two role-permission mappings deterministically, and inserts legacy-user role joins
with duplicate-safe writes. Repeated seeds preserve 18 CUSTOMER permissions and
40 ADMIN permissions without duplicate joins.
