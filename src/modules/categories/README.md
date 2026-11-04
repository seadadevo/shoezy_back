# Categories

Administrative CRUD and the deterministic tree endpoint are mounted at
`/api/v1/admin/categories` under `categories.manage.any`. Slugs use the shared
Unicode-safe normalization policy. Parent changes traverse the stored parent
links and reject self-parenting, two-node cycles, and cycles at arbitrary depth.
The response tree sorts by `sortOrder`, then name, then id and defensively stops
if legacy corruption contains a cycle.

Deletion returns a conflict when the category has children or is referenced by
a ProductCategory or DiscountTarget.

Create and update accept JSON or multipart form data. Multipart fields are
`data` (JSON text), optional `image`, and optional `video` (MP4, at most 50 MB).
PATCH accepts `removeVideo: true` to remove an existing animation. The public
catalog category list and tree expose only `videoUrl` and `videoMimeType`.

Responsibilities:
- category tree
- category CRUD

Layering: routes -> validation -> controller -> service -> repository -> Prisma.
