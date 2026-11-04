# Customer support chat

All responses use `{ "success": true, "data": ... }`. Messages are plain text,
at most 2,000 characters. No uploads, typing indicators, or automated replies.

## Customer API

- `POST /api/v1/support/conversations`: `{ "name": "Ahmed Ali", "phone": "+21620123456", "email": "optional@example.com", "orderNumber": "optional", "message": "Help with my order" }`. Guests require name and phone; authenticated customers use their profile name/email and may supply a contact phone if their profile has none. Returns the initial message. Guest creation returns `supportAccessToken` **once**.
- `GET /api/v1/support/conversations`: authenticated customer's own conversations, `page`/`limit` (20 default, 100 maximum).
- `GET /api/v1/support/conversations/:conversationId`: own conversation detail.
- `GET /api/v1/support/conversations/:conversationId/messages`: oldest first, `page`/`limit`.
- `POST /api/v1/support/conversations/:conversationId/messages`: `{ "message": "..." }`.
- `POST /api/v1/support/conversations/:conversationId/read`: reset customer unread count.

Guest follow-up HTTP requests send `X-Support-Token` over HTTPS. The raw token
must remain in client-side secure storage and never be placed in a URL. A guest
socket connects to the existing Socket.IO server with handshake `auth` values
`{ supportToken, conversationId }`; the server verifies the hash before joining
only that conversation room. Account sockets use the existing access token in
`auth.token`, then send `support:join` with a conversation UUID. The server checks
ownership or the support permission before acknowledging `{ ok: true }`.

Optional order linking requires the account user's own `orderNumber`, or for a
guest, a guest order number plus the same phone as the immutable order customer
snapshot. Failed verification uses one generic error.

## Admin API

All routes require authenticated `support.read.any`; replies and status changes
also require `support.manage.any`. The ADMIN system role receives both when
the RBAC seed is run.

- `GET /api/v1/admin/support/conversations`: `page`, `limit`, optional `status`, `unreadOnly=true`, and `search` (reference, name, phone, order number). Newest activity first. Summary only; includes a last-message preview.
- `GET /api/v1/admin/support/conversations/:conversationId`
- `GET /api/v1/admin/support/conversations/:conversationId/messages`: paginated, oldest first.
- `POST /api/v1/admin/support/conversations/:conversationId/messages`: `{ "message": "..." }`.
- `POST /api/v1/admin/support/conversations/:conversationId/read`
- `PATCH /api/v1/admin/support/conversations/:conversationId/status`: `{ "status": "OPEN" | "PENDING" | "CLOSED" }`.

Customer messages set `OPEN`; admin replies set `PENDING`; admin can close or
reopen. Customer sending to a closed conversation returns
`SUPPORT_CONVERSATION_CLOSED`. Assignment and priority are not part of this phase.

## Realtime and email

The existing Socket.IO server owns `support:admins` and
`support:conversation:<id>` rooms. Events are `support:conversation:new`,
`support:message:new`, `support:conversation:updated`, `support:conversation:read`,
and `support:conversation:status`. Message payloads include the safe
`senderDisplayName` (`Shoozy Support` for admin replies). They are emitted after database commit.
HTTP history is the source of truth after reconnect.

The existing NotificationOutbox worker records `SUPPORT_REQUEST` in the same
transaction as the customer message. It sends one admin email when unread
count changes from zero to positive. Admin read resets unread and advances
the notification generation; later activity creates a new deduplicated event.
The worker sends to `SUPPORT_NOTIFICATION_EMAIL`, falling back to
`ORDER_NOTIFICATION_EMAIL`, through the existing `SMTP_*` and `MAIL_FROM*`
settings. SMTP failures are retried by the worker and do not fail support API
requests. Email is at-least-once if SMTP succeeds but recording delivery fails.
The existing order email path is unchanged.

Guest creation is limited to 10 requests and message sending to 90 requests
per IP per 15 minutes through the existing commerce rate limiter. The same
limits apply to account calls on these routes. `npm start` starts the API and
notification worker in one process; no separate Railway worker is needed.

Deploy a reviewed migration with `npm run prisma:deploy` (runs
`prisma migrate deploy`) before starting the new application version. Then run
the RBAC seed used by deployment so the ADMIN role receives support permissions.
