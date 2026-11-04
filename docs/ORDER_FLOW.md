# COD order flow

1. Customer or guest builds cart.
2. Backend reloads variants and current prices.
3. Validate stock_quantity for each variant.
4. Validate discount and usage limits.
5. Calculate shipping.
6. In one DB transaction create order, order_address, order_items snapshots and discount redemption.
7. Reduce/reserve variant stock using one consistent policy.
8. Initial order: status=PENDING, payment_method=COD, payment_status=PENDING.
9. Admin confirms -> CONFIRMED.
10. Assign tracking -> SHIPPED.
11. Delivery -> DELIVERED and mark COD as PAID with paid_minor/paid_at.
12. Cancellation restores stock when applicable and records history.
13. Return creates return_request + return_items.
14. Manual refund evidence/amount is recorded on return_request; no gateway call exists.
15. A full received Return moves DELIVERED -> RETURNED and writes Order history in the same transaction; a partial Return leaves the Order DELIVERED.
