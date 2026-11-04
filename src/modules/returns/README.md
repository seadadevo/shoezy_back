# Returns

Only owned delivered Orders are eligible. The Order row serializes requested
quantity accounting; non-rejected requests count against purchased quantity.
Workflow is `REQUESTED -> APPROVED|REJECTED` and
`APPROVED -> RECEIVED_AND_REFUNDED`.

Inventory is restored exactly once at physical receipt, and only for explicitly
restockable ReturnItems. Partial returns keep the Order delivered; it becomes
`RETURNED` only after all purchased quantities reach the terminal return state,
with OrderStatusHistory written in the same transaction.
COD refunds are recorded as manual/offline through `refundMethod`, amount, and
optional proof URL. No gateway refund occurs.
