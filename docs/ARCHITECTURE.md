# Architecture

## Pattern
Feature-first Modular MVC with Service + Repository:

`Route -> Validation -> Controller -> Service -> Repository -> Prisma -> PostgreSQL`

- **Route:** endpoint wiring and middleware only.
- **Validation:** Zod request schemas.
- **Controller:** HTTP-only orchestration; no database queries.
- **Service:** business rules, transactions and state transitions.
- **Repository:** all Prisma queries.
- **Model:** Prisma schema/client is the Model layer.

This keeps MVC clean while avoiding fat controllers and tightly coupled database code.

## Domain boundaries from the ERD
- Identity: auth, users, addresses
- Catalog: brands, categories, size-guides, products, variants, media, collections
- Commerce: discounts, carts, orders, shipping
- After-sales: returns/manual refunds
- Customer experience: wishlists, reviews
- Admin: composition only; reuse domain services

## Non-negotiable rules
- No online payment gateway or payment webhook module.
- COD is the default order payment method in the ERD.
- Order prices must be calculated server-side.
- `order_items` are immutable commercial snapshots.
- Every order status change writes `order_status_history`.
- Stock changes for a checkout/cancellation should be transactional.
- Return quantities cannot exceed delivered quantity minus already-returned quantity.
