// Checkout latency at concurrency 1, 10, and 50 against a running bench server
// (scripts/bench/serve.ts express 4180). "minimal" selects only the order id;
// "full" selects OrderDetailFields, like the UI. Comparing both separates the
// cost of the checkout transaction from the cost of resolving the response.
// Usage: tsx scripts/bench/checkout-profile.ts <full|minimal>
import { randomUUID } from 'node:crypto';
import { CheckoutDocument } from '@ofl/graphql-types';
import { print } from 'graphql';
import pg from 'pg';
import { runLoad } from './load';

const base = 'http://127.0.0.1:4180';
const db = new pg.Pool({ connectionString: process.env.DATABASE_URL });
const skus = (await db.query<{ id: string; price: number }>(
  `SELECT s.id, s.price_minor::int AS price FROM skus s JOIN inventory_balances b ON b.sku_id = s.id
   GROUP BY s.id HAVING sum(b.on_hand - b.reserved) >= 200 ORDER BY s.id LIMIT 2000`)).rows;
const login = await fetch(`${base}/auth/login`, { method: 'POST', headers: { 'content-type': 'application/json', 'x-ofl-csrf': '1' }, body: JSON.stringify({ email: 'bench2@example.com', password: 'bench-pass-1' }) });
const cookie = login.headers.get('set-cookie')?.split(';')[0];
if (!cookie) throw new Error(`login failed: ${login.status}`);
const mode = process.argv[2] ?? 'full';
const query = mode === 'minimal'
  ? 'mutation($input: CheckoutInput!) { checkout(input: $input) { __typename ... on CheckoutSucceeded { order { id } } } }'
  : print(CheckoutDocument);
for (const concurrency of [1, 10, 50]) {
  const r = await runLoad({
    name: `${mode} c=${concurrency}`, concurrency, durationMs: 4000, warmupMs: 1000,
    nextRequest: (_w, n) => ({ url: `${base}/graphql`, init: { method: 'POST', headers: { 'content-type': 'application/json', 'x-ofl-csrf': '1', cookie, 'x-ofl-debug-query-count': '1' },
      body: JSON.stringify({ query, variables: { input: { idempotencyKey: randomUUID(), paymentToken: 'tok_approve', lines: [{ skuId: skus[(n * 7) % skus.length]!.id, quantity: 1, expectedUnitPriceMinor: skus[(n * 7) % skus.length]!.price }] } } }) } }),
    isSuccess: (res, body) => res.ok && body.includes('CheckoutSucceeded'),
  });
  console.warn(r.name, 'rps', r.throughputPerSecond, 'p50', r.p50Ms, 'p95', r.p95Ms, 'err', r.errorRate);
}
await db.end();
