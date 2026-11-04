# Wishlists

Authenticated users can list, add, and remove only their own WishlistItems.
Concurrent duplicate adds converge on the schema uniqueness constraint. Listing
uses public-safe Product data and returns an explicit unavailable state for a
previously saved Product that is no longer publicly sellable.
