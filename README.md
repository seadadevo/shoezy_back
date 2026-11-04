# Shoe Store Node.js MVC Backend

This scaffold is organized from the supplied footwear-store ERD and intentionally contains **no online payment gateway**.

## Stack
- Node.js + TypeScript
- Express
- PostgreSQL
- Prisma ORM
- Zod
- JWT
- Vitest + Supertest

## Deployment

For the reviewed Dockerfile build, Coolify settings, runtime environment,
persistent uploads and controlled first-deployment migrations, see
[COOLIFY-DEPLOY.md](COOLIFY-DEPLOY.md) and [.env.coolify.example](.env.coolify.example).

## Architecture
`Route -> Validation -> Controller -> Service -> Repository -> Prisma -> PostgreSQL`

## Source ERD
The exact uploaded ERD is preserved at `docs/source-erd.dbml`.

## Module structure
Each feature follows:

```text
modules/orders/
├── orders.routes.ts
├── orders.validation.ts
├── orders.controller.ts
├── orders.service.ts
├── orders.repository.ts
├── orders.dto.ts
├── orders.types.ts
└── README.md
```

## Modules
- auth
- users
- addresses
- brands
- categories
- size-guides
- products
- variants
- collections
- discounts
- carts
- orders
- shipping
- returns
- wishlists
- reviews
- admin

## Recommended implementation order
1. Convert `docs/source-erd.dbml` exactly into `prisma/schema.prisma`.
2. First migration + seed.
3. Auth/users/addresses.
4. Catalog and variants.
5. Discounts.
6. Cart.
7. COD checkout/orders.
8. Shipping.
9. Returns/manual refunds.
10. Wishlist/reviews.
11. Admin APIs.
12. Unit/integration/E2E tests.
