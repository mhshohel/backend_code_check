# Review pass 2: Express, Next.js, web-spa, finished server-core, migration 0003 and bench scripts

Reviewer: review agent. Date: 2026-11-25. Same rules as pass 1: report only, no project source edited.

## How I verified
- I ran every suite, typecheck, lint and build in scope (table at the end).
- I started production builds against my own database `ofl_review`:
  - Express `dist/server.js` on 127.0.0.1:4390;
  - Next.js `next start` on 127.0.0.1:4392 and `dist/realtime.mjs` on :4393.
  - Both ran with `NODE_ENV=production`, so production rate limits and cookie flags applied.
- I probed them with scripts in `reports/review-scratch/p2/`: `probe.mjs`, `pages.mjs`, `ratelimit.mjs`, `ws-logout.mjs`.
- All servers were stopped afterwards; `pgrep` shows no leftovers.

## Status of pass-1 findings
Server-core and domain are unchanged for F1–F4. No file in `packages/server-core/src` or `packages/domain/src` is newer than `review-pass-1.md`. Because all three variants share server-core, these findings now affect all of them:
- **F1 (alias fan-out):** re-confirmed on Express and Next. 300 aliased `searchProducts` returned 200 with data on both, so 300 Elasticsearch queries ran from one request.
- **F3 (WebSocket identity survives logout):** re-confirmed on Express and on the Next realtime service (P2-4 below).
- **F2, F4, F6, F7, F11 and F12** are unchanged. The F12 coverage gaps apply to the Express and Next transport tests too.

---

## Findings, most severe first

### P2-1. HIGH: Next.js rate limits use the client-supplied `X-Forwarded-For`, so the login brute-force limit can be bypassed.
- **Where:**
  - `implementations/nextjs/modules/server/http/request-meta.ts:10-15` (`clientIpFrom` takes the first, leftmost `x-forwarded-for` entry);
  - it is used by `http/guards.ts:55-61` (`assertRateLimit`), `graphql-handler.ts:70` and `modules/auth/actions.ts:21-24` (login Server Action).
- **What is wrong:**
  - The leftmost XFF entry is whatever the client sent. `next start` does not overwrite a header that is already present.
  - Every request can therefore pick a new rate-limit key. This applies to login 10/min, GraphQL 300/min and webhook 120/min.
  - The README asks a reverse proxy to overwrite the header, but `pnpm start` exposes `next start` directly, and the spec requires the limits "per IP".
  - The same spoofed value also flows into `RequestMeta.ip`, which appears in logs.
- **Failure scenario:** unlimited password guessing against `POST /api/auth/login` (and the login Server Action) by rotating `X-Forwarded-For`.
- **Verified:** `ratelimit.mjs` sent 15 bad logins per mode.

  | Variant | Rotating `X-Forwarded-For` | No `X-Forwarded-For` |
  | --- | --- | --- |
  | Next.js | `{"401":15}`, never limited | `{"401":3,"429":12}` |
  | Express | `{"401":10,"429":5}`, XFF ignored | `{"429":15}` |

  Express has `trust proxy` off, so XFF has no effect there.
- **Fix:**
  - Derive the key from a value the client cannot set. Take the rightmost entry appended by a trusted hop, controlled by a `TRUSTED_PROXY_HOPS` setting (default 0, which means use the socket address).
  - Or run Next behind a custom server or proxy that overwrites the header.
  - Add a test that rotates `X-Forwarded-For` and still expects 429.

### P2-2. HIGH (pass-1 F1, now confirmed in all three variants): aliased root fields bypass the cost limit.
- **Verified with `probe.mjs`, `cost: 300 aliased searchProducts`:**
  - `[express] 200 {"data":{"a0":{"totalCount":2},...`
  - `[nextjs] 200 {"data":{"a0":{"totalCount":2},...`
- **Fix:** see pass-1 F1 (`packages/server-core/src/graphql/limits.ts`).

### P2-3. MEDIUM: Express `/graphql` body limit (100 KB) is bypassed by JSON content types that `express.json()` does not parse.
- **Where:** `implementations/express/api/routes/graphql.ts:39`.
- **What is wrong:**
  - `express.json({ limit })` only parses `application/json`.
  - For `application/graphql+json`, which Yoga accepts, the body stays unread, and Yoga then reads the raw stream with its own much larger limit.
