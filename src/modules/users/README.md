# Users

Implemented customer account endpoints:

- `GET /api/v1/users/me` requires `profile.read.own`.
- `PATCH /api/v1/users/me` requires `profile.update.own` and accepts only
  `firstName`, `lastName`, and `phone`.
- `POST /api/v1/auth/change-password` requires `profile.update.own`, verifies
  the current local-account password, revokes other sessions, and preserves the
  current session.

Profile responses use an explicit safe DTO. Email changes, account deletion,
admin customer management, MFA, and social-account linking are not implemented.

Layering: routes -> validation -> controller -> service -> repository -> Prisma.
