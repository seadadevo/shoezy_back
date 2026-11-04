# Shoozy Demo Dataset Documentation

This document describes the design, execution, credentials, idempotency, and safety mechanisms of the realistic demo data seed created for the Shoozy footwear platform.

---

## 1. Purpose
The purpose of the demo dataset is to populate the Shoozy backend and database with coherent, highly realistic e-commerce records so that administrators, partners, and clients can experience a fully operational storefront and administrative dashboard without manual setup or reliance on empty fallback states.

---

## 2. What Gets Seeded
The demo dataset populates:
1. **Store Settings**:
   - Store name: `Shoozy`
   - Currency: `TND` (Tunisian Dinar, 3 minor digits / millimes)
   - Support phone & WhatsApp: `+216 71 123 456` / `+216 20 123 456`
   - Support email: `support@shoozy.test`
   - Localized bilingual COD & shipping policy
   - Return & exchange policy windows: 14 days
   - WhatsApp confirmation enabled
   - *Safety Note*: Real/custom StoreSettings are preserved by default. Use `OVERWRITE_DEMO_STORE_SETTINGS=true` to force demo settings.
2. **RBAC & Administration**:
   - Ensures system roles (`ADMIN`, `CUSTOMER`) exist.
   - Demo Admin account: `admin.demo@shoozy.test` with complete administrative permissions.
3. **Demo Customers**:
   - 10 Tunisian customer accounts (`demo.customer01@shoozy.test` through `demo.customer10@shoozy.test`).
   - Verified email and phone statuses.
4. **Customer Delivery Addresses**:
   - 11 realistic addresses across Tunis, Ariana, Ben Arous, Sousse, Sfax, Nabeul, Monastir, Bizerte, and Gabès.
   - Default shipping addresses configured.
5. **Shipping Architecture**:
   - **Methods**: `DEMO_STD` (Standard Delivery, 7.000 TND base, 2-4 days) and `DEMO_EXP` (Express Delivery, 12.000 TND base, 1-2 days).
   - **Zones**:
     - `Demo Grand Tunis`: 6.000 TND (std) / 10.000 TND (exp)
     - `Demo Sahel & Coastal`: 7.000 TND (std) / 12.000 TND (exp)
     - `Demo Rest of Republic`: 8.000 TND (std) / 14.000 TND (exp)
   - **Zone Areas**: State-level mappings covering all 24 governorates.
   - **Zone Rates**: Custom rates per zone and method, ensuring immediate checkout eligibility.
6. **Brands**:
   - 5 footwear brands (`demo-shoozy`, `demo-urbanstep`, `demo-aerowalk`, `demo-novarun`, `demo-streetform`) with complete English and Arabic translations.
7. **Category Hierarchy**:
   - 12 categories in a 3-tier hierarchy:
     - `demo-men` -> `demo-men-shoes` -> `demo-men-sneakers`, `demo-men-running`, `demo-men-casual`
     - `demo-women` -> `demo-women-shoes` -> `demo-women-sneakers`, `demo-women-running`, `demo-women-lifestyle`
     - `demo-unisex` -> `demo-unisex-essentials`
   - Full Arabic & English translations.
8. **Collections**:
   - 4 curated product collections: `demo-new-arrivals`, `demo-best-sellers`, `demo-summer-essentials`, and `demo-weekend-picks`, with bilingual translations.
9. **Products & Variants**:
   - 12 realistic shoe models (`demo-shoozy-aero-runner`, etc.) across running, casual, lifestyle, and streetwear segments.
   - Dual-language names and descriptions.
   - Generic option model (`Size`: 37-44, `Color`: Black, White, Grey, Navy, Beige).
   - ~104 variants with unique deterministic SKUs (`SHZ-DEMO-AERO-BLK-42`, etc.).
   - Diverse inventory distribution: healthy stock (15-25), medium stock (6-10), low stock (1-3), and out-of-stock (0).
   - Configurable media assets via `DEMO_ASSET_BASE_URL`.
