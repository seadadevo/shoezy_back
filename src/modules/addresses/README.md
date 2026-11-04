# Addresses

Customer-owned endpoints are mounted at `/api/v1/addresses` for list, create,
detail, update, delete, and the idempotent `POST /:addressId/default` action.
Every repository lookup includes the authenticated `userId`; cross-customer
lookups deliberately return `ADDRESS_NOT_FOUND` to reduce enumeration.

The first address is automatically default. Default changes use PostgreSQL
Serializable transactions with at most three attempts so concurrent writes
maintain at most one default without changing the schema. Deleting a default
does not select a replacement. The only supported `AddressType` is `BOTH`.

Responsibilities:
- customer delivery addresses

Layering: routes -> validation -> controller -> service -> repository -> Prisma.
