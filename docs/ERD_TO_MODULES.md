# ERD -> Module map

| ERD tables | Module |
|---|---|
| users | auth, users |
| addresses | addresses |
| brands | brands |
| categories | categories |
| size_guides, size_guide_entries | size-guides |
| products, product_categories, product_media | products |
| product_options, product_option_values, product_variants, variant_option_values | variants/products |
| collections, collection_products | collections |
| discounts, discount_targets, discount_redemptions | discounts |
| carts, cart_items | carts |
| orders, order_addresses, order_items, order_status_history | orders |
| shipping_methods + order tracking fields | shipping |
| return_requests, return_items | returns |
| wishlists | wishlists |
| product_reviews | reviews |
