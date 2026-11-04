# Production operations

For Hostinger/Coolify, follow [COOLIFY-DEPLOY.md](../COOLIFY-DEPLOY.md). Its
release-image migration job runs before the API/worker starts, including the
first deployment. The Railway-specific notes below describe the previous host.

## Release policy

Build and test the exact release revision first. Back up PostgreSQL before the
release, then run `npm run prisma:deploy` (which executes native
`prisma migrate deploy`) once against the verified production database. Never use
`prisma db push` or `prisma migrate reset` in production. Seed only the idempotent
RBAC catalog when the release procedure calls for it; application fixture data is
not a production seed.

The application starts with `npm start` after `npm run build`. `GET /health`
returns `200` when the HTTP process is accepting requests. Set
`TRUST_PROXY_HOPS` to the exact number of trusted reverse proxies, not an
unbounded boolean. On SIGTERM/SIGINT the process stops accepting connections and
disconnects Prisma, with a ten-second forced-exit ceiling.

## Required environment

Use a secret manager for `DATABASE_URL`, distinct high-entropy
`JWT_ACCESS_SECRET`/`JWT_REFRESH_SECRET`, SMTP credentials, and social-provider
secrets. Production example placeholders are rejected. Configure the public
`CORS_ORIGINS`, `FRONTEND_URL`, cookie SameSite policy, and proxy hops for the
actual deployment. Never bake `.env` into an image or commit it; `.dockerignore`
excludes local environment files and review archives.
For a Vercel storefront and Railway API on different sites, set
`AUTH_COOKIE_SECURE=true`, `AUTH_COOKIE_SAME_SITE=none`, and include the exact
storefront origin in `CORS_ORIGINS`. Set `NEXT_PUBLIC_API_URL` on Vercel to the
Railway API's public `/api/v1` URL. Configure `SUPPORT_NOTIFICATION_EMAIL` on
Railway when support mail should use a different inbox; otherwise it falls back
to `ORDER_NOTIFICATION_EMAIL`.

### Railway order email

Set these variables on the Railway API service (in addition to the existing
database, JWT, URL, and cookie variables):

```text
SMTP_HOST=smtp.gmail.com
SMTP_PORT=465
SMTP_SECURE=true
SMTP_USER=<smtp-account-address>
SMTP_PASSWORD=<smtp-app-password>
MAIL_FROM=<verified-sender-address>
MAIL_FROM_NAME=Shoozy
ORDER_NOTIFICATION_EMAIL=<admin-order-address>
```

The SMTP credentials are a pair. For an unauthenticated SMTP relay, omit both
`SMTP_USER` and `SMTP_PASSWORD`. Production validates the SMTP host, sender, and
admin order address at startup. No separate Railway worker service is needed:
`npm start` runs the notification outbox worker inside the API process. Run
`npm run prisma:deploy` once using the new release image before starting the API
and its worker, and before serving the new version. The worker sends order email
after the order transaction commits and retries failed sends. Its sent timestamps prevent a
successfully recorded admin or customer send from repeating on later retries.
SMTP alone cannot guarantee exactly-once delivery if a process exits after the
provider accepts a message but before the sent timestamp is recorded.

### Exhausted notification recovery

The worker makes an eighth failed attempt terminal by leaving `processed_at`
null, setting `attempts` to `8`, releasing `locked_at`, retaining a sanitized
`last_error`, and storing the failure time in `available_at`. It excludes those
rows from automatic claims. List them with a read-only query:

```sql
SELECT id, type, attempts, last_error, available_at AS failed_at,
       admin_email_sent_at IS NOT NULL AS admin_email_sent,
       customer_email_sent_at IS NOT NULL AS customer_email_sent
FROM notification_outbox
WHERE processed_at IS NULL AND attempts >= 8
ORDER BY available_at DESC, id;
```

After diagnosing the cause, an authorized operator can requeue exactly one
event by ID:

```powershell
npm run notifications:retry -- 00000000-0000-4000-8000-000000000000
```

The command uses a transaction and guarded update to verify the event exists,
is exhausted, unprocessed, and unlocked, then resets only `attempts`,
`available_at`, and `locked_at`. It preserves the deduplication key, prior
`last_error`, admin and customer sent timestamps, and notification history. A
later successful attempt clears `last_error`. Never bulk-requeue historical
`processed_at` rows: legacy failures marked as processed cannot be reliably
distinguished from successes.

## PostgreSQL backup and restore examples

Run these only after independently verifying host and database identity. Do not
place credentials on the command line.

```powershell
pg_dump --format=custom --file=shoe_store_YYYYMMDD.dump --dbname=$env:DATABASE_URL
createdb shoe_store_restore_validation
pg_restore --exit-on-error --clean --if-exists --dbname=shoe_store_restore_validation shoe_store_YYYYMMDD.dump
```

Always restore into a separate validation database first, verify row counts and a
read-only smoke test, and retain the backup according to the organization's
retention/encryption policy.

## Rollback

Prisma deploy migrations are forward-only. Application rollback is safe only
while the previous binary remains compatible with the migrated schema. A database
rollback requires a reviewed compensating migration or restoring the pre-release
backup, both of which can lose post-backup writes. Never edit an applied migration
or attempt an automatic destructive reset.

## Verification

After migration and process start, verify `/health`, authentication, an anonymous
catalog read, and an authorized admin read. Watch sanitized error rates, database
connections, latency, stock conflicts, and order idempotency conflicts. Roll back
the application or stop traffic if health or core commerce invariants fail; do not
retry destructive database operations blindly.