10. **Promotions & Discounts**:
    - `DEMO-WELCOME10`: 10% coupon (1000 basis points) for first-time orders over 50 TND.
    - `DEMO-SUMMER20`: 20% coupon (2000 basis points) targeted specifically to the Summer Essentials collection.
    - `Weekend Special 15%`: Automatic 15% promotional discount (1500 basis points) on orders above 100 TND, tracked by deterministic UUID.
    - `DEMO-SAVE10`: Fixed 10 TND coupon (10000 millimes) on orders above 80 TND.
11. **Homepage CMS Banners**:
    - 3 `HERO_SLIDER` banners with localized headlines, subheadings, and collection links, tracked by deterministic UUIDs.
    - 2 `TOP_BAR` announcement banners with shipping and COD highlights.
12. **Orders & COD Payments**:
    - 25 realistic orders spread chronologically across the last 30 days.
    - Status distribution: `DELIVERED` (10), `SHIPPED` (5), `CONFIRMED` (4), `PENDING` (3), `CANCELLED` (2), `RETURNED` (1).
    - Address-consistent shipping zones and rates (matching Grand Tunis, Sahel & Coastal, or Rest of Republic rates).
    - Correct price arithmetic (`subtotalMinor`, `discountMinor`, `shippingMinor`, `totalMinor`, `paidMinor`).
    - Complete `OrderStatusHistory` transition entries.
13. **Customer Reviews**:
    - 15 reviews with ratings from 3 to 5 stars, linked to verified purchase items from delivered orders.
    - Status distribution: 12 `APPROVED`, 2 `PENDING`, 1 `REJECTED`.
14. **Returns & Exchanges**:
    - 3 realistic return requests with reasons (`SIZE_INCORRECT`, `DEFECT`, `CHANGED_MIND`) and refund statuses.
    - 3 size-exchange requests (e.g., swapping size 41 for size 42).
15. **Notifications**:
    - 15 notifications covering customer lifecycle events and admin operational alerts (new orders, low stock, pending reviews).
16. **Wishlist & Cart**:
    - Pre-populated wishlist items for Customer 1.
    - Pre-populated active shopping cart for Customer 2.

---

## 3. Demo Credentials

All seeded demo accounts share the following password:

**Password**: `ShoozyDemo2026!`

| Role | Email | Password | Purpose |
| :--- | :--- | :--- | :--- |
| **Administrator** | `admin.demo@shoozy.test` | `ShoozyDemo2026!` | Admin Dashboard management, orders, catalog, banners, reviews |
| **Customer 1** | `demo.customer01@shoozy.test` | `ShoozyDemo2026!` | Grand Tunis resident with delivered orders, wishlist, reviews |
| **Customer 2** | `demo.customer02@shoozy.test` | `ShoozyDemo2026!` | Ariana resident with active shopping cart and shipped order |
| **Customer 3** | `demo.customer03@shoozy.test` | `ShoozyDemo2026!` | Ben Arous resident with processed return request |
| **Customer 4** | `demo.customer04@shoozy.test` | `ShoozyDemo2026!` | Sousse resident with completed size exchange |
| **Customers 5–10** | `demo.customer05@shoozy.test` ... `demo.customer10@shoozy.test` | `ShoozyDemo2026!` | Additional customers across Sfax, Nabeul, Monastir, Bizerte, Gabès |

---

## 4. Local Execution Commands

### Run Demo Seed
In Windows PowerShell:
```powershell
$env:ALLOW_DEMO_SEED="true"
npm run seed:demo
```
In Linux / macOS Bash:
```bash
ALLOW_DEMO_SEED=true npm run seed:demo
```

### Clean Demo Data
In Windows PowerShell:
```powershell
$env:ALLOW_DEMO_SEED="true"
npm run seed:demo:cleanup
```
In Linux / macOS Bash:
```bash
ALLOW_DEMO_SEED=true npm run seed:demo:cleanup
```

