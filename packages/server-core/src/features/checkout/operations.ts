import { z } from 'zod';
import {
  allocateOrder,
  badInput,
  checkoutInputSchema,
  multiplyMinor,
  parseInput,
  reservationExpiry,
  sumMinor,
  type Allocation,
  type CheckoutInput,
  type WarehouseStock,
} from '@ofl/domain';
import type { Tx } from '../../db/db';
import { enqueueEvents } from '../../outbox/outbox';
import type { Services } from '../../services';
import { requireCustomer } from '../auth/guards';
import type { RequestMeta, SessionUser } from '../auth/sessions';
import { applyStockChanges } from '../inventory/ledger';
import { recordOrderChanged } from '../orders/events';
import { checkoutRequestHash } from './request-hash';

export type CheckoutOutcome =
  | { kind: 'succeeded'; orderId: string; replayed: boolean }
  | { kind: 'insufficient_stock'; lines: { skuId: string; requested: number; available: number }[] }
  | { kind: 'price_changed'; lines: { skuId: string; expectedUnitPriceMinor: number; currentUnitPriceMinor: number }[] }
  | { kind: 'idempotency_key_reused' };

// What checkout_requests.result stores. Parsed on replay, because jsonb
// written by an older version of the code must still be read safely.
const storedResultSchema = z.discriminatedUnion('kind', [
  z.object({ kind: z.literal('succeeded'), orderId: z.string() }),
  z.object({
    kind: z.literal('insufficient_stock'),
    lines: z.array(z.object({ skuId: z.string(), requested: z.number(), available: z.number() })),
  }),
  z.object({
    kind: z.literal('price_changed'),
    lines: z.array(z.object({ skuId: z.string(), expectedUnitPriceMinor: z.number(), currentUnitPriceMinor: z.number() })),
  }),
]);
type StoredResult = z.infer<typeof storedResultSchema>;

const PENDING_RESULT = { kind: 'pending' };

type SkuRow = { id: string; productId: string; productName: string; code: string; priceMinor: number };
type BalanceRow = { skuId: string; warehouseId: string; onHand: number; reserved: number; priority: number };

/** Customer checkout (requirements §6.1). One transaction; retried on deadlock or serialization failure. */
export async function checkout(services: Services, viewer: SessionUser | null, input: unknown, meta: RequestMeta): Promise<CheckoutOutcome> {
  const customer = requireCustomer(viewer);
  const request = parseInput(checkoutInputSchema, input);
  const requestHash = checkoutRequestHash(request);

  const outcome = await services.db.transaction((tx) => runCheckout(services, tx, customer.id, request, requestHash, meta));
  services.logger.info({ correlationId: meta.correlationId, customerId: customer.id, outcome: outcome.kind }, 'checkout');
  return outcome;
}

async function runCheckout(
  services: Services,
  tx: Tx,
  customerId: string,
  request: CheckoutInput,
  requestHash: string,
  meta: RequestMeta,
): Promise<CheckoutOutcome> {
  // A concurrent request with the same key blocks on the primary key until
  // this transaction ends, then sees the committed row and replays it.
  const claimed = await tx.query(
    `INSERT INTO checkout_requests (customer_id, idempotency_key, request_hash, result)
     VALUES ($1, $2, $3, $4) ON CONFLICT DO NOTHING`,
    [customerId, request.idempotencyKey, requestHash, JSON.stringify(PENDING_RESULT)],
  );
  if (claimed.rowCount === 0) return replayStoredRequest(tx, customerId, request.idempotencyKey, requestHash);

  const skus = await loadSkus(tx, request);
  const priceChanges = request.lines
    .map((line) => ({ line, sku: skus.get(line.skuId) }))
    .filter(({ line, sku }) => sku !== undefined && sku.priceMinor !== line.expectedUnitPriceMinor)
    .map(({ line, sku }) => ({
      skuId: line.skuId,
      expectedUnitPriceMinor: line.expectedUnitPriceMinor,
      currentUnitPriceMinor: sku?.priceMinor ?? 0,
    }));
  if (priceChanges.length > 0) {
    return storeFailure(tx, customerId, request.idempotencyKey, { kind: 'price_changed', lines: priceChanges });
  }

  const balances = await tx.query<BalanceRow>(
    `SELECT b.sku_id AS "skuId", b.warehouse_id AS "warehouseId", b.on_hand AS "onHand", b.reserved, w.priority
     FROM inventory_balances b JOIN warehouses w ON w.id = b.warehouse_id
     WHERE b.sku_id = ANY($1::uuid[])
     ORDER BY b.sku_id, b.warehouse_id
     FOR UPDATE OF b`,
    [request.lines.map((l) => l.skuId)],
  );
  const allocation = allocateOrder(request.lines, stockBySku(balances.rows));
  if (allocation.kind === 'short') {
    return storeFailure(tx, customerId, request.idempotencyKey, {
      kind: 'insufficient_stock',
      lines: allocation.shortages.map((s) => ({ skuId: s.skuId, requested: s.requested, available: s.available })),
    });
  }

  const orderId = await createOrder(services, tx, customerId, request, skus, allocation.allocations, meta);
  await tx.query(
    'UPDATE checkout_requests SET result = $3, order_id = $4 WHERE customer_id = $1 AND idempotency_key = $2',
    [customerId, request.idempotencyKey, JSON.stringify({ kind: 'succeeded', orderId } satisfies StoredResult), orderId],
  );
  return { kind: 'succeeded', orderId, replayed: false };
}

