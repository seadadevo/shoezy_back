# Discounts

Admin CRUD supports Product, Variant, Category, Collection, and Catalog targets,
bilingual content, calculated schedule states, explicit activation/archive actions,
and usage statistics. Checkout, Cart, Orders, and public catalog pricing share one
integer-only engine. Percentage values are basis points rounded half-up; the lowest
priority wins, and only a combinable winner enables all eligible combinable discounts
in priority order. Order placement locks usage and writes redemptions transactionally;
COD cancellation releases limit consumption without deleting history.
