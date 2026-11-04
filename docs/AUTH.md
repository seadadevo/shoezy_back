# Authentication and Authorization

## HTTP endpoints

All routes are under `/api/v1/auth` and accept JSON:

| Method | Path | Purpose |
|---|---|---|
| POST | `/register` | Create an EMAIL customer and send verification |
| POST | `/verify-email` | Consume a single-use verification token |
| POST | `/resend-verification` | Revoke old verification tokens and send another |
| POST | `/login` | Create a device session for a verified EMAIL account |
| POST | `/refresh` | Rotate the HTTP-only refresh cookie |
| POST | `/logout` | Revoke the authenticated session |
| POST | `/logout-all` | Revoke every session for the authenticated user |
| POST | `/forgot-password` | Send an enumeration-safe reset response |
| POST | `/reset-password` | Consume a reset token, change the password, revoke sessions |
| POST | `/google` | Verify a Google ID token server-side and sign in |
| POST | `/facebook` | Verify a Facebook access token/app ID server-side and sign in |

Every schema is strict. Public callers cannot set `role`, `roles`, `permissions`, `status`, `isAdmin`, provider identity, or verification state. Public and social account creation always writes the legacy `CUSTOMER` value and assigns the current RBAC `CUSTOMER` role in the same transaction.

## Email and password lifecycle

Emails are trimmed and lowercased. Dots and `+` aliases are not rewritten. Passwords require at least 12 characters and at most 72 UTF-8 bytes, preventing bcrypt truncation while supporting Unicode. They are hashed with bcrypt using `BCRYPT_ROUNDS` (10-14, default 12). Passwords and hashes are never logged or returned.

Verification and reset values are 32-byte cryptographically random tokens. Only their SHA-256 hashes are persisted. Verification is single-use, expiry/revocation aware, atomically consumed with the user update, and bound to `emailSnapshot`. Resending revokes earlier active tokens.

Forgot-password responses are identical for known and unknown email addresses. A successful reset atomically consumes the token, stores the new bcrypt hash, revokes remaining reset tokens, and revokes every user session. It does not automatically sign in.

Mail is behind `AuthMailService`; automated tests use fakes. The SMTP implementation reads configuration only from environment variables and never logs credentials or raw tokens.

## Access and refresh tokens

Access JWT claims are only `sub`, `sid`, `typ=access`, plus standard `iat`, `exp`, issuer, and audience. Roles and permissions are absent. `requireAuth` checks the current database session, user state, roles, and permissions on every request.

Refresh JWT claims are `sub`, `sid`, `rot`, `jti`, and `typ=refresh`. Access and refresh secrets must differ. Raw refresh JWTs exist only in the HTTP-only cookie; `auth_sessions.refresh_token_hash` stores SHA-256 only.

Rotation is an atomic conditional update over session ID, user ID, current hash, current rotation counter, non-revoked state, and absolute expiry. Only one concurrent request can win. A request that initially validated but loses that race receives `AUTH_REFRESH_CONFLICT` without revoking the winning session. A correctly signed token that is already stale when read is rejected as `AUTH_REFRESH_REUSED` and revokes its token family. Rotation never extends `AuthSession.expiresAt`, so sessions have fixed absolute lifetime.

Cookie settings are centralized. Production cookies are secure, `SameSite` is validated, and clearing uses the same path/options. Credentialed CORS uses the explicit `CORS_ORIGINS`; wildcard credentialed origins are not allowed.

## Google and Facebook

Google uses `google-auth-library` to verify signature, issuer/expiry, audience (`GOOGLE_CLIENT_ID`), subject, email, and verified-email status. Facebook calls the Graph debug-token endpoint, requires `is_valid`, checks `app_id` and expiry, then fetches the profile for the verified user ID. Client-supplied profile or role fields are ignored.

Identity is `(provider, providerId)`. If a different identity presents an email already used by any account, the API returns `AUTH_SOCIAL_ACCOUNT_CONFLICT`; accounts are never linked or overwritten silently.

## Error semantics

- 401: credentials/JWT/session/refresh authentication is absent or invalid.
- 403: the current user is authenticated but inactive, unverified, lacks permission, or fails ownership.
- 409: safe email/provider identity conflict.
- 422: strict request validation failure.
- 429: focused auth rate limit exceeded.
- 503: required provider, RBAC role, or email delivery configuration is unavailable.

Unexpected persistence details, Prisma codes, constraint names, passwords, bearer tokens, cookies, and provider tokens are never returned.

## Environment

See `.env.example`. Required core settings are `DATABASE_URL`, distinct 32+ character `JWT_ACCESS_SECRET` and `JWT_REFRESH_SECRET`, access/refresh durations using `s`, `m`, `h`, or `d`, and an explicit `CORS_ORIGINS`. Email auth settings include bcrypt, verification/reset durations, cookie settings, SMTP variables, `MAIL_FROM`, and `FRONTEND_URL`. Google and Facebook settings are optional until their endpoints are used, so missing OAuth configuration does not prevent email auth startup.

## Postman flow

1. Register with email, password, first name, and last name.
2. Obtain the verification link from the configured development mail transport and submit its token to `/verify-email`.
3. Log in and copy the returned access token for `Authorization: Bearer <token>`.
4. Call a protected route when one exists; unfinished business routes are intentionally not mounted.
5. Call `/refresh`. Postman retains and sends the HTTP-only cookie automatically; no refresh token is exposed in JSON.
6. Call `/logout` or `/logout-all` with the access bearer token.

For cross-origin browser clients, enable credentials on the client and use the exact configured origin.

## Security assumptions and exclusions

TLS is required in production. Secrets belong in a secret manager, not source control. SMTP and social-provider live validation require external configuration and are not exercised by automated tests. MFA, account linking, API keys, RBAC management APIs, and business feature APIs are out of scope.
