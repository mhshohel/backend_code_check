import { afterAll, afterEach, beforeAll, beforeEach, describe, expect, it } from '@jest/globals';
import { checkout } from '../../src/features/checkout/operations';
import type { Services } from '../../src/services';
import {
  balance,
  closeServices,
  createCustomers,
  createSku,
  expectLedgerReconciles,
  idempotencyKey,
  meta,
  movementCounts,
  resetData,
  scalar,
  startServices,
  WAREHOUSE_EAST,
  WAREHOUSE_WEST,
  type BaseData,
} from '../helpers/harness';

let services: Services;
let base: BaseData;

beforeAll(async () => {
  services = await startServices();
});
afterAll(async () => {
  await closeServices(services);
});
beforeEach(async () => {
  base = await resetData(services);
});
afterEach(async () => {
  await expectLedgerReconciles(services);
});

const line = (sku: { skuId: string; priceMinor: number }, quantity: number) => ({ skuId: sku.skuId, quantity, expectedUnitPriceMinor: sku.priceMinor });

describe('checkout', () => {
  it('S1: twenty concurrent customers get exactly the last five units', async () => {
    const sku = await createSku(services, base, { east: 5 });
    const customers = await createCustomers(services, 20);
    const outcomes = await Promise.all(
      customers.map((customer) =>
        checkout(services, customer, { idempotencyKey: idempotencyKey(), paymentToken: 'tok_approve', lines: [line(sku, 1)] }, meta()),
      ),
    );
    expect(outcomes.filter((o) => o.kind === 'succeeded')).toHaveLength(5);
    expect(outcomes.filter((o) => o.kind === 'insufficient_stock')).toHaveLength(15);
    expect(await balance(services, sku.skuId, WAREHOUSE_EAST)).toEqual({ onHand: 5, reserved: 5 });
    expect(await movementCounts(services, { skuId: sku.skuId })).toEqual({ RECEIPT: 1, RESERVE: 5 });
    expect(await scalar<number>(services, 'SELECT count(*)::int AS value FROM orders')).toBe(5);
  });

  it('S2: concurrent retries with one key create one order', async () => {
    const sku = await createSku(services, base, { east: 100 });
    const input = { idempotencyKey: idempotencyKey(), paymentToken: 'tok_approve', lines: [line(sku, 3)] };
    const outcomes = await Promise.all(Array.from({ length: 10 }, () => checkout(services, base.customer, input, meta())));

    const succeeded = outcomes.filter((o) => o.kind === 'succeeded');
    expect(succeeded).toHaveLength(10);
    expect(new Set(succeeded.map((o) => o.orderId)).size).toBe(1);
    expect(succeeded.filter((o) => !o.replayed)).toHaveLength(1);
    expect(await balance(services, sku.skuId, WAREHOUSE_EAST)).toEqual({ onHand: 100, reserved: 3 });
    expect(await scalar<number>(services, 'SELECT count(*)::int AS value FROM reservations')).toBe(1);

    const changed = await checkout(services, base.customer, { ...input, lines: [line(sku, 4)] }, meta());
    expect(changed).toEqual({ kind: 'idempotency_key_reused' });
  });

  it('keys are scoped per customer', async () => {
    const sku = await createSku(services, base, { east: 10 });
    const input = { idempotencyKey: idempotencyKey(), paymentToken: 'tok_approve', lines: [line(sku, 1)] };
    const first = await checkout(services, base.customer, input, meta());
    const second = await checkout(services, base.customer2, input, meta());
    expect(first.kind).toBe('succeeded');
    expect(second).toMatchObject({ kind: 'succeeded', replayed: false });
  });

  it('S6: a multi-item checkout fails atomically and lists only the short SKU', async () => {
    const a = await createSku(services, base, { east: 10 });
    const b = await createSku(services, base, { east: 1 });
    const outcome = await checkout(services, base.customer, { idempotencyKey: idempotencyKey(), paymentToken: 'tok_approve', lines: [line(a, 2), line(b, 2)] }, meta());
    expect(outcome).toEqual({ kind: 'insufficient_stock', lines: [{ skuId: b.skuId, requested: 2, available: 1 }] });
    expect(await scalar<number>(services, 'SELECT count(*)::int AS value FROM orders')).toBe(0);
    expect(await balance(services, a.skuId, WAREHOUSE_EAST)).toEqual({ onHand: 10, reserved: 0 });
    expect(await movementCounts(services, { skuId: a.skuId })).toEqual({ RECEIPT: 1 });
  });

  it('stores business failures: a retry with the same key gets the same answer', async () => {
    const sku = await createSku(services, base, { east: 1 });
    const input = { idempotencyKey: idempotencyKey(), paymentToken: 'tok_approve', lines: [line(sku, 2)] };
    const first = await checkout(services, base.customer, input, meta());
    await services.db.query('UPDATE inventory_balances SET on_hand = on_hand + 10 WHERE sku_id = $1', [sku.skuId]);
    await services.db.query(
      `INSERT INTO inventory_movements (sku_id, warehouse_id, kind, on_hand_delta, reserved_delta) VALUES ($1, $2, 'RECEIPT', 10, 0)`,
      [sku.skuId, WAREHOUSE_EAST],
    );
    const replay = await checkout(services, base.customer, input, meta());
    expect(first.kind).toBe('insufficient_stock');
    expect(replay).toEqual(first);
  });

  it('returns PriceChanged when the expected price is stale', async () => {
    const sku = await createSku(services, base, { east: 5, priceMinor: 1000 });
    const outcome = await checkout(services, base.customer, { idempotencyKey: idempotencyKey(), paymentToken: 'tok_approve', lines: [{ skuId: sku.skuId, quantity: 1, expectedUnitPriceMinor: 900 }] }, meta());
    expect(outcome).toEqual({ kind: 'price_changed', lines: [{ skuId: sku.skuId, expectedUnitPriceMinor: 900, currentUnitPriceMinor: 1000 }] });
  });

  it('splits a line across warehouses only when no single warehouse can serve it', async () => {
    const sku = await createSku(services, base, { east: 2, west: 3 });
    const outcome = await checkout(services, base.customer, { idempotencyKey: idempotencyKey(), paymentToken: 'tok_approve', lines: [line(sku, 4)] }, meta());
    expect(outcome.kind).toBe('succeeded');
    expect(await balance(services, sku.skuId, WAREHOUSE_EAST)).toEqual({ onHand: 2, reserved: 2 });
    expect(await balance(services, sku.skuId, WAREHOUSE_WEST)).toEqual({ onHand: 3, reserved: 2 });
  });

  it('writes the outbox events in the checkout transaction', async () => {
    const sku = await createSku(services, base, { east: 5 });
    const outcome = await checkout(services, base.customer, { idempotencyKey: idempotencyKey(), paymentToken: 'tok_approve', lines: [line(sku, 1)] }, meta());
    if (outcome.kind !== 'succeeded') throw new Error('expected success');
    const topics = await services.db.query<{ topic: string; aggregate_id: string }>('SELECT topic, aggregate_id FROM outbox_events ORDER BY id');
    expect(topics.rows.map((r) => r.topic).sort()).toEqual(['order.changed', 'payment.authorize', 'reservation.expire', 'search.product_changed']);
    expect(topics.rows.find((r) => r.topic === 'payment.authorize')?.aggregate_id).toBe(outcome.orderId);
  });

  it('rejects invalid input and non-customers', async () => {
    const sku = await createSku(services, base, { east: 5 });
    await expect(checkout(services, base.customer, { idempotencyKey: 'short', paymentToken: 'tok_approve', lines: [line(sku, 1)] }, meta())).rejects.toMatchObject({
      code: 'BAD_USER_INPUT',
    });
    await expect(checkout(services, base.operator, { idempotencyKey: idempotencyKey(), paymentToken: 'tok_approve', lines: [line(sku, 1)] }, meta())).rejects.toMatchObject({
      code: 'FORBIDDEN',
    });
    await expect(checkout(services, null, {}, meta())).rejects.toMatchObject({ code: 'UNAUTHENTICATED' });
  });
});
