# Size Guides

Administrative guide and nested entry CRUD is mounted at
`/api/v1/admin/size-guides` under `size-guides.manage.any`. Optional brand links
must resolve to an existing brand; inactive brands remain valid for admin
editing and are never reactivated implicitly. Detail entries sort by
`sortOrder`, then id.

Entry `footLengthCm` is accepted and returned as a decimal string. Every entry
must retain at least one EU, US, UK, or foot-length measurement. Nested entry
lookups bind both guide and entry ids. Guide deletion is blocked while a Product
references it.
