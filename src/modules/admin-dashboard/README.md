# Admin dashboard

Operational reports use database aggregates and bounded lists. Activity date
ranges are half-open UTC instants (`dateFrom <= createdAt < dateTo`) and are capped
at 366 days. Current-state balances - pending COD, stock, customers, products, and
pending returns - do not inherit activity filters.

Money is reported as exact minor-unit strings. Metrics distinguish placed Order
value, delivered Order value, and collected COD value; none is labeled accounting
revenue or profit.