async function replayStoredRequest(tx: Tx, customerId: string, key: string, requestHash: string): Promise<CheckoutOutcome> {
  const stored = await tx.query<{ requestHash: string; result: unknown }>(
    'SELECT request_hash AS "requestHash", result FROM checkout_requests WHERE customer_id = $1 AND idempotency_key = $2',
    [customerId, key],
  );
  const row = stored.rows[0];
  if (!row) throw new Error('Idempotency row vanished during checkout.');
  if (row.requestHash !== requestHash) return { kind: 'idempotency_key_reused' };
  const result = storedResultSchema.parse(row.result);
  if (result.kind === 'succeeded') return { kind: 'succeeded', orderId: result.orderId, replayed: true };
  return result;
}

async function storeFailure(
  tx: Tx,
  customerId: string,
  key: string,
  failure: Exclude<StoredResult, { kind: 'succeeded' }>,
): Promise<CheckoutOutcome> {
  // Business failures are stored too: a retry with the same key gets the same answer.
  await tx.query('UPDATE checkout_requests SET result = $3 WHERE customer_id = $1 AND idempotency_key = $2', [
    customerId,
    key,
    JSON.stringify(failure),
  ]);
  return failure;
}

async function loadSkus(tx: Tx, request: CheckoutInput): Promise<Map<string, SkuRow>> {
  const result = await tx.query<SkuRow>(
    `SELECT s.id, s.product_id AS "productId", p.name AS "productName", s.code, s.price_minor AS "priceMinor"
     FROM skus s JOIN products p ON p.id = s.product_id
     WHERE s.id = ANY($1::uuid[]) AND s.active AND p.status = 'ACTIVE'`,
    [request.lines.map((l) => l.skuId)],
  );
  const skus = new Map(result.rows.map((row) => [row.id, row]));
  const unknown = request.lines
    .map((line, index) => ({ line, index }))
    .filter(({ line }) => !skus.has(line.skuId))
    .map(({ index }) => ({ path: `lines.${index}.skuId`, message: 'This item is not available.' }));
  if (unknown.length > 0) throw badInput('Some items are not available.', unknown);
  return skus;
}

function stockBySku(rows: readonly BalanceRow[]): Map<string, WarehouseStock[]> {
  const bySku = new Map<string, WarehouseStock[]>();
  for (const row of rows) {
    const list = bySku.get(row.skuId) ?? [];
    list.push({ warehouseId: row.warehouseId, priority: row.priority, available: row.onHand - row.reserved });
    bySku.set(row.skuId, list);
  }
  return bySku;
}

