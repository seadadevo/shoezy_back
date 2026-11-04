# Cart

Authenticated customers have at most one active cart. A line is identified by its
ProductVariant; adding the same Variant increments its quantity under a database
transaction. Mutations validate current sellability and stock, but the Cart does
not reserve inventory.

The persisted line price fields are refreshable snapshots only. Every Cart read,
Checkout preview, and Order placement uses live server-side pricing. Only Order
snapshots are historical commerce records.
