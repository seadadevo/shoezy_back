# Authentication Database Foundation

> Current note: TASK 04 now implements the authentication workflows and RBAC that use this
> TASK 03 database foundation. See `AUTH.md` and `RBAC.md`. In particular, `users.role`
> is retained only for legacy compatibility and is never runtime authorization authority.

> **TASK 03 — DATABASE FOUNDATION ONLY**
> No authentication workflows, APIs, or middleware are implemented at this stage.
> This document describes only the schema and database infrastructure added in TASK 03.

---

## 1. User Identity Fields

The `users` table was established in TASK 02 and carries all core identity attributes:

| Field              | Type                                     | Notes                                                    |
|--------------------|------------------------------------------|----------------------------------------------------------|
| `id`               | `uuid` (PK)                              | Primary identifier                                        |
| `email`            | `varchar(320)` UNIQUE NOT NULL           | Canonical login identifier                                |
| `phone`            | `varchar(32)` UNIQUE, nullable           | Optional secondary identifier                             |
| `password_hash`    | `varchar(255)`, nullable                 | bcrypt hash stored in future; NULL for social users       |
| `first_name`       | `varchar(100)` NOT NULL                  |                                                           |
| `last_name`        | `varchar(100)` NOT NULL                  |                                                           |
| `status`           | `user_status` enum (`ACTIVE`, `INACTIVE`)| Controls account access                                   |
| `role`             | `user_role` enum (`CUSTOMER`, `ADMIN`)   | Legacy compatibility only; RBAC is authoritative          |
| `provider`         | `auth_provider` enum                     | `EMAIL`, `GOOGLE`, or `FACEBOOK`                         |
| `provider_id`      | `varchar(255)`, nullable                 | External OAuth subject; NULL for `EMAIL` users            |
| `email_verified_at`| `timestamptz`, nullable                  | Set when email is confirmed                               |
| `phone_verified_at`| `timestamptz`, nullable                  | Set when phone is confirmed                               |
| `last_login_at`    | `timestamptz`, nullable                  | Updated on successful authentication                      |
| `created_at`       | `timestamptz` NOT NULL, default now()    |                                                           |
| `updated_at`       | `timestamptz` NOT NULL, @updatedAt       |                                                           |
| `deleted_at`       | `timestamptz`, nullable                  | Soft-delete marker                                        |

---

## 2. AuthSession Purpose

`auth_sessions` represents **one authenticated login context** — a single device, browser, or API client session that has successfully completed a login flow.

Each row is the **refresh-token family anchor**: it owns one active refresh token (stored only as a hash), tracks rotation state, expiry, and revocation for that session.

---

## 3. Multiple-Device Sessions

`userId` carries **no uniqueness constraint** on `auth_sessions`. A single user may have an arbitrary number of concurrent active sessions (phone, desktop, tablet, etc.), each owning its own:

- `id` (session PK)
- `refresh_token_hash` (unique per row, globally)
- `user_agent` / `ip_address` (device metadata)
- `expires_at` / `revoked_at` (independent lifecycle)

This design directly supports future **logout-all-devices** (revoke all sessions for a `user_id`) and **single-device logout** (revoke a specific session by `id` or `refresh_token_hash`).

---

## 4. Refresh Token Storage — Hashes Only

**Raw refresh tokens are never stored.**

The application layer will later generate a cryptographically random token, return it to the client exactly once, and persist **only its digest** (`SHA-256` or equivalent) in `refresh_token_hash VARCHAR(255)`.

On every refresh request the application will:
1. Look up the session by `id` (session family identifier, safe to transmit).
2. Hash the received raw token.
3. Compare with `refresh_token_hash` using a constant-time comparison.

`refresh_token_hash` carries a `UNIQUE` constraint — two sessions cannot accidentally share the same hash, providing an additional safety invariant.

---

## 5. Session Revocation Fields

| Field          | Purpose                                                                                  |
|----------------|------------------------------------------------------------------------------------------|
| `revoked_at`   | Timestamp of explicit revocation (logout, password change, admin action, replay reaction) |
| `revoke_reason`| Optional human/machine-readable reason code (e.g., `"logout"`, `"password_changed"`, `"replay_detected"`) |
| `expires_at`   | Hard expiry; expired sessions are inactive even if not explicitly revoked                 |

A session is **active** iff: `revoked_at IS NULL AND expires_at > now()`.

The schema supports:
- **Single-session logout**: set `revoked_at` on one row.
- **Logout-all-devices**: set `revoked_at` on all rows where `user_id = ?`.
- **Password-change invalidation**: revoke all sessions for the user.
- **Replay detection**: revoke the session (and optionally all user sessions) when a replayed token is detected.

---

## 6. `rotationCounter` Purpose

`rotation_counter INTEGER DEFAULT 0` provides an **atomic rotation guard**:

- Incremented on every successful refresh token rotation.
- Stored alongside `refresh_token_hash`.
- Future service logic can use an optimistic-locking pattern (`WHERE rotation_counter = ?`) to atomically detect and reject concurrent refresh attempts with an old token (replay protection).

