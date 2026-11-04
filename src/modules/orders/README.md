# Orders

Order placement supports Cash On Delivery only and requires a durable
`Idempotency-Key` header. In one Serializable PostgreSQL transaction it validates
the customer, Address, active Cart, current Product/Variant state, stock, pricing,
discount usage, and Shipping Method; creates immutable Order/Address/Item/history
snapshots and discount redemptions; conditionally decrements stock; and marks the
Cart `ORDERED`. Any failure rolls back every write.

The selected ShippingMethod determines the snapshotted shipping amount. The
current schema does not retain a ShippingMethod foreign key on Order. Shipment
carrier and tracking fields are managed later through explicit admin workflows.

Status transitions are explicit:

- Customer: `PENDING -> CANCELLED`.
- Admin: `PENDING -> CONFIRMED`, `PENDING|CONFIRMED -> CANCELLED`,
  `CONFIRMED -> SHIPPED`, and `SHIPPED -> DELIVERED`.

Cancellation restores stock exactly once. Delivery records COD collection by
setting `paymentStatus=PAID`, `paidMinor=totalMinor`, and `paidAt` in the same
transaction as the status and history entry.
