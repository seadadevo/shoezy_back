# Brands

Administrative CRUD is mounted at `/api/v1/admin/brands` and requires the live
RBAC permission `brands.manage.any`. Lists are paginated (20 by default, 100
maximum) and support bounded search, active-state filtering, and allowlisted
sorting. Slugs are Unicode-safe normalized values; collisions return 409.

Deletion is blocked with `BRAND_IN_USE` while any Product or SizeGuide refers to
the brand. Administrators can set `isActive=false` instead. No public brand API
is mounted yet.

Responsibilities:
- brand CRUD

Layering: routes -> validation -> controller -> service -> repository -> Prisma.