The database enforces `rotation_counter >= 0` via a `CHECK` constraint (`auth_sessions_rotation_counter_nonnegative_chk`).

---

## 7. PasswordResetToken — Single-Use Design

`password_reset_tokens` supports a future **secure password-reset flow**:

1. Application generates a random token, hashes it, inserts a row with `expires_at` set to a short future window.
2. The raw token is sent via email (never logged or stored).
3. On receipt the application: hashes the incoming token → looks up `token_hash` → validates `used_at IS NULL AND revoked_at IS NULL AND expires_at > now()`.
4. On success: sets `used_at = now()` atomically; proceeds with the password update.

**Single-use guarantee**: once `used_at` is set the token cannot be reused. Expired and revoked tokens are also rejected.

No raw token, OTP, plaintext password, or new password is stored in this table.

---

## 8. EmailVerificationToken — Single-Use Design

`email_verification_tokens` supports a future **email verification flow** identical in lifecycle to password reset tokens:

1. Application generates a random token, hashes it, inserts a row.
2. Raw token sent via email.
3. On receipt: hashes token → looks up `token_hash` → validates `used_at IS NULL AND revoked_at IS NULL AND expires_at > now()`.
4. On success: sets `used_at = now()`; marks `users.email_verified_at = now()`.

---

## 9. `emailSnapshot` — Email Binding

`email_snapshot VARCHAR(320) NOT NULL` binds the verification token to a **specific target email address**.

**Why this matters**: if a user changes their registered email address between requesting verification and clicking the link, a stale token should not blindly verify the new address. The application must validate that `email_snapshot` matches the address it intends to verify before accepting the token.

This prevents token-reuse across email changes, a common subtle security gap.

---

## 10. Token Expiration

All three security-token tables include `expires_at TIMESTAMPTZ NOT NULL`. Expiration is enforced in **application logic** (query predicate: `expires_at > now()`), not by database triggers.

Database-level invariants enforced:
- `expires_at > created_at` — tokens must expire after they were created (static `CHECK` constraint, e.g., `auth_sessions_expires_at_valid_chk`).

Indexes on `expires_at` allow efficient **cleanup of expired rows** in future background jobs without full-table scans.

---

## 11. Token Hash Uniqueness

| Table                       | Unique Hash Column      | Constraint                                          |
|-----------------------------|-------------------------|-----------------------------------------------------|
| `auth_sessions`             | `refresh_token_hash`    | `auth_sessions_refresh_token_hash_key`              |
| `password_reset_tokens`     | `token_hash`            | `password_reset_tokens_token_hash_key`              |
| `email_verification_tokens` | `token_hash`            | `email_verification_tokens_token_hash_key`          |

Global uniqueness ensures:
- No two active sessions accidentally share a token digest.
- Hash collisions (cryptographically improbable with SHA-256+) are rejected at the database level.

---

## 12. No Raw Tokens Stored

The database contains **zero columns** for:

- `refresh_token` / `raw_refresh_token` / `plaintext_token`
- `access_token` / `jwt`
- `token` (reset or verification)
- `otp` / `code` (plaintext)

All token-related columns are named with the `_hash` suffix and store only the cryptographic digest.

---

## 13. No JWT Secrets Stored in the Database

The following belong in **environment / secret management only**:

- `JWT_ACCESS_SECRET`
- `JWT_REFRESH_SECRET`
- Google OAuth `client_secret`
- Facebook OAuth `client_secret`
- SMTP credentials
- Encryption master keys

None of these appear as database columns in any model. The `src/config/env.ts` reads them from environment variables at runtime.

---

## 14. Email / Google / Facebook Provider Strategy

Authentication provider identity is stored directly on the `users` table:

```
provider     auth_provider   -- EMAIL | GOOGLE | FACEBOOK
provider_id  varchar(255)    -- NULL for EMAIL users; OAuth subject for social
```

This is the current ERD architecture decision. A separate `oauth_accounts` / `social_accounts` join table was **explicitly deferred** to a later task.

The current structure supports:
- `EMAIL` users: `provider = 'EMAIL'`, `provider_id = NULL`.
- `GOOGLE` users: `provider = 'GOOGLE'`, `provider_id = '<google_sub>'`.
- `FACEBOOK` users: `provider = 'FACEBOOK'`, `provider_id = '<facebook_id>'`.

Future authentication services **must require a non-null external provider ID** for `GOOGLE` and `FACEBOOK` users. `provider_id` may remain `NULL` only for `EMAIL` users.

---

## 15. `provider` + `provider_id` Uniqueness

**Decision: IMPLEMENT** — a composite unique constraint was added in TASK 03.

```sql
CREATE UNIQUE INDEX "users_provider_provider_id_key"
  ON "users"("provider", "provider_id");
```

In Prisma schema:
```prisma
@@unique([provider, providerId])
```

