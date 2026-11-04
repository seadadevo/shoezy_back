# Collections

Administrative CRUD uses Unicode-safe slugs and bounded lists. Product membership
replacement accepts unique `{ productId, position }` rows, rejects deleted
Products, and replaces the join set in a Serializable transaction. Collection
deletion removes only the Collection/join records and never Products.

Create and update accept JSON or multipart form data. Multipart fields are
`data` (JSON text), optional `image`, and optional `video` (MP4, at most 50 MB).
PATCH accepts `removeVideo: true` to remove an existing animation. Public
collection responses expose only `videoUrl` and `videoMimeType`.
