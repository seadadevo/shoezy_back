# Checkout preview

`POST /api/v1/checkout/preview` validates the authenticated customer's Address,
active ShippingMethod, active Cart, sellability, stock, live prices, and current
discount eligibility. It performs no writes and reserves no inventory. The preview
is advisory; Order placement repeats every check inside its own transaction.

Guest checkout uses `POST /api/v1/guest/checkout/preview` and
`POST /api/v1/guest/orders` with an `X-Guest-Session` token. It accepts a
shipping address and optional email, then uses the same shipping, pricing,
promotions, COD, and inventory transaction as authenticated order placement.
Every new order queues the existing admin notification outbox event. Its worker
also emails the admin and, when an email was provided, the customer.
