# Public catalog

Anonymous, bounded discovery routes expose only currently sellable Products and
public-safe related data. Active Variant `priceMinor` drives price filters and the
minimum-price display; Product Decimal `basePrice` drives the explicitly named
base-price sorts. Size and color filter through Product option values. Cost,
deletion, and administrative fields are never selected into public DTOs.

`GET /api/v1/catalog/products/:slug` includes `ratingSummary` with a numeric
one-decimal average, approved review count, and all five star buckets. Each
bucket has a count and a one-decimal percentage; empty products return zeroes.
The separate reviews endpoint keeps its existing `aggregate.averageRating`
string and `aggregate.count`, and adds `aggregate.distribution`.

`GET /api/v1/catalog/products/:slug/related?limit=8` returns `{ items: [...] }`
using the ordinary public product card DTO, including existing promotion and
availability fields. Limit is 1–20, default 8. Candidates must meet the normal
public visibility rule and cannot be the source product. Each shared category
scores 50, each currently available collection 35, brand 20, matching gender
10, and base-price similarity up to 15 within 25%. Ties use newest publication
then ID; remaining slots use newest visible products. Bounded 200-product
category and other-signal pools, one fallback query, and one batched
variant-pricing pass avoid per-card queries. Card ratings are deferred to avoid
a review query per card.

`POST /api/v1/catalog/products/:slug/shipping-preview` accepts JSON
`{ "countryCode": "TN", "state": "Tunis", "city": "Tunis", "area": null }`.
`area` is optional. It is anonymous and read-only. The response is
`{ "available": true, "methods": [{ "id": "...", "code": "STANDARD", "name": "Standard", "priceMinor": "2500", "currency": "TND", "estimatedMinDays": 2, "estimatedMaxDays": 4 }] }`.
The minor-unit amount is a string, consistent with shipping and checkout DTOs.
Unavailable destinations return `{ "available": false, "methods": [] }`.
Rates are address/method based; the existing engine has no quantity or weight
rate rules. ETA values come only from configured method or zone rates and can
be null.

Product card responses from catalog lists, collection details, and related
products expose `primaryMedia` as the best public IMAGE and `previewVideo` as
the first public VIDEO, or `null` when no video exists. Both use the existing
variant visibility rules and expose only `id`, `type`, `mediaType`, `mimeType`,
`url`, `altText`, `position`, and `isPrimary`. The card relation is bounded to
two rows per product; Product Detail continues to return its complete `media[]`.

`GET /api/v1/catalog/promotions` is anonymous and returns only promotions marked
for storefront display that are active, not archived, already started, and not
expired. Results use `sortOrder` ascending, then newest `startsAt`, then ID. The
single query selects presentation fields and translations only; coupon codes,
storage ownership fields, usage accounting, targets, and admin metadata are not
returned.