---

## 5. Railway / Staging Demo Environment Commands

To seed a dedicated demo database hosted on Railway:
```powershell
$env:ALLOW_DEMO_SEED="true"
$env:DATABASE_URL="postgresql://postgres:password@your-railway-demo-host:port/dbname"
npm run seed:demo
```

In Linux / Bash:
```bash
ALLOW_DEMO_SEED=true DATABASE_URL="postgresql://..." npm run seed:demo
```

---

## 6. Required Safety Flag (`ALLOW_DEMO_SEED`)

The demo seed script includes an environment safety assertion:
1. If `NODE_ENV === "production"`, `RAILWAY_ENVIRONMENT` is set, or `DATABASE_URL` references remote/cloud hostnames (such as `*.railway.internal`, `*.rlwy.net`, `*.railway.app`), execution **aborts immediately** unless `ALLOW_DEMO_SEED="true"` is explicitly provided.
2. In local development environments (`localhost`, `127.0.0.1`), it executes safely while checking environment parameters.

---

## 7. Product Media Strategy
- If `DEMO_ASSET_BASE_URL` is set (e.g. `https://res.cloudinary.com/your-cloud/image/upload/v1/shoozy/demo`), product and banner media will be seeded with corresponding image URLs.
- If `DEMO_ASSET_BASE_URL` is unset, products and banners will be seeded cleanly without broken placeholder URLs, ensuring zero 404 image errors on the storefront.

---

## 8. Idempotency Strategy
The seed script is fully idempotent and safe to run multiple times:
- Users are matched by unique `email`.
- Roles are assigned via composite unique key `userId_roleId`.
- Brands, categories, collections, and products are matched by unique `slug` (`demo-*`).
- Product variants are matched by unique `sku` (`SHZ-DEMO-*`).
- Options and values use composite unique keys `[productId, name]` and `[optionId, value]`.
- Coupon discounts are matched by unique `code` (`DEMO-*`).
- Automatic promotion is matched by unique deterministic UUID `DEMO_AUTO_DISCOUNT_ID`.
- Homepage banners are matched by unique deterministic UUIDs `DEMO_BANNER_IDS`.
- Promotional date windows (`startsAt`, `endsAt`) are refreshed upon re-run so demo promotions never expire during client testing.
- Shipping methods and zones use unique `code` and `name`.
- Orders use deterministic unique `orderNumber` (`SHZ-DEMO-ORD-XX`).
- Reviews use unique `orderItemId`.
- Return and exchange requests use unique `returnNumber` and `exchangeNumber`.
- Notifications use composite unique key `[recipientUserId, deduplicationKey]`.

Running the seed again updates existing demo records in place rather than creating duplicates.

---

## 9. Cleanup Strategy (`prisma/cleanup-demo.ts`)
The cleanup script only targets records that belong exclusively to the demo namespace:
- Users with `@shoozy.test` emails (cascading addresses, carts, wishlists, reviews).
- Orders with numbers starting with `SHZ-DEMO-ORD-`.
- Returns and exchanges starting with `SHZ-DEMO-RET-` and `SHZ-DEMO-EXC-`.
- Notifications with deduplication keys starting with `demo-notif-`.
- Specific demo product, category, collection, and brand slugs (`demo-*`).
- Shipping methods and zones with `DEMO_` codes and names.
- Homepage banners matching `DEMO_BANNER_IDS` (never deletes by generic CTA URLs).
- StoreSettings is preserved to keep store and checkout operational.

It **never** runs unscoped `deleteMany({})` and **never** touches non-demo records.

---

## 10. Known Limitations
- Demo orders simulate historical Cash on Delivery (COD) transactions; no payment gateway charges or external courier API dispatches take place.
- If `DEMO_ASSET_BASE_URL` is not provided, products have no media entries, preventing broken image links on client storefronts.
