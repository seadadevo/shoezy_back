# Product Variants and Stock

Administrative Variant CRUD is mounted beneath
`/api/v1/admin/products/:productId/variants` and requires
`variants.manage.any`. SKU and non-empty barcode values retain PostgreSQL's
case-sensitive uniqueness behavior; empty barcode input normalizes to null.
Variant money uses strict signed-BIGINT-range integer strings and is always
returned as strings. Native BigInt values never reach Express JSON.

Every Variant selects exactly one value from every Product Option, with all
values owned by the route Product. Mapping replacement is transactional. The
service detects duplicate non-empty combinations, while the immutable ERD means
this check is not database-concurrency-proof; SKU remains the authoritative
database-unique inventory identity.

DELETE is a soft delete. Disabling or deleting the last active Variant of an
ACTIVE Product is protected in a bounded-retry Serializable transaction.
`PATCH /:variantId/stock` supports atomic SET, INCREMENT, and conditional
DECREMENT; insufficient stock returns 409 and stock cannot become negative.
