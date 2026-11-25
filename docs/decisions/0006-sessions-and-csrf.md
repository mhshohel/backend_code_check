# ADR 0006: Server-side sessions with a custom CSRF header

## Status
Accepted.

## Decision
- Opaque random session token in an `HttpOnly`, `SameSite=Lax` cookie; only its
  SHA-256 hash is stored. Logout and expiry are enforced on the server.
- Every state-changing request must carry `x-ofl-csrf: 1`.

## Reasons
- Server-side sessions can be revoked immediately; a stateless JWT cannot
  without an extra deny list.
- A cross-site form cannot set custom headers. A cross-site `fetch` with a custom
  header triggers a CORS preflight, which the CORS allowlist rejects.
  Together with `SameSite=Lax`, this blocks cross-site request forgery without
  a token store.

## Consequences
Each request performs one indexed session lookup. A cache is unnecessary at
this scale.