**NULL safety for EMAIL users**: PostgreSQL treats `NULL` values as *distinct* in unique indexes. Two `EMAIL` users with `provider_id = NULL` do not conflict, because `NULL != NULL` in uniqueness evaluation. This is correct and intentional — `EMAIL` accounts are uniquely identified by `email`, not by `provider_id`.

**Security invariant**: a Google or Facebook external identity (non-NULL `provider_id`) **cannot be claimed by more than one account**, preventing account hijacking via OAuth.

---

## 16. Historical TASK 03 API Scope (Superseded by TASK 04)

The not-implemented status below describes TASK 03 at the time this foundation was created.
TASK 04 now mounts the complete authentication surface documented in `AUTH.md`.

The following endpoints are **NOT implemented** in TASK 03:

| Endpoint                    | Status        |
|-----------------------------|---------------|
| `POST /auth/register`       | Not started   |
| `POST /auth/login`          | Not started   |
| `POST /auth/refresh`        | Not started   |
| `POST /auth/logout`         | Not started   |
| `POST /auth/forgot-password`| Not started   |
| `POST /auth/reset-password` | Not started   |
| `POST /auth/verify-email`   | Not started   |
| `GET /auth/google`          | Not started   |
| `GET /auth/facebook`        | Not started   |

At TASK 03 completion, `src/routes/index.ts` did not mount auth routes. TASK 04 has replaced those placeholders and mounts the routes documented in `AUTH.md`.

---

## 17. Historical TASK 03 Authorization Scope (Superseded by TASK 04)

TASK 04 now provides database-backed `requireAuth`, explicit permission middleware,
ownership policies, and RBAC tables. See `RBAC.md` for the authoritative design.

The following are **NOT implemented** in TASK 03:

- `requireAuth` JWT-verification middleware (placeholder only in `auth.middleware.ts`)
- `requireAdmin` role guard (placeholder only)
- Ownership authorization checks
- Permissions / RBAC database tables
- MFA / 2FA / TOTP infrastructure
- Login-attempt tracking / account lockout

Authorization and hardened authentication middleware belong to later tasks.

---

## 18. TASK 03 Migration

| Attribute           | Value                                                               |
|---------------------|---------------------------------------------------------------------|
| Migration name      | `20260811002016_auth_database_foundation`                           |
| Migration path      | `prisma/migrations/20260811002016_auth_database_foundation/migration.sql` |
| Baseline (TASK 02)  | `prisma/migrations/20260810194500_init/migration.sql` — **IMMUTABLE, untouched** |
| Generation method   | `prisma migrate diff --from-schema-file ... --to-schema-file ... --script` (schema-to-schema, no real DB reset) |
| Scope               | Incremental only — adds 3 tables, 3 FKs, indexes, unique constraints, and CHECK constraints |

### New Objects in TASK 03 Migration

**Tables created:**
- `auth_sessions`
- `password_reset_tokens`
- `email_verification_tokens`

**Foreign keys added:**
- `auth_sessions.user_id -> users.id` (CASCADE)
- `password_reset_tokens.user_id -> users.id` (CASCADE)
- `email_verification_tokens.user_id -> users.id` (CASCADE)

**Unique constraints added:**
- `users_provider_provider_id_key` on `(provider, provider_id)`
- `auth_sessions_refresh_token_hash_key` on `refresh_token_hash`
- `password_reset_tokens_token_hash_key` on `token_hash`
- `email_verification_tokens_token_hash_key` on `token_hash`

**Indexes added:**
- `auth_sessions_user_id_revoked_at_idx`
- `auth_sessions_expires_at_idx`
- `password_reset_tokens_expires_at_idx`
- `password_reset_tokens_user_id_created_at_idx`
- `email_verification_tokens_expires_at_idx`
- `email_verification_tokens_user_id_created_at_idx`

**CHECK constraints added (manual SQL appended after generated migration):**
- `auth_sessions_rotation_counter_nonnegative_chk` — `rotation_counter >= 0`
- `auth_sessions_expires_at_valid_chk` — `expires_at > created_at`
- `auth_sessions_revoked_at_valid_chk` — `revoked_at IS NULL OR revoked_at >= created_at`
- `auth_sessions_last_used_at_valid_chk` — `last_used_at IS NULL OR last_used_at >= created_at`
- `password_reset_tokens_expires_at_valid_chk` — `expires_at > created_at`
- `password_reset_tokens_used_at_valid_chk` — `used_at IS NULL OR used_at >= created_at`
- `password_reset_tokens_revoked_at_valid_chk` — `revoked_at IS NULL OR revoked_at >= created_at`
- `email_verification_tokens_expires_at_valid_chk` — `expires_at > created_at`
- `email_verification_tokens_used_at_valid_chk` — `used_at IS NULL OR used_at >= created_at`
- `email_verification_tokens_revoked_at_valid_chk` — `revoked_at IS NULL OR revoked_at >= created_at`

No `NOW()` or volatile-time semantics are used inside `CHECK` constraints.
No baseline tables were recreated. No `DROP TABLE` or `DROP DATABASE` statements exist.
