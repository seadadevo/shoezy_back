# Products

Administrative Product CRUD and transactional category replacement are mounted
at `/api/v1/admin/products`. Reads require `products.read.any`; create, update,
and delete use their existing explicit permissions. New products are always
`DRAFT`. Product Decimal money is accepted and returned as strings, with
compare-at price required to be at least the base price.

`PUT /:productId/categories` replaces unique assignments in a bounded-retry
Serializable transaction and permits at most one included primary category.
Activation validates active brand/category and complete active variants; before
variants exist it deliberately returns `PRODUCT_NOT_READY`. First activation
sets `publishedAt`, and later draft transitions preserve it.

DELETE soft-deletes and moves the Product to `DRAFT`. Normal admin reads and
lists exclude deleted products; authorized lists can request
`includeDeleted=true`. Public-safe Product discovery is mounted separately under
`/api/v1/catalog`.

Nested option and value CRUD lives under `/:productId/options`. Reads reuse
`products.read.any`; mutations reuse `products.update.any`. Option names are
unique per Product and canonical values are unique per Option. A value already
selected by a Variant keeps its canonical `value`, while presentation fields
remain editable. Referenced options and values cannot be deleted.

Nested media CRUD under `/:productId/media` and multipart upload under `/:productId/media/upload` store validated URL metadata and assets.
Primary replacement is transactional and database-unique per Product; optional
Variant association is checked against the parent Product.

## Product Video Support

The media system supports image assets and optional product video:

- **Supported Video Format**: MP4 only (`video/mp4`). Container magic-byte validation enforces ISO Base Media File Format (`ftyp` box with standard compatible brands like `isom`, `mp41`, `mp42`, `avc1`).
- **Maximum Video Size**: 50 MB (`MAX_VIDEO_BYTES = 50 * 1024 * 1024`). Returns `MEDIA_VIDEO_TOO_LARGE` (HTTP 413) if exceeded. (Image upload limit remains 8 MB).
- **Storage Path**: `<UPLOAD_ROOT>/products/videos/<uuid>.mp4`, exposed publicly at `/uploads/products/videos/<uuid>.mp4`.
- **Static Serving & Streaming**: Express static middleware serves MP4 files with `Accept-Ranges: bytes`, proper `video/mp4` MIME, HTTP 206 Partial Content range request support for seeking/playback, and `Cross-Origin-Resource-Policy: cross-origin`.
- **Business Rules**:
  - Maximum **one video** per product (`MEDIA_VIDEO_LIMIT_EXCEEDED` / HTTP 409 if a second video is uploaded without replacement).
  - Video **cannot be primary cover** (`isPrimary` must be `false`; attempting `isPrimary: true` returns `MEDIA_VIDEO_CANNOT_BE_PRIMARY` / HTTP 422).
  - Deleting video does not alter product cover image.
  - Video is optional; products can have images only and no video.
  - Video replacement is supported atomically via `replaceVideo: true` on the upload endpoint, ensuring the previous file is deleted only after database update success, and newly uploaded files are cleaned up if database operations fail.
- **Recommended Client Encoding**: H.264 / AVC MP4 with AAC audio for broad browser compatibility. The backend does not perform server-side transcoding.
- **DTOs**: Both public catalog detail and admin detail DTOs expose `mediaType` (`"IMAGE"` | `"VIDEO"`), `mimeType` (`"video/mp4"`), and `type` for backwards compatibility. Catalog list/card views only select `IMAGE` covers.