- **Failure scenario:** each request (300/min per IP) can push about 16 MB of JSON into the process. Memory and CPU exhaustion would need far fewer requests than the 100 KB rule intends.
- **Verified (`probe.mjs` and a follow-up loop):**
  - `[express] 110KB application/json: 413`;
  - `[express] 1MB application/graphql+json: 200 {"data":{"__typename":"Query"}}`;
  - 2, 4, 8 and 16 MB all returned 200; only 30 MB returned 413 (Yoga's own limit).
  - Fastify (pass 1) and Next (`[nextjs] 1MB application/graphql+json: 413`) are not affected.
- **Fix:** use `express.json({ limit, type: ['application/json', 'application/*+json'] })`, and answer other content types on POST `/graphql` with 415 before Yoga runs. Or put `express.raw({ type: () => true, limit })` in front of Yoga. Add a test.

### P2-4. MEDIUM (pass-1 F3, now confirmed on Express and Next): an open WebSocket keeps its identity after logout, including ADMIN rights.
- **Verified (`ws-logout.mjs`, admin account):**
  - `express after logout, same socket: {"data":{"viewer":{"email":"admin@example.com","role":"ADMIN"},"operationsSummary":{"failedJobs":0}}}`;
  - the same happened on the Next realtime service (:4393).
- **Notes:**
  - The Next README lists this as a limitation: the client closes idle sockets after `lazyCloseTimeout`. A non-browser client, or an attacker holding the socket, is not bound by that.
  - The Express upgrade path (`api/websocket.ts:47-53`) and the Next realtime service (`modules/realtime/server.ts:65-70`) also have no rate limit. Fastify at least rate-limits the upgrade GET.
- **Fix:** re-validate the session per operation in `graphqlWsServerOptions.onSubscribe` (server-core), and restrict WebSocket to subscriptions. This one fix covers all variants.

### P2-5. LOW-MEDIUM: the Next.js price Server Action parses money with floating point and accepts blank input as $0.00.
- **Where:** `implementations/nextjs/modules/admin/actions.ts:24-26` (`Number(text.trim())`, then `Math.round(price * 100)`).
- **What is wrong:**
  - `Number('')` and `Number('  ')` are `0`, so a direct POST with an empty field sets the SKU price to 0 cents.
  - `'0x10'` becomes 1600 and `'1e3'` becomes 100000; `'12.345'` silently rounds to 1235.
  - The input's `required`/`type=number` only protects the normal browser form.
  - The shared SPA uses a strict string parser (`packages/web-spa/src/features/admin/parseMoneyInput.ts`), so the two UIs behave differently, and the float path conflicts with "money as integer minor units".
- **Verified:** I evaluated the exact expression from `actions.ts:24-26` for those inputs and got `"  " -> 0`, `"0x10" -> 1600`, `"1e3" -> 100000`, `"12.345" -> 1235`. I did not invoke the Server Action itself, because that needs an action id.
- **Fix:** move `parseMoneyInput` into `@ofl/domain`, use it in both UIs, and reject empty input.

### P2-6. LOW: the Next realtime service and Next worker health server listen on all interfaces.
- **Where:**
  - `implementations/nextjs/modules/realtime/server.ts:74` (`options.host ?? '0.0.0.0'`; `main.ts` never passes a host);
  - `implementations/nextjs/worker/main.ts:41` (`server.listen(port)`).
- **Why it matters:** Express and Fastify bind to `HOST` (default 127.0.0.1). An unauthenticated `/metrics` and the WebSocket endpoint end up reachable from the network on a developer laptop.
- **Verified:** `lsof` shows `TCP *:4393 (LISTEN)` for realtime, and `127.0.0.1:4390` and `127.0.0.1:4392` for the other two. The worker binding was checked by inspection.
- **Fix:** read a `HOST` setting (default 127.0.0.1) in both entry points.

### P2-7. LOW: `scripts/bench/explain-my-orders.ts` changes indexes on any `DATABASE_URL` and does not restore them on failure.
- **Where:** `scripts/bench/explain-my-orders.ts:27,65-75,113`.
- **What is wrong:**
  - The script drops and recreates `orders_customer_created_idx` and `orders_customer_id_idx` on whatever database the environment points at. There is no `ofl_bench` check; `run-benchmarks.ts` hardcodes `ofl_bench`, this script does not.
  - The `finally` only closes the client. If `measure` throws after `useBeforeIndexes()`, the database is left in the pre-0002 index state while its migration table says 0002 is applied.
- **Verified:** by inspection.
- **Fix:** refuse any database other than `ofl_bench` (or require `--force`), and restore the "after" indexes in `finally`.

### P2-8. LOW: CORS and CSRF behaviour differs between variants (documented, but worth recording).
- **Next:** `/api/*` refuses every cross-origin preflight and every request with a foreign `Origin` header (`modules/server/http/guards.ts:47-53,105-107`):
  - `[nextjs] POST with evil Origin + CSRF header: 403`;
  - the preflight from the configured app origin also returned 403.
  - This is stricter than the spec and fine for a same-origin app. But `APP_ORIGIN` is documented as "extra public origins", and preflights from those origins are still refused, so a separately hosted client could not use them.
- **Express and Fastify:** a non-browser POST with a foreign Origin plus the CSRF header is answered (`[express] POST with evil Origin + CSRF header: 200`). Browsers cannot do this, because the preflight fails (`[express] preflight from evil origin: 405 acao=null`). This is not a vulnerability.
- **Suggestion:** document the Next behaviour, or answer allowlisted preflights.

### P2-9. LOW: carried-over observability exposure.
- `/metrics` is public on all three variants (`[express] metrics public: 200`; Next `/api/metrics` returned 200).
- This matches pass-1 F9 and is documented in the Next README. Bind it to an internal listener.

---

## Checks that passed

| Area | Check | Result |
| --- | --- | --- |
| server-core | `pnpm --filter @ofl/server-core test` (ofl_core_test) | 10 suites, 82/82 passed |
| server-core | typecheck and lint | clean |
| Express | `pnpm typecheck`, `pnpm lint`, `pnpm build` | clean; `dist/server.js` and `dist/worker.js` built, SPA bundle built |
| Express | `pnpm test` | 2 suites, 28/28 passed (14 acceptance + 14 API) |
| Next.js | `pnpm typecheck`, `pnpm lint`, `pnpm build` | clean; every route dynamic (`ƒ`); realtime and worker bundles built |
| Next.js | `pnpm test` (runs `next build` first) | 10 suites, 79/79 passed |
| web-spa | `pnpm --filter @ofl/web-spa test`, typecheck, lint | 7 suites, 32/32 passed; clean |
| Cookie flags (production) | login on Express and Next | both `HttpOnly; Secure; SameSite=Lax; Path=/; Max-Age=28800`. Next also sends `Cache-Control: private, no-store` |
| CSRF header | GraphQL POST, login and logout without `x-ofl-csrf` | 403 on both variants |
| Mutation via GET | `?query=mutation…` | Express 405 (Yoga); Next 405 (POST only) |
| CORS | Express preflight from evil origin | no `Access-Control-Allow-Origin`; allowed origin echoed |
| Body limit, JSON | 110 KB `application/json` | 413 on both |
| Webhook raw body | signed pretty-printed body with trailing newline; also sent as `text/plain` | signature accepted (400 "Payment was not found" for the random payment id) on both, so the exact bytes are verified |
| Webhook auth order | unsigned `{"foo":1}` | 401 on Express and Next (Fastify gives 400, pass-1 F8) |
| Webhook limit | 200 KB | 413 on both |
| WebSocket Origin | evil origin / allowed origin / no Origin | 403 / accepted / accepted on Express and Next realtime |
| Next page authorization | `pages.mjs` | see below |
| Next shared-cache safety | headers and data path | see below |
| Redux holds no server data | `web-spa/src/app/store.ts`; Next `modules/store/store.ts` | only cart, checkout attempt and UI/toasts; cart validated on rehydrate; key reset on any cart or payment-token change (both UIs) |
| Accessibility of forms | spot check of SPA `components/Field.tsx` and the Next forms | labelled inputs, `aria-invalid` + `aria-describedby` for errors, `role="alert"`/`aria-live` status regions; checkout feedback moves focus (Next) |
| Feature parity of the UIs | routes and pages | catalog/search with facets, product detail, cart/checkout, my orders, order detail with live view, cancel and return, warehouse dashboard (awaiting shipment, returns awaiting receipt, inventory, adjustments, movement history), admin dashboard (summary, failed jobs + retry, audit log, price change) all present in both the SPA (`app/routes.tsx` + feature pages) and Next (`app/**`) |
| Migration 0003 | `shipment_lines (order_line_id)` index | matches the loaders' and `requestReturn`'s lookups by `order_line_id`; applied by the suites without error |
| Log redaction | grep of the three server logs for the customer email and `ofl_session=` | 0 matches |
| Shutdown | SIGTERM to Express, Next and realtime | all three exited within 3 s |

Next page authorization, from `pages.mjs`:
- anonymous `/orders` and `/warehouse`: 307 to `/login?next=…`;
- customer2 opening customer1's `/orders/<id>`: 404;
- owner and operator opening the same page: 200;
- customer on `/warehouse` and `/warehouse/inventory`: 403;
- customer and operator on `/admin` and `/admin/jobs`: 403; admin: 200;
- unknown product: 404.

Next shared-cache safety:
- Every HTML page, anonymous or signed in, returned `Cache-Control: private, no-cache, no-store, max-age=0, must-revalidate`.
- The search data cache runs with `viewer = null`, is keyed by environment plus variables, and is bypassed in test (`modules/server/data/catalog.ts`).
- Per-user reads use `queryAsViewer` and are never wrapped in `unstable_cache`.
- `/api/graphql` sends `private, no-store` and `Vary: Cookie`.

## Things I could not verify
- **Next Server Action CSRF (Origin vs Host check):** I did not craft Server Action requests, because that needs a build-specific action id. So I did not observe Next's built-in Origin check rejecting a cross-site action, and P2-5 was reproduced on the parsing expression, not end to end.
- **A real reverse proxy in front of Next (P2-1):** I did not test one, so I cannot say whether a specific proxy setup fixes it.
- **Browser-level accessibility (screen reader, keyboard order) and visual parity:** not checked; I only reviewed markup and attributes.
- **The benchmark results in `docs/performance.md`:** not re-run. `ofl_bench` is in use by the coordinator.
- **Multi-instance behaviour of the in-process rate limiters:** known and documented as per process.

## Leftovers
- Scratch files are in `reports/review-scratch/p2/` (probes, logs, pid files).
- Database `ofl_review` and the Elasticsearch indices with prefix `ofl_review_` are still present (see pass 1 for the drop commands).
