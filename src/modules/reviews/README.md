# Reviews

Reviews require an authenticated customer's delivered OrderItem for the same
Product. The server derives verified-purchase state. The schema guarantees one
Review per OrderItem; it does not guarantee one Review per customer/Product, so a
customer with multiple delivered OrderItems can review each purchase once.

New and edited Reviews are `PENDING`. Admin moderation explicitly approves or
rejects them; only approved Reviews are public and included in database-calculated
rating count/average.
The public product detail rating summary and reviews distribution share the
same approved, published, publicly visible review filter. No rating aggregate
is stored on Product.