async function createOrder(
  services: Services,
  tx: Tx,
  customerId: string,
  request: CheckoutInput,
  skus: ReadonlyMap<string, SkuRow>,
  allocations: readonly Allocation[],
  meta: RequestMeta,
): Promise<string> {
  const lines = request.lines.map((line, index) => {
    const sku = skus.get(line.skuId);
    if (!sku) throw new Error('SKU disappeared after validation.');
    return {
      lineNumber: index + 1,
      sku,
      quantity: line.quantity,
      unitPriceMinor: sku.priceMinor,
      lineTotalMinor: multiplyMinor(sku.priceMinor, line.quantity),
    };
  });
  const subtotalMinor = sumMinor(lines.map((l) => l.lineTotalMinor));
  const expiresAt = reservationExpiry(services.clock.now(), services.config.reservationTtlSeconds);

  const order = await tx.query<{ id: string }>(
    `INSERT INTO orders (customer_id, status, subtotal_minor, total_minor, reservation_expires_at)
     VALUES ($1, 'PENDING_PAYMENT', $2, $2, $3) RETURNING id`,
    [customerId, subtotalMinor, expiresAt],
  );
  const orderId = order.rows[0]?.id;
  if (!orderId) throw new Error('Order insert returned no id.');

  const insertedLines = await tx.query<{ id: string; skuId: string }>(
    `INSERT INTO order_lines (order_id, line_number, sku_id, product_name, sku_code, quantity, unit_price_minor, line_total_minor)
     SELECT $1, * FROM unnest($2::int[], $3::uuid[], $4::text[], $5::text[], $6::int[], $7::bigint[], $8::bigint[])
     RETURNING id, sku_id AS "skuId"`,
    [
      orderId,
      lines.map((l) => l.lineNumber),
      lines.map((l) => l.sku.id),
      lines.map((l) => l.sku.productName),
      lines.map((l) => l.sku.code),
      lines.map((l) => l.quantity),
      lines.map((l) => l.unitPriceMinor),
      lines.map((l) => l.lineTotalMinor),
    ],
  );
  const lineIdBySku = new Map(insertedLines.rows.map((row) => [row.skuId, row.id]));

  const reservations = await tx.query<{ id: string; skuId: string; warehouseId: string; quantity: number }>(
    `INSERT INTO reservations (order_id, order_line_id, sku_id, warehouse_id, quantity, status, expires_at)
     SELECT $1, line_id, sku_id, warehouse_id, quantity, 'ACTIVE', $2
     FROM unnest($3::uuid[], $4::uuid[], $5::uuid[], $6::int[]) AS a(line_id, sku_id, warehouse_id, quantity)
     RETURNING id, sku_id AS "skuId", warehouse_id AS "warehouseId", quantity`,
    [
      orderId,
      expiresAt,
      allocations.map((a) => lineIdBySku.get(a.skuId) ?? null),
      allocations.map((a) => a.skuId),
      allocations.map((a) => a.warehouseId),
      allocations.map((a) => a.quantity),
    ],
  );

  // The balance rows are already locked above; applyStockChanges adds the
  // conditional "reserved + n <= on_hand" update as a second guard.
  await applyStockChanges(
    tx,
    reservations.rows.map((r) => ({
      skuId: r.skuId,
      warehouseId: r.warehouseId,
      kind: 'RESERVE' as const,
      onHandDelta: 0,
      reservedDelta: r.quantity,
      referenceType: 'order' as const,
      referenceId: orderId,
    })),
  );

  const payment = await tx.query<{ id: string }>(
    `INSERT INTO payments (order_id, status, amount_minor, payment_token) VALUES ($1, 'PENDING', $2, $3) RETURNING id`,
    [orderId, subtotalMinor, request.paymentToken],
  );
  const paymentId = payment.rows[0]?.id;
  if (!paymentId) throw new Error('Payment insert returned no id.');

  const productIds = [...new Set(lines.map((l) => l.sku.productId))];
  await enqueueEvents(tx, [
    { topic: 'payment.authorize', aggregateType: 'order', aggregateId: orderId, payload: { paymentId }, correlationId: meta.correlationId },
    {
      topic: 'reservation.expire',
      aggregateType: 'order',
      aggregateId: orderId,
      payload: { orderId },
      availableAt: expiresAt,
      correlationId: meta.correlationId,
    },
    ...productIds.map((productId) => ({
      topic: 'search.product_changed' as const,
      aggregateType: 'product',
      aggregateId: productId,
      payload: { productId },
      correlationId: meta.correlationId,
    })),
  ]);
  await recordOrderChanged(tx, orderId, { status: 'PENDING_PAYMENT' }, meta.correlationId);
  return orderId;
}
