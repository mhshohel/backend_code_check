/*
 * Shared nodes and scenarios. Business behavior is identical in all three
 * variants (it lives in @ofl/server-core), so the scenarios are written once.
 * Each variant page passes a profile P that says which framework nodes a
 * request crosses (P.route) and which URLs to use.
 */
(function () {
  'use strict';
  const OFL = (window.OFL = window.OFL || {});
  const ORDER = 'ORD-1042';
  const EAST = 'TR-42 @ WH-EAST';
  const WEST = 'TR-42 @ WH-WEST';

  // ------------------------------------------------------------------ shared nodes
  OFL.sharedNodes = function (opts = {}) {
    const hub = opts.hub || { x: 605, y: 350, w: 190, h: 70 };
    return [
      { id: 'user', label: opts.userLabel || 'You (a role)', sub: 'customer/operator/admin', x: 20, y: 30, w: 160, h: 56, type: 'actor',
        info: { does: '<p>A person using the shop. Demo accounts (local seed data): <code>customer@example.com / customer-pass-1</code>, <code>operator@example.com / operator-pass-1</code>, <code>admin@example.com / admin-pass-1</code>.</p><p>Authorization is enforced on the server; hidden buttons are only a convenience.</p>' } },
      { id: 'provider', label: 'Payment provider', sub: 'external, sends webhooks', x: 20, y: 570, w: 160, h: 64, type: 'ext',
        info: { does: '<p>An external payment provider that reports results by calling <code>POST …/webhooks/payments</code>. The body is signed with HMAC-SHA256 using <code>PAYMENT_WEBHOOK_SECRET</code>; the signature goes in <code>x-ofl-signature: sha256=&lt;hex&gt;</code>.</p><p>In this lab the worker also calls the same <code>recordPaymentNotification</code> function directly after the simulated gateway answers, so both paths share one idempotent code path.</p>', file: 'packages/server-core/src/features/payments/' } },
      { id: 'core-gql', label: 'GraphQL schema', sub: 'resolvers · DataLoaders\ndepth + cost limits', x: 605, y: 50, w: 190, h: 74, type: 'core',
        info: { does: '<p>Executable schema built by <code>buildGraphQLSchema(services)</code>. Resolvers are thin: check the viewer, parse input, call <b>one</b> operation, map the result to a union type (for example <code>CheckoutSucceeded | InsufficientStock | PriceChanged</code>).</p><p>Per-request DataLoaders batch lookups so a list of N orders costs a constant number of queries (scenario S12). Max depth 10, max cost 5000.</p>', file: ['packages/server-core/src/graphql/', 'contracts/schema.graphql'], tests: 'packages/server-core/tests/integration/graphql.test.ts' } },
      { id: 'core-ops', label: 'Feature operations', sub: 'checkout · payments\nshipping · returns · auth', x: 605, y: 150, w: 190, h: 74, type: 'core',
        info: { does: '<p>The application layer. Each operation is one business workflow inside one database transaction: it writes business rows, an outbox row and <code>pg_notify</code> together, so they become visible at the same moment.</p><p>Framework code may import only from the package index of <code>@ofl/server-core</code>.</p>', file: 'packages/server-core/src/features/<feature>/', tests: 'packages/server-core/tests/integration/*.test.ts' } },
      { id: 'domain', label: '@ofl/domain', sub: 'pure rules, no I/O', x: 605, y: 250, w: 190, h: 60, type: 'core',
        info: { does: '<p>Pure functions: warehouse allocation, money in integer cents, state machine tables, cancel/return eligibility, retry classification, input validation, cursors. 53 unit tests, no database.</p>', file: ['packages/domain/src/allocation.ts', 'packages/domain/src/state-machines.ts'], tests: 'packages/domain/tests/' } },
      { id: 'hub', label: opts.hubLabel || 'RealtimeHub', sub: 'LISTEN order_events\nfan-out to subscribers', ...hub, type: 'core',
        info: { does: '<p>Each process that serves subscriptions holds one PostgreSQL connection running <code>LISTEN order_events</code>. A notification carries only the order id: it is a <b>hint</b>. The hub re-reads the order from PostgreSQL (with the subscriber\'s permissions) and pushes the current state.</p><p>On (re)subscribe the current order is sent once, so a reconnecting client never misses the latest state (scenario S14).</p>', file: 'packages/server-core/src/realtime/', tests: 'packages/server-core/tests/integration/realtime.test.ts' } },
      { id: 'pg', label: 'PostgreSQL 17', sub: 'source of truth\norders · stock ledger · outbox\nsessions · audit', x: 840, y: 30, w: 260, h: 140, type: 'db',
        info: { does: '<p>Everything that matters is here. CHECK constraints enforce <code>0 ≤ reserved ≤ on_hand</code>; every balance change also writes an append-only movement, so balances always equal the ledger sum (<code>ofl reconcile</code>).</p><p>Row locks (<code>FOR UPDATE</code>) in a fixed order prevent overselling and deadlocks. The outbox table doubles as the job queue (<code>FOR UPDATE SKIP LOCKED</code>).</p>', file: 'infrastructure/postgres/migrations/', tests: 'packages/server-core/tests/integration/db.test.ts' } },
      { id: 'es', label: 'Elasticsearch 9', sub: 'derived product index', x: 840, y: 205, w: 260, h: 90, type: 'db',
        info: { does: '<p>A derived copy of products for full-text search, autocomplete, typo tolerance and facets. Never used for checkout decisions. Documents are written with <code>version_type: external_gte</code> so an old event can never overwrite newer data.</p><p>If it is down, search returns <code>SEARCH_UNAVAILABLE</code> while product pages and checkout keep working (S13).</p>', file: 'packages/server-core/src/search/', tests: 'packages/server-core/tests/integration/search.test.ts' } },
      { id: 'worker', label: 'Worker process', sub: 'claims outbox jobs\nSKIP LOCKED · 30 s lease · retries', x: 840, y: 335, w: 260, h: 90, type: 'worker',
        info: { does: '<p>A separate Node process per variant (<code>worker/</code> folder) that runs <code>startWorker()</code> from server-core. Topics: <code>payment.authorize</code>, <code>reservation.expire</code>, <code>refund.process</code>, <code>search.product_changed</code>, <code>order.changed</code>.</p><p>Every handler is idempotent because delivery is at least once. RETRYABLE errors back off (500 ms → 60 s, max 8 attempts); PERMANENT errors go to FAILED, visible to the admin.</p>', file: ['packages/server-core/src/worker/', 'implementations/*/worker/'], tests: 'packages/server-core/tests/integration/worker.test.ts' } },
      { id: 'gateway', label: 'Simulated gateway', sub: 'charge / refund, idempotent keys', x: 840, y: 470, w: 260, h: 64, type: 'ext',
        info: { does: '<p>Stands in for a card processor. Tokens: <code>tok_approve</code>, <code>tok_decline</code>, <code>tok_slow_approve</code> (approves after the reservation hold expires). Calls are keyed by payment id / refund id, so a retried call returns the same provider event instead of charging twice.</p>', file: 'packages/server-core/src/features/payments/' } },
    ];
  };
  OFL.sharedLinks = [['user', 'browser'], ['core-gql', 'core-ops'], ['core-ops', 'domain'], ['core-ops', 'pg'], ['core-gql', 'es'], ['worker', 'pg'], ['worker', 'gateway'], ['worker', 'es'], ['pg', 'hub']];

  // ------------------------------------------------------------------ step helpers
  function hops(P, kind, first, target) {
    const route = P.route[kind];
    const reqKind = kind === 'ws' ? 'ws' : 'http';
    const out = [{ kind: first.kind || reqKind, from: first.from || 'browser', to: route[0], ...first }];
    for (let i = 0; i < route.length; i++) {
      const node = P.nodeMap[route[i]];
      const note = node.at ? (node.at[kind] ?? node.at.default) : null;
      out.push({
        kind: reqKind, from: route[i], to: i + 1 < route.length ? route[i + 1] : target,
        label: `${node.label}${i + 1 < route.length ? ' ✓' : ' → core'}`,
        title: node.label, body: note || node.info?.does, file: node.info?.file,
      });
    }
    return out;
  }
  function reply(P, kind, from, step, to = 'browser') {
    const route = P.route[kind];
    return { kind: kind === 'ws' ? 'ws' : 'http', back: true, path: [from, route[route.length - 1], to], ...step };
  }
  const sql = (from, label, title, body, code, set) => ({ kind: 'sql', from, to: 'pg', label, title, body, code, set });
  const login = (P, email, pass) => `curl -s -c /tmp/ofl-cookies.txt -H 'content-type: application/json' -H 'x-ofl-csrf: 1' \\\n  -d '{"email":"${email}","password":"${pass}"}' ${P.api}${P.paths.login}`;
  const gql = (P, query) => `curl -s -b /tmp/ofl-cookies.txt -H 'content-type: application/json' -H 'x-ofl-csrf: 1' \\\n  -d '${JSON.stringify({ query })}' ${P.api}${P.paths.graphql}`;
  const pre = (code) => `<pre class="code">${OFL.esc(code)}</pre>`;

  // ------------------------------------------------------------------ scenarios
  OFL.buildScenarios = function (P) {
    const isNext = P.id === 'nextjs';
    const afterCheckout = {
      order: 'PENDING_PAYMENT', payment: 'PENDING', url: `${P.web}/orders/${ORDER}`,
      ui: `<b>Order ${ORDER}</b> · 5 × Trail Runner 42 · $445.00<br>${OFL.badge('Waiting for payment…')}`,
      stock: { [EAST]: [3, 3], [WEST]: [4, 2] },
      jobs: { 'payment.authorize': 'PENDING', 'reservation.expire': 'PENDING (in 15 min)', 'search.product_changed': 'PENDING' },
    };
    const S = [];

    // 1 ---------------------------------------------------------------- sign in
    {
      const steps = [{ kind: 'ui', from: 'user', to: 'browser', label: 'Submit sign-in form', title: 'The user signs in',
        body: '<p>The login form posts email and password. Nothing is stored in the browser except the cookie the server will set.</p>',
        set: { url: `${P.web}/login`, ui: 'Email <code>customer@example.com</code> · Password ••••••• · <b>[Sign in]</b>' } }];
      if (P.uiLogin === 'action') {
        steps.push(...hops(P, 'action', { label: 'Server Action: login()', title: 'Form submits to a Server Action',
          body: '<p>The <code>&lt;form action={login}&gt;</code> posts to the page itself with a <code>Next-Action</code> header. Next.js runs the action on the server. There is no hand-written API route for the UI login.</p>',
          code: `POST /login\nNext-Action: <action id>\nContent-Type: multipart/form-data\n\nemail=customer@example.com&password=…`, file: 'implementations/nextjs/modules/auth/actions.ts' }, 'core-ops'));
      } else {
        steps.push(...hops(P, 'auth', { label: `POST ${P.paths.login}`, title: 'Browser sends the credentials',
          body: '<p>JSON body plus the custom header <code>x-ofl-csrf: 1</code>. A cross-site page cannot add a custom header without a CORS preflight, and CORS only allows this variant\'s own web origin.</p>',
          code: `POST ${P.paths.login}\nContent-Type: application/json\nx-ofl-csrf: 1\n\n{"email":"customer@example.com","password":"customer-pass-1"}` }, 'core-ops'));
      }
      steps.push(
        sql('core-ops', 'verify + create session', 'login(): check password, create a session',
          '<p>Argon2id verifies the password hash. A random 32-byte token is generated; only its SHA-256 hash is stored, so a database leak does not leak live sessions. Lifetime 8 hours.</p>',
          `SELECT id, password_hash, role FROM users WHERE email = $1;\n-- argon2id.verify(hash, password)\nINSERT INTO sessions (token_hash, user_id, expires_at)\nVALUES (sha256($token), $userId, now() + interval '8 hours');`),
        reply(P, P.uiLogin === 'action' ? 'action' : 'auth', 'core-ops', P.uiLogin === 'action'
          ? { label: 'Set-Cookie + redirect', title: 'Action sets the cookie with cookies().set()', body: '<p>The action writes the cookie through the Next.js <code>cookies()</code> API and redirects. Then the Server Components re-render with the new session.</p>',
            code: 'Set-Cookie: ofl_session=<token>; Path=/; HttpOnly; SameSite=Lax\nLocation: /', set: { url: `${P.web}/`, ui: 'Signed in as <b>Casey Customer</b> · Catalog', kv: { Session: 'signed in' } } }
          : { label: '200 + Set-Cookie', title: 'Server answers with the session cookie', body: '<p><code>HttpOnly</code> (JavaScript cannot read it), <code>SameSite=Lax</code> (not sent on cross-site POST), <code>Secure</code> in production. The response body has only the user\'s public fields.</p>',
            code: 'HTTP/1.1 200 OK\nSet-Cookie: ofl_session=<token>; Path=/; HttpOnly; SameSite=Lax; Max-Age=28800\n\n{"user":{"id":"…","email":"customer@example.com","displayName":"Casey Customer","role":"CUSTOMER"}}',
            set: { url: `${P.web}/`, ui: 'Signed in as <b>Casey Customer</b> · Catalog', kv: { Session: 'signed in' } } }),
      );
      S.push({ id: 'login', title: 'Sign in', role: 'Customer', tests: ['HTTP tests: cookie flags, CSRF, rate limit'],
        summary: 'How a session cookie is created and why CSRF needs both SameSite=Lax and a custom header.',
        init: { kv: { Session: 'anonymous' } }, steps,
        try: `<p>In the browser: open <a href="${P.web}/login">${P.web}/login</a> and sign in. Or with curl (keeps the cookie in a file):</p>${pre(login(P, 'customer@example.com', 'customer-pass-1'))}<p>Without the CSRF header you get 403:</p>${pre(`curl -i -H 'content-type: application/json' -d '{}' ${P.api}${P.paths.login}`)}` });
    }

    // 2 ---------------------------------------------------------------- search
    {
      const steps = [{ kind: 'ui', from: 'user', to: 'browser', label: 'Type "trial runer"', title: 'The user searches with a typo',
        body: '<p>The search box supports full text, autocomplete, typo tolerance and facets (category, price range, availability).</p>', set: { url: `${P.web}/?q=trial+runer`, ui: 'Search: <code>trial runer</code> …' } }];
      if (P.uiSearch === 'page') {
        steps.push(...hops(P, 'page', { label: 'GET /?q=trial+runer', title: 'Browser requests the catalog page',
          body: '<p>A normal page navigation. No client-side GraphQL: the catalog page is an async Server Component.</p>', code: 'GET /?q=trial+runer HTTP/1.1\nAccept: text/html' }, 'core-gql'));
      } else {
        steps.push(...hops(P, 'graphql', { label: 'query SearchProducts', title: 'urql sends the GraphQL query',
          body: '<p>The SPA sends a typed document from <code>@ofl/graphql-types</code>. Even a query carries <code>x-ofl-csrf</code>, because the server applies the rule to every POST.</p>',
          code: `POST ${P.paths.graphql}\nx-ofl-csrf: 1\n\nquery SearchProducts($input: ProductSearchInput) {\n  searchProducts(input: $input, first: 20) {\n    totalCount\n    edges { node { name fromPrice { formatted } inStock } }\n    facets { categories { label count } }\n  }\n}\nvariables: {"input":{"text":"trial runer","inStockOnly":false}}` }, 'core-gql'));
      }
      steps.push(
        { kind: 'http', from: 'core-gql', to: 'es', label: 'multi_match, fuzzy', title: 'Resolver queries Elasticsearch',
          body: '<p>Fuzzy matching turns "trial runer" into "Trail Runner". Aggregations compute the facet counts in the same request. PostgreSQL is not touched.</p>',
          code: `POST /${P.esPrefix}products/_search\n{ "query": { "bool": { "must": { "multi_match": {\n    "query": "trial runer", "fields": ["name^3", "description"], "fuzziness": "AUTO" } } } },\n  "aggs": { "categories": { "terms": { "field": "category.slug" } } } }`, file: 'packages/server-core/src/search/' },
        { kind: 'http', back: true, from: 'es', to: 'core-gql', label: 'hits + aggregations', title: 'Elasticsearch answers',
          body: '<p>Results include <code>inStock</code> and <code>availableQuantity</code> from the index. They can be a moment stale. That is acceptable for browsing; checkout always re-checks PostgreSQL.</p>' },
      );
      if (P.uiSearch === 'page') {
        steps.push({ kind: 'http', back: true, path: ['core-gql', 'rsc', 'browser'], label: 'streamed HTML', title: 'Server Component renders HTML',
          body: '<p>The result is copied with <code>structuredClone</code> (graphql-js returns null-prototype objects that React will not pass to client components) and rendered. Anonymous results were cached with <code>unstable_cache</code> for 15 s, keyed by index prefix, so the next visitor within 15 s skips Elasticsearch.</p>',
          set: { ui: '<b>12 results</b> for "trial runer" · Trail Runner 42 — from $89.00 · In stock<br>Facets: Shoes (8) · Outdoor (4)' } });
      } else {
        steps.push(reply(P, 'graphql', 'core-gql', { label: '200 { data }', title: 'GraphQL response to the SPA',
          body: '<p>urql caches the result; React renders the list and facets. Changing a facet updates the URL so the page is shareable.</p>',
          code: '{"data":{"searchProducts":{"totalCount":12,"edges":[{"node":{"name":"Trail Runner 42","fromPrice":{"formatted":"$89.00"},"inStock":true}}, …]}}}',
          set: { ui: '<b>12 results</b> for "trial runer" · Trail Runner 42 — from $89.00 · In stock<br>Facets: Shoes (8) · Outdoor (4)' } }));
      }
      S.push({ id: 'search', title: 'Search the catalog', role: 'Customer', tests: ['search.test.ts', 'S13'],
        summary: 'Search reads only Elasticsearch, a derived copy of PostgreSQL. Typos are tolerated; facets come from aggregations.',
        init: { kv: { Session: 'signed in' } }, steps,
        try: `<p>Open <a href="${P.web}/">${P.web}/</a> and type <code>trial runer</code>. Or call the API directly:</p>${pre(gql(P, '{ searchProducts(input:{text:"trial runer"}) { totalCount edges { node { name inStock } } } }'))}` });
    }

    // 3 ---------------------------------------------------------------- checkout happy path
    {
      const steps = [
        { kind: 'ui', from: 'user', to: 'browser', label: 'Click "Place order"', title: 'Customer checks out 5 pairs',
          body: '<p>Cart: 5 × Trail Runner 42 at $89.00, card token <code>tok_approve</code>. The client generates an <b>idempotency key</b> once per cart, so a double click or a network retry cannot create two orders.</p>',
          set: { url: `${P.web}/cart`, ui: 'Cart · 5 × Trail Runner 42 · $445.00 · <b>[Place order]</b>' } },
        ...hops(P, 'graphql', { label: 'mutation Checkout', title: 'Browser sends the Checkout mutation',
          body: '<p><code>expectedUnitPriceMinor</code> is the price the customer saw. If the price changed since, the server answers <code>PriceChanged</code> instead of charging a different amount.</p>',
          code: `POST ${P.paths.graphql}\nCookie: ofl_session=…\nx-ofl-csrf: 1\n\nmutation Checkout($input: CheckoutInput!) {\n  checkout(input: $input) {\n    __typename\n    ... on CheckoutSucceeded { replayed order { id status } }\n    ... on InsufficientStock { lines { skuId requested available } }\n    ... on PriceChanged { lines { skuId currentUnitPrice { formatted } } }\n  }\n}\nvariables: {"input":{\n  "idempotencyKey":"9f1c…",\n  "lines":[{"skuId":"TR-42","quantity":5,"expectedUnitPriceMinor":8900}],\n  "paymentToken":"tok_approve"}}` }, 'core-gql'),
        { kind: 'internal', from: 'core-gql', to: 'core-ops', label: 'checkout(viewer, input)', title: 'Resolver calls one operation',
          body: '<p>The resolver requires a signed-in CUSTOMER, validates input (max 20 lines, max 100 per line), and calls <code>checkout()</code>. No business rule lives in the resolver.</p>', file: 'packages/server-core/src/features/checkout/' },
        sql('core-ops', 'BEGIN · idempotency row', 'Claim the idempotency key',
          '<p>The first statement of the transaction inserts the key. If a row already exists with the same request hash, the stored result is returned with <code>replayed: true</code>. A concurrent duplicate blocks on the unique index until this transaction commits (scenario S2).</p>',
          `BEGIN;\nINSERT INTO checkout_requests (user_id, idempotency_key, request_hash)\nVALUES ($1, $2, sha256(canonical_json(lines, token)))\nON CONFLICT DO NOTHING;`),
        sql('core-ops', 'lock stock rows', 'Lock the balance rows in a fixed order',
          '<p>Row locks serialize competing checkouts on the same SKU. The fixed order <code>(sku_id, warehouse_id)</code> means two carts with overlapping SKUs always lock in the same order, so they cannot deadlock.</p>',
          'SELECT sku_id, warehouse_id, on_hand, reserved\nFROM inventory_balances\nWHERE sku_id = ANY($1)\nORDER BY sku_id, warehouse_id\nFOR UPDATE;'),
        { kind: 'internal', from: 'core-ops', to: 'domain', label: 'allocateOrder()', title: 'Pure allocation across warehouses',
          body: '<p>WH-EAST has priority 1 but only 3 available; WH-WEST supplies the other 2. One order line becomes two reservations. If the total were short, the result would be <code>InsufficientStock</code> with no stock change.</p>',
          code: 'allocateOrder(lines, balances)\n// → [{ sku: TR-42, warehouse: WH-EAST, qty: 3 },\n//    { sku: TR-42, warehouse: WH-WEST, qty: 2 }]', file: 'packages/domain/src/allocation.ts' },
        sql('core-ops', 'order + reservations', 'Write the order and reserve stock',
          '<p>Reserving changes <b>reserved</b> only; <b>on_hand</b> changes when goods physically leave. The <code>WHERE</code> clause is defense in depth on top of the lock and the CHECK constraint.</p>',
          `INSERT INTO orders (…, status) VALUES (…, 'PENDING_PAYMENT');\nINSERT INTO order_lines …; INSERT INTO payments (…, 'PENDING');\nINSERT INTO reservations (…, 'ACTIVE', expires_at = now() + '15 min');\nINSERT INTO inventory_movements (kind, reserved_delta) VALUES ('RESERVE', 3), ('RESERVE', 2);\nUPDATE inventory_balances SET reserved = reserved + $n\n WHERE … AND reserved + $n <= on_hand;`,
          { order: 'PENDING_PAYMENT', payment: 'PENDING', stock: { [EAST]: [3, 3], [WEST]: [4, 2] } }),
        sql('core-ops', 'outbox rows', 'Write the side effects as outbox rows',
          '<p>Payment, expiry and search updates are <b>not</b> done here. They are rows in the same transaction. If the transaction rolls back, the jobs never existed; if it commits, they are guaranteed to run.</p>',
          "INSERT INTO outbox_events (topic, payload, available_at) VALUES\n ('payment.authorize',      {paymentId}, now()),\n ('reservation.expire',     {orderId},   now() + '15 min'),\n ('search.product_changed', {productId}, now());",
          { jobs: { 'payment.authorize': 'PENDING', 'reservation.expire': 'PENDING (in 15 min)', 'search.product_changed': 'PENDING' } }),
        sql('core-ops', 'pg_notify · COMMIT', 'Notify and commit',
          '<p><code>pg_notify</code> is transactional: listeners receive it only after COMMIT, together with all rows above.</p>', "SELECT pg_notify('order_events', 'ORD-1042');\nCOMMIT;"),
        reply(P, 'graphql', 'core-ops', { label: 'CheckoutSucceeded', title: 'Response: order created, waiting for payment',
          body: '<p>The customer gets an answer in tens of milliseconds. Payment has not happened yet; the UI navigates to the order page.</p>',
          code: '{"data":{"checkout":{"__typename":"CheckoutSucceeded","replayed":false,\n  "order":{"id":"ORD-1042","status":"PENDING_PAYMENT"}}}}',
          set: { url: `${P.web}/orders/${ORDER}`, ui: `<b>Order ${ORDER}</b> · 5 × Trail Runner 42 · $445.00<br>${OFL.badge('Waiting for payment…')}` } }),
        ...hops(P, 'ws', { label: 'subscribe orderUpdated', title: 'Order page opens a live subscription',
          body: `<p>graphql-ws protocol over a WebSocket ${isNext ? 'to the separate realtime process on port 9009 (route handlers cannot upgrade connections). The session cookie is host-scoped, so the browser still sends it to the other port.' : 'on the same port as the API. The session cookie authenticates the upgrade; an Origin not on the allowlist is rejected.'}</p>`,
          code: `${P.wsUrl}\n→ {"type":"connection_init"}\n→ {"id":"1","type":"subscribe","payload":{"query":\n   "subscription { orderUpdated(orderId:\\"ORD-1042\\") { order { status } } }"}}` }, 'hub'),
        sql('hub', 'read current order', 'Send the current state once',
          '<p>The hub checks that this viewer may see the order (another customer gets NOT_FOUND), then sends the current state. This is also what happens on every reconnect.</p>', "SELECT … FROM orders WHERE id = 'ORD-1042' AND customer_id = $viewer;"),
        { kind: 'job', from: 'worker', to: 'pg', label: 'claim payment.authorize', title: 'Worker claims the payment job',
          body: '<p>Many workers can poll safely: <code>SKIP LOCKED</code> hands each job to exactly one of them. The 30 s lease means a crashed worker\'s job becomes claimable again.</p>',
          code: "WITH next AS (SELECT id FROM outbox_events\n  WHERE (status = 'PENDING' AND available_at <= now())\n     OR (status = 'PROCESSING' AND lease_expires_at < now() AND attempts < max_attempts)\n  ORDER BY available_at, id LIMIT 4 FOR UPDATE SKIP LOCKED)\nUPDATE outbox_events o SET status = 'PROCESSING', attempts = o.attempts + 1,\n  locked_by = $worker, lease_expires_at = now() + '30 s'\nFROM next WHERE o.id = next.id RETURNING *;",
          set: { jobs: { 'payment.authorize': 'PROCESSING' } } },
        { kind: 'http', from: 'worker', to: 'gateway', label: 'charge(key = paymentId)', title: 'Charge the card',
          body: '<p>The gateway call uses the payment id as idempotency key. If the worker crashes after this call and the job is retried, the gateway returns the <b>same</b> provider event instead of charging again (scenario S7).</p>',
          code: 'gateway.charge({ idempotencyKey: payment.id, token: "tok_approve", amountMinor: 44500 })' },
        { kind: 'http', back: true, from: 'gateway', to: 'worker', label: 'PAYMENT_SUCCEEDED', title: 'Gateway approves', code: '{ "providerEventId": "evt_7Q2…", "kind": "PAYMENT_SUCCEEDED", "amountMinor": 44500 }' },
        sql('worker', 'recordPaymentNotification', 'Record the payment exactly once',
          '<p>The same function the HTTP webhook uses. It locks the order row first (the race rule: whoever locks the order first wins), then deduplicates by <code>provider_event_id</code>. Reservations become CONFIRMED, so expiry will no longer touch them.</p>',
          "BEGIN;\nSELECT … FROM orders WHERE id = $1 FOR UPDATE;\nINSERT INTO payment_events (provider_event_id, …) ON CONFLICT DO NOTHING;  -- 1 row: new\nUPDATE payments SET status = 'CAPTURED';\nUPDATE orders SET status = 'CONFIRMED';\nUPDATE reservations SET status = 'CONFIRMED';\nSELECT pg_notify('order_events', 'ORD-1042');\nCOMMIT;",
          { order: 'CONFIRMED', payment: 'CAPTURED' }),
        { kind: 'job', from: 'worker', to: 'pg', label: 'mark job DONE', title: 'Acknowledge the job', set: { jobs: { 'payment.authorize': 'DONE' } } },
        { kind: 'notify', from: 'pg', to: 'hub', label: 'NOTIFY order_events', title: 'PostgreSQL wakes up the listeners',
          body: '<p>Every API process (there may be several) holds one LISTEN connection, so the update reaches the customer no matter which process the WebSocket landed on (scenario S14).</p>', code: "NOTIFY order_events, 'ORD-1042'" },
        sql('hub', 're-read order', 'Re-read, never trust the hint', '<p>The notification carries only the id. The hub reads the committed order, so a late or duplicate notification cannot show stale data.</p>'),
        { kind: 'ws', back: true, path: ['hub', P.route.ws[P.route.ws.length - 1], 'browser'], label: 'next: CONFIRMED', title: 'Live update pushed to the browser',
          body: '<p>The SPA ignores an event older than the state it already shows (a bug the tests caught: a late event could overwrite newer state).</p>',
          code: '← {"id":"1","type":"next","payload":{"data":{"orderUpdated":{"order":{"status":"CONFIRMED"}}}}}',
          set: { ui: `<b>Order ${ORDER}</b> · 5 × Trail Runner 42 · $445.00<br>${OFL.badge('CONFIRMED')} Payment received` } },
        { kind: 'job', from: 'worker', to: 'pg', label: 'claim search.product_changed', title: 'Meanwhile: search sync job', body: '<p>The available quantity changed, so the search document must be refreshed.</p>', set: { jobs: { 'search.product_changed': 'PROCESSING' } } },
        { kind: 'http', from: 'worker', to: 'es', label: 'index doc (external_gte)', title: 'Re-index with an external version',
          body: '<p>The worker re-reads the product from PostgreSQL and indexes it with version = sum of version counters. A reordered older event gets 409 from Elasticsearch, which counts as success (scenario S8).</p>',
          code: `PUT /${P.esPrefix}products/_doc/trail-runner-42?version=118&version_type=external_gte\n{ "name": "Trail Runner 42", "inStock": true, "availableQuantity": 2, … }`, set: { jobs: { 'search.product_changed': 'DONE' } } },
        { kind: 'job', from: 'worker', to: 'pg', label: '15 min later: reservation.expire', title: 'The expiry job runs and does nothing',
          body: '<p>It locks the order, sees CONFIRMED (not PENDING_PAYMENT) and exits. Idempotent consumers make "at least once" delivery safe.</p>', set: { jobs: { 'reservation.expire': 'DONE (no-op)' } } },
      ];
      S.push({ id: 'checkout', title: 'Checkout → payment → live update', role: 'Customer', tests: ['S1', 'S2', 'S6', 'S7', 'S14', 'checkout.test.ts'],
        summary: 'The core flow end to end: one transaction reserves stock and writes outbox jobs; the worker charges the card; PostgreSQL NOTIFY pushes the new status to the browser.',
        init: { kv: { Session: 'signed in' }, url: `${P.web}/cart`, ui: 'Cart · 5 × Trail Runner 42', stock: { [EAST]: [3, 0], [WEST]: [4, 0] } }, steps,
        try: `<ol><li><code>make ${P.id}-seed</code> then <code>make ${P.id}-dev</code></li><li>Open <a href="${P.web}/">${P.web}</a>, sign in as <code>customer@example.com / customer-pass-1</code>.</li><li>Add a product to the cart, choose <b>Approve</b> as the test card, place the order.</li><li>Watch the order page switch from "Waiting for payment" to CONFIRMED without reloading.</li></ol><p>Look at the database while you do it:</p>${pre(`psql ${P.db} -c "select topic, status, attempts from outbox_events order by id desc limit 5"`)}` });
    }

    // 4 ---------------------------------------------------------------- declined
    S.push({ id: 'declined', title: 'Payment declined', role: 'System', tests: ['S3'],
      summary: 'Card token tok_decline. The worker records the decline, the order is cancelled and the reserved stock is released exactly once.',
      init: { ...afterCheckout }, steps: [
        { kind: 'job', from: 'worker', to: 'pg', label: 'claim payment.authorize', title: 'Worker claims the payment job', set: { jobs: { 'payment.authorize': 'PROCESSING' } } },
        { kind: 'http', from: 'worker', to: 'gateway', label: 'charge(tok_decline)', title: 'Charge attempt' },
        { kind: 'error', back: true, from: 'gateway', to: 'worker', label: 'PAYMENT_DECLINED', title: 'Gateway declines', code: '{ "providerEventId": "evt_D9…", "kind": "PAYMENT_DECLINED" }' },
        sql('worker', 'decline + RELEASE', 'Cancel and release in one transaction',
          '<p>Decline while PENDING_PAYMENT: payment DECLINED, order CANCELLED (reason PAYMENT_DECLINED), every ACTIVE reservation RELEASED with a RELEASE movement. A duplicate decline later finds the event already recorded and changes nothing.</p>',
          "BEGIN; SELECT … FROM orders WHERE id = $1 FOR UPDATE;\nINSERT INTO payment_events … ON CONFLICT DO NOTHING;\nUPDATE payments SET status = 'DECLINED';\nUPDATE orders SET status = 'CANCELLED', cancel_reason = 'PAYMENT_DECLINED';\nUPDATE reservations SET status = 'RELEASED';\nINSERT INTO inventory_movements (kind, reserved_delta) VALUES ('RELEASE', -3), ('RELEASE', -2);\nUPDATE inventory_balances SET reserved = reserved - $n …;\nSELECT pg_notify('order_events', 'ORD-1042'); COMMIT;",
          { order: 'CANCELLED', payment: 'DECLINED', stock: { [EAST]: [3, 0], [WEST]: [4, 0] }, jobs: { 'payment.authorize': 'DONE' } }),
        { kind: 'notify', from: 'pg', to: 'hub', label: 'NOTIFY order_events', title: 'Listeners are told' },
        { kind: 'ws', back: true, path: ['hub', P.route.ws[P.route.ws.length - 1], 'browser'], label: 'next: CANCELLED', title: 'Customer sees the result live',
          set: { ui: `<b>Order ${ORDER}</b><br>${OFL.badge('CANCELLED')} Your card was declined. Nothing was charged.` } },
        { kind: 'job', from: 'worker', to: 'pg', label: 'later: reservation.expire', title: 'Expiry finds nothing to do', body: '<p>Order is already CANCELLED, so no second release happens. The ledger still sums to the balances.</p>', set: { jobs: { 'reservation.expire': 'DONE (no-op)' } } },
      ],
      try: `<p>Place an order and pick the <b>Decline</b> test card. Then check the ledger:</p>${pre(`cd implementations/${P.id} && pnpm exec ofl reconcile`)}` });

    // 5 ---------------------------------------------------------------- webhook
    {
      const wh = P.route.webhook;
      const body = '{"providerEventId":"evt_7Q2","paymentId":"pay_51","kind":"PAYMENT_SUCCEEDED","amountMinor":44500}';
      const steps = [
        ...hops(P, 'webhook', { from: 'provider', label: `POST ${P.paths.webhook}`, title: 'Provider calls the webhook',
          body: '<p>No cookie, no CSRF header: the caller is a server, not a browser. Authentication is the HMAC signature over the <b>exact raw bytes</b> of the body, so the route must not parse and re-serialize JSON before verifying.</p>',
          code: `POST ${P.paths.webhook}\nContent-Type: application/json\nx-ofl-signature: sha256=3b1f…e9\n\n${body}` }, 'core-ops'),
        { kind: 'internal', from: 'core-ops', to: 'core-ops', label: 'verify HMAC', title: 'handlePaymentWebhook(): verify the signature',
          body: '<p>Recompute HMAC-SHA256(rawBody, PAYMENT_WEBHOOK_SECRET) and compare in constant time. Wrong signature → 401 without touching the database. Bad shape → 400.</p>', file: 'packages/server-core/src/features/payments/' },
        sql('core-ops', 'recordPaymentNotification', 'Same code path as the worker',
          '<p>Lock the order, insert into <code>payment_events</code> keyed by <code>provider_event_id</code>. One row inserted → apply the effect.</p>',
          "SELECT … FROM orders WHERE id = $1 FOR UPDATE;\nINSERT INTO payment_events (provider_event_id, …) VALUES ('evt_7Q2', …)\nON CONFLICT (provider_event_id) DO NOTHING;   -- inserted 1 row\nUPDATE payments SET status = 'CAPTURED'; UPDATE orders SET status = 'CONFIRMED'; …",
          { order: 'CONFIRMED', payment: 'CAPTURED', kv: { 'Webhook reply': 'processed' } }),
        reply(P, 'webhook', 'core-ops', { label: '200 processed', title: 'Answer 200', code: 'HTTP/1.1 200 OK\n{"status":"processed"}' }, 'provider'),
        { kind: 'http', from: 'provider', path: ['provider', ...wh, 'core-ops'], label: 'same event again', title: 'Provider retries (at-least-once delivery)',
          body: '<p>Providers resend when they miss an acknowledgement. The request crosses the same route again.</p>', code: `POST ${P.paths.webhook}\nx-ofl-signature: sha256=3b1f…e9\n\n${body}` },
        sql('core-ops', 'ON CONFLICT → 0 rows', 'Duplicate detected', '<p>Zero rows inserted means "seen before": return without side effects. No double capture, no second notification (scenario S4).</p>',
          "INSERT INTO payment_events … ON CONFLICT (provider_event_id) DO NOTHING;   -- inserted 0 rows", { kv: { 'Webhook reply': 'duplicate' } }),
        reply(P, 'webhook', 'core-ops', { label: '200 duplicate', title: 'Still 200, so the provider stops retrying', code: 'HTTP/1.1 200 OK\n{"status":"duplicate"}' }, 'provider'),
        { kind: 'error', from: 'provider', path: ['provider', ...wh, 'core-ops'], label: 'forged signature', title: 'An attacker posts a fake success', code: `POST ${P.paths.webhook}\nx-ofl-signature: sha256=0000…\n\n{"paymentId":"pay_99","kind":"PAYMENT_SUCCEEDED",…}` },
        reply(P, 'webhook', 'core-ops', { kind: 'error', label: '401', title: 'Rejected before any SQL', code: 'HTTP/1.1 401 Unauthorized\n{"error":"invalid signature"}', set: { kv: { 'Webhook reply': '401 invalid signature' } } }, 'provider'),
      ];
      S.push({ id: 'webhook', title: 'Payment webhook (+ duplicate, + forged)', role: 'External', tests: ['S4', 'HTTP webhook tests'],
        summary: `The external entry point. ${P.webhookSummary}`,
        init: { ...afterCheckout, ui: afterCheckout.ui }, steps,
        try: `<p>The secret is <code>PAYMENT_WEBHOOK_SECRET</code> in <code>implementations/${P.id}/.env</code>. Use a real payment id from <code>select id from payments order by created_at desc limit 1</code>.</p>${pre(`SECRET=$(grep PAYMENT_WEBHOOK_SECRET implementations/${P.id}/.env | cut -d= -f2)\nBODY='{"providerEventId":"evt_demo_1","paymentId":"<payment id>","kind":"PAYMENT_SUCCEEDED","amountMinor":44500}'\nSIG=$(printf '%s' "$BODY" | openssl dgst -sha256 -hmac "$SECRET" | sed 's/^.* //')\ncurl -i ${P.api}${P.paths.webhook} -H 'content-type: application/json' \\\n  -H "x-ofl-signature: sha256=$SIG" -d "$BODY"\n# run it twice: the second answer is {"status":"duplicate"}`)}` });
    }

    // 6 ---------------------------------------------------------------- expiry race
    S.push({ id: 'expiry-race', title: 'Race: slow payment vs. expiry', role: 'System', tests: ['S5', 'payments.test.ts'],
      summary: 'Card token tok_slow_approve answers after the 15-minute hold. Whoever locks the order row first wins; the loser adapts. Here expiry wins, so the late payment is refunded.',
      init: { ...afterCheckout }, steps: [
        { kind: 'job', from: 'worker', to: 'pg', label: 'claim payment.authorize', title: 'Worker A claims the payment job', set: { jobs: { 'payment.authorize': 'PROCESSING' } } },
        { kind: 'http', from: 'worker', to: 'gateway', label: 'charge(tok_slow_approve)…', title: 'The gateway is slow', body: '<p>The call is in flight. Nothing is locked while we wait: a long external call inside a transaction would hold row locks for minutes.</p>' },
        { kind: 'job', from: 'worker', to: 'pg', label: '15 min: claim reservation.expire', title: 'Worker B claims the expiry job', body: '<p>The hold has run out. (A sweeper also re-enqueues expiry for ACTIVE reservations past <code>expires_at</code>, in case a job was lost.)</p>', set: { jobs: { 'reservation.expire': 'PROCESSING' } } },
        sql('worker', 'expiry locks order first', 'Expiry wins the lock',
          '<p>Still PENDING_PAYMENT and past expiry → release all ACTIVE reservations, cancel with reason RESERVATION_EXPIRED. The 5 units are available to other customers again.</p>',
          "BEGIN; SELECT … FROM orders WHERE id = $1 FOR UPDATE;   -- granted\n-- status = PENDING_PAYMENT and now() >= reservation_expires_at\nUPDATE reservations SET status = 'RELEASED'; INSERT … 'RELEASE' movements;\nUPDATE orders SET status = 'CANCELLED', cancel_reason = 'RESERVATION_EXPIRED';\nSELECT pg_notify(…); COMMIT;",
          { order: 'CANCELLED', stock: { [EAST]: [3, 0], [WEST]: [4, 0] }, jobs: { 'reservation.expire': 'DONE' }, ui: `<b>Order ${ORDER}</b><br>${OFL.badge('CANCELLED')} The hold expired before payment completed.` }),
        { kind: 'http', back: true, from: 'gateway', to: 'worker', label: 'PAYMENT_SUCCEEDED (late)', title: 'The slow approval arrives' },
        sql('worker', 'sees CANCELLED → refund', 'Payment handler adapts',
          '<p>It locks the order and finds CANCELLED. The money was taken, so it records the capture and creates a <code>LATE_PAYMENT</code> refund plus a <code>refund.process</code> job. Stock is not touched again: released exactly once.</p>',
          "SELECT … FOR UPDATE;   -- status = CANCELLED\nUPDATE payments SET status = 'CAPTURED';\nINSERT INTO refunds (reason, amount_minor, status) VALUES ('LATE_PAYMENT', 44500, 'PENDING');\nINSERT INTO outbox_events (topic) VALUES ('refund.process');",
          { payment: 'CAPTURED', kv: { Refund: 'PENDING (LATE_PAYMENT)' }, jobs: { 'payment.authorize': 'DONE', 'refund.process': 'PENDING' } }),
        { kind: 'job', from: 'worker', to: 'pg', label: 'claim refund.process', title: 'Worker claims the refund job', set: { jobs: { 'refund.process': 'PROCESSING' } } },
        { kind: 'http', from: 'worker', to: 'gateway', label: 'refund(key = refundId)', title: 'Refund through the gateway', body: '<p>Keyed by refund id: a retried job can never refund twice.</p>' },
        sql('worker', 'refund SUCCEEDED', 'Mark refunded', null, "UPDATE refunds SET status = 'SUCCEEDED';\nUPDATE payments SET refunded_minor = 44500, status = 'REFUNDED';",
          { payment: 'REFUNDED', kv: { Refund: 'SUCCEEDED' }, jobs: { 'refund.process': 'DONE' }, ui: `<b>Order ${ORDER}</b><br>${OFL.badge('CANCELLED')} The hold expired. Your payment of $445.00 was refunded.` }),
      ],
      try: `<p>At checkout choose the <b>Slow approve</b> test card. To avoid waiting 15 minutes, start the variant with a short hold: set <code>RESERVATION_TTL_SECONDS=30</code> in <code>implementations/${P.id}/.env</code> and restart.</p>` });

    // 7 ---------------------------------------------------------------- ship from two warehouses
    {
      const ship = (wh, label, set, title, body, code) => [
        ...hops(P, 'graphql', { label, title, code, body }, 'core-gql'),
        { kind: 'internal', from: 'core-gql', to: 'core-ops', label: 'shipOrder()', title: 'Resolver requires OPERATOR or ADMIN' },
      ];
      const steps = [
        { kind: 'ui', from: 'user', to: 'browser', label: 'Operator: Ship WH-EAST', title: 'Operator opens "awaiting shipment"', body: '<p>Signed in as <code>operator@example.com</code>. The warehouse screen lists CONFIRMED orders per warehouse.</p>', set: { url: `${P.web}/warehouse`, ui: `Awaiting shipment · WH-EAST · <b>${ORDER}</b> 3 × TR-42 <b>[Ship]</b>` } },
        ...ship('WH-EAST', 'mutation ShipOrder (EAST)', null, 'Ship the WH-EAST part', '<p>One order, two warehouses: each warehouse ships its own part.</p>', `mutation { shipOrder(input: { orderId: "${ORDER}", warehouseId: "WH-EAST" }) {\n  __typename ... on ShipmentCreated { shipment { trackingCode } order { status } } } }`),
        sql('core-ops', 'shipment + SHIP movements', 'Write the shipment',
          '<p>Lock the order (must be CONFIRMED or PARTIALLY_SHIPPED), pick CONFIRMED reservations for WH-EAST, insert the shipment and SHIP movements. SHIP lowers <b>both</b> on_hand and reserved: the units leave and the promise is fulfilled.</p>',
          "SELECT … FROM orders WHERE id = $1 FOR UPDATE;\nINSERT INTO shipments (order_id, warehouse_id, tracking_code) VALUES ($1, 'WH-EAST', …);  -- UNIQUE(order_id, warehouse_id)\nINSERT INTO inventory_movements (kind, on_hand_delta, reserved_delta) VALUES ('SHIP', -3, -3);\nUPDATE reservations SET status = 'SHIPPED' …;\nUPDATE orders SET status = 'PARTIALLY_SHIPPED';   -- WH-WEST still CONFIRMED\nINSERT INTO outbox_events (topic) VALUES ('search.product_changed'); SELECT pg_notify(…); COMMIT;",
          { order: 'PARTIALLY_SHIPPED', stock: { [EAST]: [0, 0] }, jobs: { 'search.product_changed': 'PENDING' } }),
        reply(P, 'graphql', 'core-ops', { label: 'ShipmentCreated', title: 'Operator sees the tracking code', set: { ui: `${ORDER} · WH-EAST shipped · tracking <code>TRK-8812</code>` } }),
        { kind: 'notify', from: 'pg', to: 'hub', label: 'NOTIFY → customer', title: 'Customer\'s order page updates live', body: '<p>A different user, maybe connected to a different process: the NOTIFY reaches every listener.</p>' },
        ...ship('WH-WEST', 'mutation ShipOrder (WEST)', null, 'Ship the WH-WEST part', null, `mutation { shipOrder(input: { orderId: "${ORDER}", warehouseId: "WH-WEST" }) { … } }`),
        sql('core-ops', 'last part → SHIPPED', 'No CONFIRMED reservation left → SHIPPED', null, "INSERT INTO shipments … 'WH-WEST'; INSERT … ('SHIP', -2, -2);\nUPDATE orders SET status = 'SHIPPED';", { order: 'SHIPPED', stock: { [WEST]: [2, 0] } }),
        reply(P, 'graphql', 'core-ops', { label: 'ShipmentCreated', title: 'Done', set: { ui: `${ORDER} · ${OFL.badge('SHIPPED')} from 2 warehouses` } }),
        ...hops(P, 'graphql', { kind: 'error', label: 'ShipOrder (EAST) again', title: 'Double click: ship WH-EAST again', body: '<p>Two guards: the status check under the order lock, and <code>UNIQUE (order_id, warehouse_id)</code> on shipments as the database backstop.</p>' }, 'core-gql'),
        sql('core-ops', 'no CONFIRMED rows for EAST', 'Nothing left to ship', null, "SELECT … FROM reservations WHERE order_id = $1 AND warehouse_id = 'WH-EAST' AND status = 'CONFIRMED';  -- 0 rows"),
        reply(P, 'graphql', 'core-ops', { kind: 'error', label: 'NothingToShip', title: 'A typed business error, not an exception', code: '{"data":{"shipOrder":{"__typename":"NothingToShip","code":"NOTHING_TO_SHIP"}}}', set: { kv: { 'Last reply': 'NothingToShip' } } }),
      ];
      S.push({ id: 'ship', title: 'Ship from two warehouses', role: 'Operator', tests: ['S9', 'fulfillment-returns.test.ts'],
        summary: 'One order allocated across WH-EAST and WH-WEST ships in two parts. A repeated shipment is rejected by a status check and a unique key.',
        init: { order: 'CONFIRMED', payment: 'CAPTURED', kv: { Session: 'operator' }, stock: { [EAST]: [3, 3], [WEST]: [4, 2] } }, steps,
        try: `<p>Sign in as <code>operator@example.com / operator-pass-1</code> at <a href="${P.web}/warehouse">${P.web}/warehouse</a>, pick a warehouse and ship a confirmed order. Then look at the ledger for that SKU on the movements screen.</p>` });
    }

    // 8 ---------------------------------------------------------------- return + refund
    S.push({ id: 'return', title: 'Partial return and refund', role: 'Customer + Operator', tests: ['S10'],
      summary: 'The customer returns 1 of 5 units. The operator receives it (stock goes back to the shelf it came from), then the worker refunds $89.00.',
      init: { order: 'SHIPPED', payment: 'CAPTURED', stock: { [EAST]: [0, 0], [WEST]: [2, 0] } }, steps: [
        { kind: 'ui', from: 'user', to: 'browser', label: 'Customer: return 1 unit', title: 'Customer requests a return', set: { url: `${P.web}/orders/${ORDER}`, ui: `${ORDER} · ${OFL.badge('SHIPPED')} · Return <b>1</b> of 5 · reason "too small" <b>[Request return]</b>` } },
        ...hops(P, 'graphql', { label: 'mutation RequestReturn', title: 'RequestReturn', code: `mutation { requestReturn(input: { orderId: "${ORDER}", reason: "too small",\n  lines: [{ orderLineId: "…", quantity: 1 }] }) { __typename } }` }, 'core-gql'),
        { kind: 'internal', from: 'core-gql', to: 'core-ops', label: 'requestReturn()', title: 'Owner only', body: '<p>Another customer asking for this order gets NOT_FOUND, not FORBIDDEN, so the order\'s existence is not revealed (S11).</p>' },
        sql('core-ops', 'lock order, sum returns', 'Check the returnable quantity under lock',
          '<p>Locking the order first makes two concurrent return requests see each other. Each return line records which warehouse shipped the unit (earliest shipment first → WH-EAST).</p>',
          "SELECT … FROM orders WHERE id = $1 FOR UPDATE;\nSELECT sum(quantity) FROM return_lines …;   -- 0 already returned, 5 shipped\nINSERT INTO returns (status) VALUES ('REQUESTED'); INSERT INTO return_lines (warehouse_id = 'WH-EAST', quantity = 1);",
          { kv: { Return: 'REQUESTED' } }),
        reply(P, 'graphql', 'core-ops', { label: 'ReturnRequested', title: 'Customer sees the return', set: { ui: `${ORDER} · Return ${OFL.badge('REQUESTED')} · 1 unit · send it back to WH-EAST` } }),
        ...hops(P, 'graphql', { label: 'Operator: ReceiveReturn', title: 'The parcel arrives; operator receives it', code: 'mutation { receiveReturn(returnId: "RET-7") { __typename } }' }, 'core-gql'),
        sql('core-ops', 'RETURN_RESTOCK + refund row', 'Back on the shelf',
          '<p>RETURN_RESTOCK raises on_hand only. The movement is unique per (reference, kind, sku, warehouse), so receiving the same return twice cannot restock twice. A RETURN refund and a <code>refund.process</code> job are written in the same transaction.</p>',
          "UPDATE returns SET status = 'RECEIVED';\nINSERT INTO inventory_movements (kind, on_hand_delta, reference_type, reference_id) VALUES ('RETURN_RESTOCK', +1, 'return', 'RET-7');\nINSERT INTO refunds (reason, amount_minor) VALUES ('RETURN', 8900);\nINSERT INTO outbox_events (topic) VALUES ('refund.process');",
          { kv: { Return: 'RECEIVED', Refund: 'PENDING' }, stock: { [EAST]: [1, 0] }, jobs: { 'refund.process': 'PENDING' } }),
        reply(P, 'graphql', 'core-ops', { label: 'ReturnReceived', title: 'Operator done' }),
        { kind: 'job', from: 'worker', to: 'pg', label: 'claim refund.process', title: 'Worker picks up the refund', set: { jobs: { 'refund.process': 'PROCESSING' } } },
        { kind: 'http', from: 'worker', to: 'gateway', label: 'refund 8900 (key = refundId)', title: 'Refund $89.00' },
        sql('worker', 'PARTIALLY_REFUNDED', 'Update payment and return', null, "UPDATE refunds SET status = 'SUCCEEDED';\nUPDATE payments SET refunded_minor = refunded_minor + 8900, status = 'PARTIALLY_REFUNDED';\nUPDATE returns SET status = 'REFUNDED';",
          { payment: 'PARTIALLY_REFUNDED', kv: { Return: 'REFUNDED', Refund: 'SUCCEEDED' }, jobs: { 'refund.process': 'DONE' }, ui: `${ORDER} · Return ${OFL.badge('REFUNDED')} · $89.00 back to your card` }),
      ],
      try: `<p>As the customer, open a SHIPPED order and request a return of 1 unit. As <code>operator@example.com</code>, open <a href="${P.web}/warehouse${isNext ? '/returns' : ''}">${P.web}/warehouse${isNext ? '/returns' : ''}</a> and receive it.</p>` });

    // 9 ---------------------------------------------------------------- oversell race
    S.push({ id: 'oversell', title: 'Race: 20 buyers, 5 units', role: 'Customer × 20', tests: ['S1', 'S6', 'bench: hot SKU'],
      summary: 'Twenty concurrent checkouts for the last 5 units. Row locks queue them; exactly 5 succeed, 15 get InsufficientStock, and stock never goes negative.',
      init: { stock: { 'HOT-1 @ WH-EAST': [5, 0], 'HOT-1 @ WH-WEST': [0, 0] }, kv: { Succeeded: '0', 'InsufficientStock': '0' } }, steps: [
        { kind: 'http', count: 20, path: ['browser', ...P.route.graphql, 'core-gql', 'core-ops'], label: '20 × Checkout', title: '20 requests at the same moment',
          body: '<p>Each request runs its own transaction on its own pooled connection.</p>' },
        { kind: 'sql', count: 20, from: 'core-ops', to: 'pg', label: '20 × SELECT … FOR UPDATE', title: 'All 20 want the same rows',
          body: '<p>PostgreSQL grants the row lock to one transaction; the other 19 wait in a queue. No application-level mutex, no Redis lock: the database is the single point of truth.</p>', code: 'SELECT … FROM inventory_balances WHERE sku_id = \'HOT-1\' ORDER BY sku_id, warehouse_id FOR UPDATE;' },
        sql('core-ops', 'buyers 1–5 reserve', 'The first five see available ≥ 1',
          '<p>Each reserves one unit and commits, releasing the lock to the next in line. The UPDATE also checks <code>reserved + n &lt;= on_hand</code>, and a CHECK constraint backs it up.</p>',
          null, { stock: { 'HOT-1 @ WH-EAST': [5, 5] }, kv: { Succeeded: '5' } }),
        sql('core-ops', 'buyers 6–20: available = 0', 'The rest see nothing left',
          '<p>allocateOrder() returns short → the operation stores <code>InsufficientStock</code> as the result for that idempotency key and commits without stock changes.</p>', null, { kv: { InsufficientStock: '15' } }),
        { kind: 'http', back: true, count: 20, path: ['core-ops', P.route.graphql[P.route.graphql.length - 1], 'browser'], label: '5 ok · 15 InsufficientStock', title: 'Twenty answers',
          code: '{"__typename":"CheckoutSucceeded", …}           × 5\n{"__typename":"InsufficientStock","lines":[{"requested":1,"available":0}]}  × 15',
          set: { ui: 'Sold out. 5 orders placed, 15 customers told "only 0 left".' } },
        { kind: 'sql', from: 'core-ops', to: 'pg', label: 'invariant check', title: 'The tests then check the ledger',
          body: '<p>After every acceptance scenario: <code>on_hand = Σ on_hand_delta</code> and <code>reserved = Σ reserved_delta</code> for every (sku, warehouse). Under the 50-connection benchmark the hot SKU also sold out to exactly 0.</p>', code: 'pnpm exec ofl reconcile   # → 0 differences' },
      ],
      try: `<p>Run the acceptance scenario that does exactly this against ${P.name}:</p>${pre(`make test-scenario VARIANT=${P.id} S=S1`)}` });

    // 10 --------------------------------------------------------------- idempotent retry
    S.push({ id: 'idempotency', title: 'Retry with the same idempotency key', role: 'Customer', tests: ['S2'],
      summary: 'The network drops the response and the browser retries. Same key + same cart = the first result, replayed. No second order, no second reservation.',
      init: { stock: { [EAST]: [3, 0], [WEST]: [4, 0] }, kv: { Orders: '0' } }, steps: [
        { kind: 'http', path: ['browser', ...P.route.graphql, 'core-gql', 'core-ops'], label: 'Checkout key=9f1c', title: 'First attempt' },
        sql('core-ops', 'INSERT key → new', 'Key is new: do the full checkout', null, 'INSERT INTO checkout_requests … ON CONFLICT DO NOTHING;   -- 1 row\n… reserve, outbox, store result …\nCOMMIT;', { order: 'PENDING_PAYMENT', stock: { [EAST]: [3, 3], [WEST]: [4, 2] }, kv: { Orders: '1' } }),
        { kind: 'error', back: true, path: ['core-ops', P.route.graphql[P.route.graphql.length - 1], 'browser'], label: 'response lost ✗', title: 'The response never arrives', body: '<p>Wi-Fi drops. The browser cannot know whether the order was created.</p>', set: { ui: 'Network error. Retrying…' } },
        { kind: 'http', path: ['browser', ...P.route.graphql, 'core-gql', 'core-ops'], label: 'Checkout key=9f1c (retry)', title: 'Retry with the same key' },
        sql('core-ops', 'key exists, same hash', 'Replay the stored result',
          '<p>Same key and same request hash → return the stored result with <code>replayed: true</code>. A different cart with the same key → <code>IdempotencyKeyReused</code>. If both attempts arrive at once, the second blocks on the unique index until the first commits.</p>',
          'INSERT INTO checkout_requests … ON CONFLICT DO NOTHING;   -- 0 rows\nSELECT request_hash, result FROM checkout_requests WHERE user_id = $1 AND idempotency_key = $2;'),
        reply(P, 'graphql', 'core-ops', { label: 'replayed: true', title: 'Same order, once', code: '{"checkout":{"__typename":"CheckoutSucceeded","replayed":true,"order":{"id":"ORD-1042"}}}', set: { ui: `<b>Order ${ORDER}</b> ${OFL.badge('Waiting for payment…')}`, kv: { Orders: '1 (replayed)' } } }),
      ],
      try: `${pre(`make test-scenario VARIANT=${P.id} S=S2`)}` });

    // 11 --------------------------------------------------------------- price change
    {
      const steps = [{ kind: 'ui', from: 'user', to: 'browser', label: 'Admin: price $89 → $79', title: 'Administrator changes a price', set: { url: `${P.web}/admin`, ui: 'Admin · TR-42 price <code>$79.00</code> <b>[Save]</b>' } }];
      if (P.uiPrice === 'action') {
        steps.push(...hops(P, 'action', { label: 'Server Action updatePrice()', title: 'Form posts to a Server Action', body: '<p>The action runs the <code>UpdateSkuPrice</code> operation in-process with <code>executeOperation</code> (no HTTP hop) using the admin\'s session.</p>', file: 'implementations/nextjs/modules/admin/actions.ts' }, 'core-gql'));
      } else {
        steps.push(...hops(P, 'graphql', { label: 'mutation UpdateSkuPrice', title: 'Admin SPA sends the mutation', code: 'mutation { updateSkuPrice(input: { skuId: "TR-42", priceMinor: 7900 }) { __typename } }' }, 'core-gql'));
      }
      steps.push(
        { kind: 'internal', from: 'core-gql', to: 'core-ops', label: 'updateSkuPrice()', title: 'ADMIN only' },
        sql('core-ops', 'price, version, audit, outbox', 'One transaction', '<p><code>skus.version</code> increments, so the search document version grows. An audit row records who did it with the correlation id.</p>',
          "UPDATE skus SET price_minor = 7900, version = version + 1 WHERE id = 'TR-42';\nINSERT INTO audit_log (actor, action, correlation_id) …;\nINSERT INTO outbox_events (topic) VALUES ('search.product_changed');\nCOMMIT;", { kv: { Price: '$79.00', 'Search doc': 'stale ($89)' }, jobs: { 'search.product_changed': 'PENDING' } }),
      );
      if (P.uiPrice === 'action') {
        steps.push({ kind: 'internal', from: 'actions', to: 'cache', label: "revalidateTag('catalog')", title: 'Invalidate the Next.js data cache', body: '<p>Cached catalog pages are dropped so the next request renders the new price. Pages that read the session were never cached.</p>' },
          { kind: 'http', back: true, from: 'actions', to: 'browser', label: 'action result', title: 'Admin sees "Saved"', set: { ui: 'Admin · TR-42 · <b>$79.00</b> · Saved' } });
      } else {
        steps.push(reply(P, 'graphql', 'core-ops', { label: 'SkuPriceUpdated', title: 'Admin sees "Saved"', set: { ui: 'Admin · TR-42 · <b>$79.00</b> · Saved' } }));
      }
      steps.push(
        { kind: 'job', from: 'worker', to: 'pg', label: 'claim + re-read product', title: 'Worker reads the committed state', body: '<p>The job payload has only the product id. The worker reads the current product, SKUs and balances and computes version = products.version + Σ skus.version + Σ balances.version.</p>', set: { jobs: { 'search.product_changed': 'PROCESSING' } } },
        { kind: 'http', from: 'worker', to: 'es', label: 'index v119 (external_gte)', title: 'Index the new document',
          body: '<p>If an older event for the same product is processed later, its version is lower: Elasticsearch answers 409 and the worker treats that as success. Stale data can never win (S8).</p>',
          code: `PUT /${P.esPrefix}products/_doc/trail-runner-42?version=119&version_type=external_gte`, set: { kv: { 'Search doc': 'v119 ($79)' }, jobs: { 'search.product_changed': 'DONE' } } },
        { kind: 'ui', from: 'browser', to: 'user', label: 'customer with old cart', title: 'A customer who saw $89 checks out',
          body: '<p>The cart still sends <code>expectedUnitPriceMinor: 8900</code>. Checkout compares it with PostgreSQL (not the index) and returns <code>PriceChanged</code> with the new price, instead of silently charging a different amount.</p>',
          set: { ui: `${OFL.badge('PriceChanged')} Trail Runner 42 now costs $79.00. Review your cart.` } },
      );
      S.push({ id: 'price', title: 'Price change → search re-index', role: 'Admin', tests: ['S8', 'search.test.ts'],
        summary: 'A price change writes an audit row and a search event in one transaction. The worker re-indexes with an external version; carts with the old price get PriceChanged.',
        init: { kv: { Price: '$89.00', 'Search doc': 'v118 ($89)' } }, steps,
        try: `<p>Sign in as <code>admin@example.com / admin-pass-1</code>, open <a href="${P.web}/admin">${P.web}/admin</a> and change a price. Search for the product: the new price shows after the worker runs (usually under a second).</p>` });
    }

    return S;
  };
})();
