# Auth

Complete email, session, recovery, Google, and Facebook authentication lives here.
The layering is routes -> validation -> controller -> service -> repository -> Prisma.
Runtime RBAC and ownership helpers live under `src/common/auth`; see `docs/AUTH.md`
and `docs/RBAC.md` for contracts and security decisions.
