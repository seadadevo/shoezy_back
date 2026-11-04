# Shoozy backend on Hostinger / Coolify

This is an operator runbook. Preparation does not deploy, migrate, commit, push,
or change Railway/Vercel. Replace every example hostname and placeholder. Review
and push the code yourself, then deploy the exact reviewed commit. Keep automatic
deployments and previews disabled during the first cutover.

## 1. What the image runs

The root Dockerfile keeps the existing **single-stage `node:22-alpine`** build.
The committed lockfile selects Prisma CLI/client/adapter-pg **7.9.1**, TypeScript
**6.0.3**, Express **5** and Socket.IO **4.8.3**. Prisma's Node requirement is
`^20.19 || ^22.12 || >=24`; the locked ESLint requires at least **22.13** on
the Node 22 line. Use a maintained Node 22 Alpine tag that satisfies these
requirements. This preparation host uses Node 24; that does not verify Alpine.
See [Prisma system requirements](https://docs.prisma.io/docs/orm/reference/system-requirements).

`npm ci --include=dev` keeps TypeScript, Prisma CLI, and `tsx`: release migrations
and the existing maintenance scripts remain usable in the image. This trades
image size for a simple, compatible release job. Do not prune devDependencies
without providing a matching migration/maintenance image.

OpenSSL is installed explicitly for Prisma's Alpine migration tooling. Client
generation uses a dummy build URL and never contacts PostgreSQL. TypeScript
outputs `dist/src/server.js`; Docker starts it directly as `node` (UID/GID 1000),
so SIGTERM reaches Node as PID 1. `npm start` targets the same server. The image
retains Prisma schema, all 17 migrations, generated `node_modules/.prisma`,
`@prisma/client`, `@prisma/adapter-pg`, `pg`, `prisma.config.ts`, and seed sources.
The existing driver reads the real `DATABASE_URL` at runtime. Prisma 7 uses
`PrismaPg`; the configuration and generator are preserved.

The build context allowlist admits only build inputs and safe env examples.
Tests and seeds are build inputs because the current tsconfig includes them.
Environment files, Git/editor/agent credentials, uploads, private exports, logs,
archives, dependency directories and previous build outputs are excluded. Only
`prisma/migrations/**/migration.sql` is allowed through the SQL-file exclusion.
No real backend secret is required as a Docker build argument.

## 2. Prepare the Hostinger VPS

1. Install/update a supported Linux release, Docker and Coolify using the
   [official installation guide](https://coolify.io/docs/get-started/installation).
   Connect and validate the server in Coolify; confirm its proxy is running.
2. Use SSH keys, restrict SSH to operator/Coolify source IPs, retain recovery
   access, and protect the dashboard with HTTPS and account authentication.
3. Allow inbound 80/443 for the proxy. Restrict dashboard/bootstrap access to
   trusted operators. Self-hosted direct-IP setup can also use 8000/6001/6002;
   close public access once the dashboard works through its HTTPS domain.
   Docker-published ports need provider/Docker-aware firewall rules; ordinary
   UFW rules alone may not protect them. See [Coolify firewall guidance](https://coolify.io/docs/core/infrastructure/servers/firewall).
4. Leave application port 3000 and database port 5432 unpublished. Permit outbound
   HTTPS for image/npm downloads and outbound Gmail TCP 465 (or 587 if configured).
5. Check actual RAM, CPU, swap and free disk in Hostinger; do not assume resources
   from the KVM plan name. Budget space for PostgreSQL, uploads, independent
   backups and several Docker images/build caches. Watch memory during npm/tsc
   builds; run one build at a time initially. Monitor disk, inode and RAM usage.
   Store tested backups outside this VPS as well as any operational local copies.

## 3. Create the Coolify application

Connect GitHub through a Coolify GitHub App or read-only deploy key with access to
the repository. In the project and production environment select **+ New**, choose
the Git source, then select the repository and branch. This application uses the
root Dockerfile, not the local-development `docker-compose.yml`.

| Setting | Initial value |
| --- | --- |
| Name | `shoozy-backend` |
| Source | Your GitHub repository |
| Branch | `main`, pointing at the reviewed release commit |
| Build pack during creation / Build strategy | `Dockerfile` |
| Base Directory | `/` |
| Dockerfile Location | `/Dockerfile` |
| Dockerfile target stage | Empty (single-stage) |
| Ports Exposes | `3000` |
| Port Mappings | Empty |
| Install / Build / Start command overrides | Empty; use the Dockerfile |
| Pre-deployment command | Empty; use the controlled release job below |
| Post-deployment command | Empty |
| Replicas | One |
| Advanced > Auto Deploy | Disabled until the release procedure is established |
| Advanced > Build > Build arguments | `Managed manually in Dockerfile` (no backend secret ARGs) |
| Advanced > Stop Grace Period (seconds) | `15` (application ceiling is 10 seconds) |

These build field names were checked against the current
[Dockerfile guide](https://coolify.io/docs/applications/builds/dockerfile) and
[Advanced settings](https://coolify.io/docs/applications/configuration/advanced).
Older Coolify releases may group controls differently; match the setting's
meaning and record the installed version.

Under **Domains > Add domain**, set Protocol `https`, Domain `api.example.com`,
Port `3000`, and leave Path empty. Enable **Redirect HTTP to HTTPS**. In older
versions with a URL field, enter `https://api.example.com`. Route the whole host:
`/api/v1`, `/uploads`, `/health`, and `/socket.io/` all need to reach this process.
The container listens on `0.0.0.0` at `PORT`. Visitors use HTTPS port 443; no public
host-port mapping is needed. See [General settings](https://coolify.io/docs/applications/configuration/general)
and [Domains](https://coolify.io/docs/core/networking/domains).

Create an `A` record for the API hostname pointing to the VPS public IPv4. Add
`AAAA` only if IPv6 reaches the same proxy correctly. Verify DNS propagation and
80/443 reachability before requesting TLS; remove stale records. Initially keep
additional CDN/proxy layers out of the path unless they have been tested.

### Health check settings

Keep the Dockerfile's Node-based `HEALTHCHECK`. It requests
`http://127.0.0.1:${PORT}/health`, requires HTTP 200, and has a 4-second request
deadline, 30-second interval, 5-second Docker timeout, 30-second start period and
3 retries. No database connection, credentials or diagnostic details appear in
the response: `{"status":"ok"}`.

Current Coolify uses an image's HEALTHCHECK in preference to its dashboard check.
On **Healthcheck**, leave health monitoring enabled and verify the generated
container uses this image check. If your installed UI asks for HTTP settings,
the equivalent target is GET, http, 127.0.0.1, port 3000, path `/health`, expected
200. The image check remains authoritative. See [Health checks](https://coolify.io/docs/applications/configuration/health-checks).

Process health means HTTP has started after storage initialization. It does
**not** check database access, migration status, SMTP or complete application
readiness. Deployment success also requires the endpoint and workflow checks in
section 9. A database outage may leave `/health` green and worker errors in logs.

## 4. Configure backend environment variables

Use [.env.coolify.example](.env.coolify.example) as the complete safe reference.
It intentionally contains invalid production placeholders and must be edited.
Set values in the application's **Environment Variables**; no production `.env`
file belongs in Git or the Docker context. Set **Build time** to **Not available
during build**, **Runtime** to **Available in the container** (older UI:
Build Variable off, Runtime Variable on). Lock secrets in Normal view. Use
**Interpolation > Literal** for values containing `$`. Developer view saves can
remove absent entries, so review the full set before saving.
See [Environment Variables](https://coolify.io/docs/applications/configuration/environment-variables).

| Classification | Exact names / requirements |
| --- | --- |
| Always required secrets | `DATABASE_URL`; distinct `JWT_ACCESS_SECRET`, `JWT_REFRESH_SECRET`, each >=32 characters and not `replace_` examples |
| Production required | `AUTH_COOKIE_SECURE=true`, `FRONTEND_URL` (non-loopback, use HTTPS), `SMTP_HOST`, `MAIL_FROM`, `ORDER_NOTIFICATION_EMAIL` (valid email) |
| Deployment selections | `NODE_ENV=production`, `PORT=3000`, `TRUST_PROXY_HOPS`, `CORS_ORIGINS`, `AUTH_COOKIE_SAME_SITE` |
| Gmail required pair | `SMTP_USER`, `SMTP_PASSWORD` (App Password, secret); `SMTP_PORT=465`, `SMTP_SECURE=true` |
| Local storage required | `UPLOAD_STORAGE_DRIVER=local`, `UPLOAD_LOCAL_PATH=/app/storage/uploads`, `UPLOAD_BASE_URL=https://api.example.com/uploads` |
| Optional SMTP | `MAIL_FROM_NAME`; `SUPPORT_NOTIFICATION_EMAIL` defaults to the order inbox. An unauthenticated trusted relay can omit both SMTP credentials; Gmail cannot. |
| Cloudinary alternative | `UPLOAD_STORAGE_DRIVER=cloudinary`, `CLOUDINARY_CLOUD_NAME`, `CLOUDINARY_API_KEY`, `CLOUDINARY_API_SECRET` (secret); configure all three for working uploads |
| Optional social login | `GOOGLE_CLIENT_ID`; `FACEBOOK_APP_ID`, `FACEBOOK_APP_SECRET` (secret) |
| Legacy path fallback | `RAILWAY_VOLUME_MOUNT_PATH`; omit on Coolify, where explicit `UPLOAD_LOCAL_PATH` takes precedence |
| One-time fresh-DB bootstrap only | `BOOTSTRAP_ADMIN_EMAIL`, `BOOTSTRAP_ADMIN_PASSWORD` (secret), `BOOTSTRAP_ADMIN_FIRST_NAME`, `BOOTSTRAP_ADMIN_LAST_NAME`; read by the seed command, outside the main env schema |

Defaults in `src/config/env.ts` (other optional settings need no value):

| Names | Defaults |
| --- | --- |
| `NODE_ENV`, `PORT`, `TRUST_PROXY_HOPS` | `development`, `3000`, `0`; override for deployment as above |
| `JWT_ACCESS_EXPIRES_IN`, `JWT_REFRESH_EXPIRES_IN` | `15m`, `30d` |
| `JWT_ISSUER`, `JWT_AUDIENCE` | `shoe-store-api`, `shoe-store-client` |
| `BCRYPT_ROUNDS` | `12` (allowed 10–14) |
| `AUTH_REQUIRE_EMAIL_VERIFICATION` | `true` |
| `AUTH_VERIFICATION_TOKEN_EXPIRES_IN`, `AUTH_RESET_TOKEN_EXPIRES_IN` | `24h`, `30m` |
| `AUTH_REFRESH_COOKIE_NAME` | `shoe_refresh` |
| `AUTH_COOKIE_SECURE`, `AUTH_COOKIE_SAME_SITE` | `false`, `lax`; production requires secure=true |
| `CORS_ORIGINS`, `FRONTEND_URL` | `http://localhost:3000`; explicitly replace both |
| `SMTP_PORT`, `SMTP_SECURE` | `587`, `false`; override for Gmail 465/true |
| `UPLOAD_STORAGE_DRIVER`, `LOW_STOCK_THRESHOLD` | `local`, `5` |

Other optional variables in the reference have no schema default. Local storage
resolves its path from explicit path, then legacy Railway mount, then
`storage/uploads`; production local storage additionally requires a public base
URL. Cloudinary credentials are checked by the integration, rather than being
enforced as a group by the env schema.

### Cookies, CORS and trusted proxies

For `https://shop.example.com` and `https://api.example.com`, start with
`AUTH_COOKIE_SAME_SITE=lax`, `AUTH_COOKIE_SECURE=true`. These hosts share a site
but are different origins: list the exact frontend origins, with scheme and no
trailing slash, in `CORS_ORIGINS`. Set `FRONTEND_URL` to the real storefront for
reset/verification links. Credentialed browser requests must include credentials.

For a `*.vercel.app` storefront and `api.example.com`, the refresh cookie is
cross-site: use `AUTH_COOKIE_SAME_SITE=none` and secure=true. Browser third-party
cookie blocking can still prevent persistence; test login/refresh/logout on the
target browsers. A storefront custom domain under the API's parent site avoids
that cross-site dependency. Do not apply `none` universally. See the browser
[cookie rules](https://developer.mozilla.org/en-US/docs/Web/HTTP/Guides/Cookies)
and [third-party cookie restrictions](https://developer.mozilla.org/en-US/docs/Web/Privacy/Guides/Third-party_cookies).

Set `TRUST_PROXY_HOPS=1` only when every request reaches Node through exactly one
trusted Coolify proxy and direct access is blocked. Reassess when adding a CDN or
another proxy; do not blindly increase it. Keep JWT secrets, issuer, audience and
cookie name compatible at cutover to preserve existing sessions where possible.

Gmail must have an App Password enabled for the account. Match `MAIL_FROM` to an
authorized sender, and verify outbound delivery from the VPS. Production startup
validates mail essentials, not authentication or actual delivery.

## 5. Prepare PostgreSQL and protect existing data

Prefer a separate Coolify PostgreSQL resource on the **same private Docker
network** as the API and release jobs. Copy its **internal/private connection
URL** into `DATABASE_URL`; never use `localhost` for another container. Keep
public database access disabled. Retain a persistent database volume and confirm
the container mount actually used by the selected PostgreSQL version. Coolify
manages standalone DB volumes; they are separate from the upload volume and are
not backups. See [Databases](https://coolify.io/docs/databases/).

Match the existing PostgreSQL major version during migration; the development
compose file uses PostgreSQL 16 but does not prove Railway's version. Do not
reuse that compose file's published 5432 or example credentials in production.
Choose database credentials with migration rights in the application schema and
permission to install `pg_trgm`, required by
`20260923110000_catalog_localization`. Rehearse with that role, not just a DB
superuser. Preserve appropriate TLS validation when the database requires TLS.

**Keeping Railway PostgreSQL:** its internal hostname is normally unreachable
from Hostinger. A retained remote DB requires a reachable secured external
endpoint, verified TLS and restricted access where the provider supports it.
Confirm connectivity deliberately; do not expose a new Coolify database publicly
just to make private routing work. The image supports PostgreSQL through `pg`.

**Moving existing Railway data:** back up and restore the full database including
`_prisma_migrations`, users, sessions, orders, outbox records, settings and RBAC.
Do not migrate an empty target and then restore an old schema over it. Restore
the source snapshot into an empty target first, then inspect status and apply
only the reviewed pending migrations.

### Verified backup and rehearsal (mandatory for live data)

1. Confirm source host, database, PostgreSQL version, schema and migration
   history with the operator. Securely configure libpq's `PGHOST`, `PGPORT`,
   `PGDATABASE`, `PGUSER`, TLS options and a mode-600 `PGPASSFILE`. Do not put
   passwords in shell history or print connection strings. Use PostgreSQL
   client tools compatible with the server major version.
2. In a protected directory, take a custom-format full backup:

   ```sh
   umask 077
   pg_dump --format=custom --file=shoozy-before-cutover.dump
   pg_restore --list shoozy-before-cutover.dump > shoozy-before-cutover.contents
   ```

3. Independently create an empty **validation** database. Point the libpq
   settings at that database, verify the identity, then restore:

   ```sh
   pg_restore --exit-on-error --no-owner --no-privileges shoozy-before-cutover.dump
   ```

   No clean/drop flags are used. Check grants/ownership for the target application
   role, row counts, financial totals, stock, order snapshots, RBAC and migration
   history. Listing the archive alone is not a verified backup.
4. Use an isolated rehearsal env file pointing only at the validation database.
   Run the release-job status/deploy/status steps below and exercise workflows
   with test SMTP. Record results. An error or unexpected schema drift is a stop
   condition; `migrate status` alone does not prove absence of schema drift.
5. For final transfer, schedule maintenance and stop Railway API writes **and its
   in-process worker** before the final database/upload snapshot. Keep it
   recoverable. Avoid two APIs sending from copies of the same outbox. Restore
   the final snapshot into a new empty production target and recheck counts.
   Account for DNS/browser clients that may still target Railway during cutover.

### Known migration stop conditions

- `20260813193000_commerce_completion_invariants` adds `discounts.priority` as
  **NOT NULL with no default**, plus a unique index. If pending and `discounts`
  contains rows, it cannot be deployed unchanged. A read-only `SELECT COUNT(*)
  FROM discounts;` can establish that condition on the verified database. Stop
  and design a reviewed staged addition/backfill/constraint procedure with
  approved priorities. Do not edit previously applied migration files, delete
  discounts or automatically mark the migration as applied.
- That migration also enforces one primary media item per product, one active
  cart per user, valid collection date windows, exclusive discount targets and
  unique redemption/target records. Legacy violations block it. Reconcile them
  through a reviewed data-preserving plan on a restored clone first.
- Missing `pg_trgm` privileges, failed/modified migration history, existing schema
  without matching history, or divergent Railway changes require investigation.
  Do not guess a baseline, mark failed migrations resolved, or run destructive SQL
  from this runbook. Prisma deploy does not automatically repair these cases.
- A fresh empty database does not have the populated-discounts incompatibility.
  The full chain still needs a real PostgreSQL rehearsal; no live DB was examined
  during this preparation task.

## 6. Controlled migration job, including the very first deployment

Do **not** depend on a Coolify pre-deployment hook for the first deployment.
Coolify describes it as running inside the current application container; there
may be no container yet, and later the old image may lack new migration files.
Post-deployment is too late because the API and worker have already started.
See [Dockerfile deployment commands](https://coolify.io/docs/applications/builds/dockerfile).

Use a **one-off container from the exact new release image**, before routing API
traffic. Migrations are never run by the Docker CMD or on routine restarts.
The following are **manual VPS shell instructions**, not commands executed by
this preparation. Run with Docker access. Use a fixed reviewed commit/tag, not a
moving `latest` image. If an image is built in CI, use its immutable digest.

1. On the VPS obtain a clean checkout of the reviewed GitHub revision. Inspect
   the commit hash, then build that revision (no production env in the checkout):

   ```sh
   git clone --branch main YOUR_GITHUB_REPOSITORY_URL shoozy-backend-release
   cd shoozy-backend-release
   git checkout --detach YOUR_REVIEWED_COMMIT_SHA
   git rev-parse HEAD
   docker build --progress=plain -t shoozy-backend:release-REVIEWED_SHA .
   ```

2. Record the database resource's actual Docker network. Use `docker network ls`
   and inspect the database container/network membership on the VPS; confirm the
   API destination will join it too. Do not assume a network name or use a public
   database port as a workaround.
3. Create `/root/shoozy-migration.env` securely outside the checkout (owner root,
   mode 600), containing only the verified `DATABASE_URL=...`. Edit it privately;
   do not paste secrets into shell commands, tickets or deployment logs. For a
   rehearsal create a separate file containing the disposable DB URL.
4. Set the non-secret image/network names, inspect status, and review its output:

   ```sh
   RELEASE_IMAGE=shoozy-backend:release-REVIEWED_SHA
   DB_NETWORK=YOUR_ACTUAL_PRIVATE_DOCKER_NETWORK
   docker run --rm --network "$DB_NETWORK" --env-file /root/shoozy-migration.env \
     "$RELEASE_IMAGE" npx --no-install prisma migrate status
   ```

   Pending migrations can make status exit nonzero, including an empty database.
   Distinguish expected pending files from connectivity, failed-history or
   baseline errors. On live data require the verified backup and successful
   rehearsal first. Stop on an incompatibility described above.
5. One operator runs the approved release migration **once**, from the same image:

   ```sh
   docker run --rm --network "$DB_NETWORK" --env-file /root/shoozy-migration.env \
     "$RELEASE_IMAGE" npm run prisma:deploy
   docker run --rm --network "$DB_NETWORK" --env-file /root/shoozy-migration.env \
     "$RELEASE_IMAGE" npx --no-install prisma migrate status
   ```

   Require deploy exit 0 and final status exit 0 with all migrations applied.
   On failure stop deployment, preserve logs securely, and inspect the database;
   do not retry blindly after partial DDL. The deploy command does not seed demo
   data. No application process or notification worker runs in these jobs.

### Fresh empty database only: initialize real administrative access

Migrations create tables, not the RBAC catalog, administrator, shipping rates or
product catalog. After successful migrations on a **fresh database**, prepare
`/root/shoozy-seed.env` (mode 600) with the full valid production configuration
from section 4 plus all four `BOOTSTRAP_ADMIN_*` values. Choose the real admin
email and a strong unique password (the existing password validator applies).
Run the existing non-demo initializer as an explicit one-time job:

```sh
docker run --rm --network "$DB_NETWORK" --env-file /root/shoozy-seed.env \
  "$RELEASE_IMAGE" npm run seed
```

This upserts system roles/permissions and default store settings, backfills legacy
user-role links, and creates/verifies the configured admin. It is not `seed:demo`.
Remove the bootstrap password/env file from the VPS when initialization is
verified, and do not add bootstrap credentials to ongoing API runtime variables.
Log in and configure real Tunisia shipping methods/zones/rates and merchandise
through authorized administration before accepting checkout traffic.

**Existing live database:** preserve its users, settings, roles and permissions.
Do not automatically run `npm run seed`: its RBAC initializer replaces system role
permission links and backfills legacy roles. If new permissions are needed,
review and schedule that catalog maintenance separately on a restored clone.
Never run the demo seed or cleanup scripts against customer data.

## 7. Upload persistence and transfer

For local storage set the three upload variables from the reference. In
**Persistent Storage > Add > Volume Mount**, use a descriptive name such as
`shoozy-uploads`, leave Source Path empty for a Docker-managed volume, and set
**Destination Path** to `/app/storage/uploads`. Record the actual generated volume
name: Coolify may add a resource identifier. Never replace this volume during a
routine deployment. See [Persistent Storage](https://coolify.io/docs/applications/configuration/persistent-storage).

The image creates that directory owned by `1000:1000`. Empty named Docker volumes
normally inherit the image directory's contents/ownership on first mount; verify
this, as existing volumes/bind mounts can mask image permissions. For a bind
mount, prepare the exact host upload directory as writable by UID/GID 1000 before
deployment. For an existing named volume, after confirming its exact identity,
an operator can repair ownership with a temporary root helper using this image:

```sh
docker run --rm --user 0 --entrypoint sh \
  --mount type=volume,src=YOUR_CONFIRMED_UPLOAD_VOLUME,dst=/app/storage/uploads \
  "$RELEASE_IMAGE" -c 'chown -R 1000:1000 /app/storage/uploads'
```

Use that helper only for the dedicated upload volume, not the PostgreSQL volume
or an arbitrary host path. Do not make the API root or use world-writable modes.
Storage initialization makes products, products/videos, homepage, collections,
brands, categories and promotions directories and probes write access before
listening. Test actual image/video writes as the runtime user after mounting.
`GET /uploads/<key>` is served publicly with cross-origin media support.

Railway files do not appear on Hostinger automatically. Transfer the **actual
resolved Railway upload root**, preserving relative directories/filenames, into
the new volume during the final maintenance window. Copy without deleting the
source, verify counts/hashes, repair ownership and test representative URLs.
Database backups do not contain these files. Keep an independent upload backup.

Changing `UPLOAD_BASE_URL` affects new uploads; existing absolute URLs in product
media, video fields, homepage media, brands, categories, collections, promotions,
and historical order image snapshots are not automatically rewritten. Inventory
all stored hosts and media fields. Either preserve the old hostname as a tested
route to the new files, or perform a separately reviewed, backed-up URL-data
migration that preserves storage keys and historical snapshots. Until that is
done, old media URLs remain a cutover blocker. Do not assume keeping Railway
online alone makes its local files durable.

If using Cloudinary exclusively, preserve its current credentials and keys, set
the driver to cloudinary, and omit the local upload volume. Confirm legacy LOCAL
records first: a mixed catalog still needs its old local files/URLs served until
they have been deliberately migrated. No Cloudinary credential enters the image.

Use one backend replica with local storage. Do not enable horizontal scaling
without shared media, a Socket.IO cross-process adapter/stickiness design,
worker coordination and a review of scheduled cleanup. No Redis is currently
required. Short container overlap during rolling replacement is also relevant
to workers; prefer a planned stop/start cutover while transferring data.

## 8. First deployment order

1. Prepare/validate VPS, Coolify, firewall, DNS, disk and backups.
2. Prepare a private persistent database. For existing data, verify backup,
   rehearsal, final write freeze and complete restore before proceeding.
3. Configure and review **runtime-only** backend variables and the reviewed commit.
4. Configure upload storage, verify ownership, transfer old media and settle old
   URLs. Omit the volume only for an exclusively Cloudinary catalog.
5. Build/review the release image, inspect migration status, run the controlled
   migration job, require clean final status. Initialize admin/RBAC on fresh DBs.
6. Select **Deploy** in Coolify. Ensure it builds the same reviewed revision and
   Dockerfile used for the migration job. Do not enable automatic migration hooks.
7. Inspect build and runtime logs. Expect storage driver/root/public URL logs,
   then `API listening on port 3000`; investigate startup or worker failures.
8. Verify Docker health, internal HTTP and the public HTTPS certificate/domain.
9. Perform the database and commerce smoke tests below with controlled test data.
10. Verify email, Socket.IO and storage after a redeployment. Only then release
    customer traffic and retire the old service according to the rollback plan.

For subsequent releases repeat backup/rehearsal/status/deploy/status with the
**new** release image before serving it. Routine container restarts do not apply
migrations or seeds. Schedule maintenance for schema changes that old code cannot
use safely; do not let an old API keep writing through incompatible migrations.

## 9. Frontend, background workers and smoke tests

Set this public build-time variable in the appropriate Vercel environment, then
rebuild/redeploy the frontend yourself:

```env
NEXT_PUBLIC_API_URL=https://api.example.com/api/v1
```

The public API value is frozen into browser bundles at build time; saving a new
variable alone does not update deployed frontend code. Confirm the frontend's
existing Socket.IO configuration also points to the API host, with its default
`/socket.io/` path. No frontend files were changed in this preparation. See the
[Next.js environment guide](https://nextjs.org/docs/pages/guides/environment-variables).

The existing startup creates one Socket.IO server, one in-process outbox worker
(immediate attempt, then every 2 seconds), and one unreferenced daily guest-cart
cleanup timer. HTTP initialization does not await the DB/SMTP worker. Worker
failures are caught; mail is processed after the order transaction, with retry
backoff and eight-attempt exhaustion. Sent timestamps suppress recorded duplicate
sends. At shutdown the timer stops, future worker intervals stop, sockets
disconnect and Prisma disconnects within a 10-second ceiling. An in-flight SMTP
send is not guaranteed to drain: allow retries after restart, inspect stale
5-minute claims, and acknowledge possible duplicate delivery if SMTP accepted a
message before its DB timestamp was stored. Recovery instructions remain in
[production operations](docs/PRODUCTION_OPERATIONS.md).

The proxy must forward both polling HTTP and WebSocket Upgrade requests on
`/socket.io/` to the same port 3000. Preserve Origin and forwarded headers, allow
long-lived connections (idle timeout longer than the Socket.IO heartbeat window),
and avoid caching socket traffic. Use the shared `CORS_ORIGINS` allowlist and
authenticated `handshake.auth.token`, or the existing guest support credentials.
Inspect a WebSocket **101 Switching Protocols** and stable reconnects in browser
developer tools. No second socket port, worker service or broker is required.

Run these public read-only checks, using the real API domain:

```sh
curl --fail --silent --show-error https://api.example.com/health
curl --fail --silent --show-error 'https://api.example.com/api/v1/catalog/products?limit=1'
```

Require `/health` HTTP 200 with exactly `{"status":"ok"}`. The catalog request
must also succeed; it exercises the real DB through an application read. Verify
using a known restored product when available, not just an empty list.

- [ ] Correct public DNS, TLS and proxy routing; internal and public health pass.
- [ ] Final migration status clean; DB role, extension, counts, order totals and
      restored settings agree with the approved source snapshot.
- [ ] Register/verify, log in, refresh, log out; cookie behavior works in browsers.
- [ ] Forgot/reset password mail arrives with a link to the correct frontend;
      tokens and sessions behave correctly after the reset.
- [ ] Controlled guest and authenticated checkout, idempotent retry, order
      management and item image snapshots work. Tunisia-only shipping, TND,
      Cash on Delivery, variants and stock rules remain intact.
- [ ] Real admin can open dashboard/settings; customer credentials cannot access
      protected admin routes. Fresh DB has real shipping configuration.
- [ ] Old and newly uploaded product images and MP4 videos load; homepage, brand,
      category, collection and promotion assets work across the frontend origin.
- [ ] Customer confirmation and admin order Gmail arrive; outbox retries remain
      observable, with no unexplained exhausted events or duplicate service.
- [ ] Support chat notifications/email arrive; authenticated and guest support
      sockets connect, upgrade, receive events and reconnect through the proxy.
- [ ] Upload a controlled test asset, redeploy the same release, and confirm its
      bytes and URL persist. Confirm PostgreSQL data persists independently.
- [ ] Stop/restart or replace the container and verify SIGTERM shutdown logs;
      worker reconnects and `/health` returns without restarting migrations.

Use designated test accounts/orders and an agreed cleanup process. Do not send
demo orders or broad notification retries to live customers.

## 10. Docker validation still required on a Docker-enabled host

This preparation host has no Docker executable: **Docker build/runtime, Alpine
Prisma engines, mounted Linux ownership, Linux PID-1 signal delivery and image
contents are NOT VERIFIED**. Local Node checks do not replace this gate.

Preparation checks on 2026-10-28 passed: clean `npm ci` from the unchanged
lockfile, Prisma 7.9.1 generation with a dummy unreachable URL, TypeScript build,
focused ESLint, and **161 tests across 20 files**. Coverage includes lifecycle,
environment validation, health, guest/authenticated order routes, order images,
store settings, password recovery, bootstrap, notification retry/email, sockets
and local media. An additional compiled-server smoke check confirmed a custom
port, HTTP 200 with the exact health body, public local media, Socket.IO polling,
and clear missing-config, invalid-storage and port-conflict failures. These ran
with test configuration and no local `.env` loading; no database-backed end-to-end
tests, live SMTP delivery or production connectivity checks were run. All 39
schema variables plus the four bootstrap inputs are represented in the example.

Before production, on a Docker host build the reviewed work:

```sh
docker build --progress=plain -t shoozy-backend:coolify .
```

Use a disposable private PostgreSQL database and a protected **test-only** env
file with distinct test JWT keys, local media path and no live SMTP credentials.
For `NODE_ENV=test`, mail credentials are not required. Apply migrations to that
disposable database via section 6; never load Railway production values into
automated tests. Example runtime command (test volume/network created first):

```sh
docker volume create shoozy-upload-validation
docker run -d --name shoozy-validation --network YOUR_TEST_DB_NETWORK \
  --env-file /secure/path/shoozy-test.env \
  --mount type=volume,src=shoozy-upload-validation,dst=/app/storage/uploads \
  -p 127.0.0.1:3000:3000 shoozy-backend:coolify
curl --fail http://127.0.0.1:3000/health
docker inspect --format '{{.State.Health.Status}}' shoozy-validation
docker exec shoozy-validation node -e 'const fs=require("node:fs"); if(process.getuid()===0)process.exit(1); const p="/app/storage/uploads/.validation";fs.writeFileSync(p,"ok");fs.unlinkSync(p)'
docker stop --time 15 shoozy-validation
docker logs shoozy-validation
```

Require a successful build, healthy state, UID 1000 writes, graceful SIGTERM log
and successful exit. Repeat with a changed test `PORT` and matching host mapping
to confirm the health check follows the port. A separate run with no env must
fail clearly with missing `DATABASE_URL`/JWT validation paths:

```sh
docker run --rm shoozy-backend:coolify
```

Review image history and its filesystem privately: no actual `.env`, database
dump, uploaded media or credentials should exist; example files contain only
placeholders, and the build-only URL is synthetic. Confirm schema/migrations,
generated client, CLI and `dist/src/server.js` exist. Do not dump a production
container's environment or image metadata containing secrets into shared logs.
Destroy only the identified disposable test resources when validation ends.

## 11. Rollback and handover

Retain the Railway service, source database backup, old upload snapshot, previous
image/commit and old frontend variable values until cutover is verified. Keep the
old service recoverable but prevent split writes and duplicate notification
workers. A running old API pointed at an outdated copy of orders is not a safe
fallback after the new site accepts orders.

Use Coolify's previous application revision/image only if it is compatible with
the **current migrated schema**. Reverting application code does not reverse
database migrations. Stop writes before an incompatible rollback; prefer a
reviewed forward fix or compensating migration. A verified backup restore is an
operator recovery action into a separate database after assessing post-backup
orders/customer changes and agreeing how to reconcile them. Never overwrite the
only live copy or reset it as a deployment repair. Restore uploads and DNS/
frontend routes consistently, recheck workflow access, and resume one writer.

Record the release SHA/image digest, migration outputs, backup/restore evidence,
network and volume identifiers, smoke results and rollback owner without secret
values. Actual production deployment is a separate operator action.
