import { afterAll, afterEach, beforeAll, beforeEach, describe, expect, it } from '@jest/globals';
import { shipOrder } from '../../src/features/fulfillment/operations';
import { receiveReturn, requestReturn } from '../../src/features/returns/operations';
import type { Services } from '../../src/services';
import { runWorkerUntilIdle } from '../../src/worker/worker';
import {
  balance,
  closeServices,
  createSku,
  expectLedgerReconciles,
  meta,
  movementCounts,
  resetData,
  scalar,
  startServices,
  WAREHOUSE_EAST,
  WAREHOUSE_WEST,
  type BaseData,
} from '../helpers/harness';
import { authorize, orderState, placeOrder } from '../helpers/orders';

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

describe('shipping', () => {
  it('S9: one order ships from two warehouses; a repeated ship returns NothingToShip', async () => {
    const sku = await createSku(services, base, { east: 2, west: 3 });
    const order = await placeOrder(services, base.customer, [{ sku, quantity: 4 }]);
    await authorize(services, order);

    const first = await shipOrder(services, base.operator, { orderId: order.orderId, warehouseId: WAREHOUSE_EAST }, meta());
    expect(first.kind).toBe('shipped');
    expect((await orderState(services, order.orderId)).status).toBe('PARTIALLY_SHIPPED');
    const second = await shipOrder(services, base.operator, { orderId: order.orderId, warehouseId: WAREHOUSE_WEST, trackingCode: 'TRACK-WEST' }, meta());
    expect(second.kind).toBe('shipped');
    expect((await orderState(services, order.orderId)).status).toBe('SHIPPED');

    expect(await shipOrder(services, base.operator, { orderId: order.orderId, warehouseId: WAREHOUSE_EAST }, meta())).toEqual({ kind: 'not_shippable', status: 'SHIPPED' });
    expect(await scalar<number>(services, 'SELECT count(*)::int AS value FROM shipments')).toBe(2);
    expect(await balance(services, sku.skuId, WAREHOUSE_EAST)).toEqual({ onHand: 0, reserved: 0 });
    expect(await balance(services, sku.skuId, WAREHOUSE_WEST)).toEqual({ onHand: 1, reserved: 0 });
    const ships = await services.db.query<{ warehouse: string; delta: number }>(
      `SELECT warehouse_id AS warehouse, on_hand_delta AS delta FROM inventory_movements WHERE kind = 'SHIP' ORDER BY warehouse_id`,
    );
    expect(ships.rows).toEqual([
      { warehouse: WAREHOUSE_EAST, delta: -2 },
      { warehouse: WAREHOUSE_WEST, delta: -2 },
    ]);
  });

  it('a repeated ship from a warehouse with nothing left returns NothingToShip; concurrent ships ship once', async () => {
    const a = await createSku(services, base, { east: 5 });
    const b = await createSku(services, base, { west: 5 });
    const order = await placeOrder(services, base.customer, [{ sku: a, quantity: 1 }, { sku: b, quantity: 1 }]);
    await authorize(services, order);
    const results = await Promise.all([1, 2, 3].map(() => shipOrder(services, base.operator, { orderId: order.orderId, warehouseId: WAREHOUSE_EAST }, meta())));
    expect(results.filter((r) => r.kind === 'shipped')).toHaveLength(1);
    expect(results.filter((r) => r.kind === 'nothing_to_ship')).toHaveLength(2);
    expect(await movementCounts(services, { skuId: a.skuId })).toEqual({ RECEIPT: 1, RESERVE: 1, SHIP: 1 });
  });

  it('cannot ship an unpaid order; customers cannot ship', async () => {
    const sku = await createSku(services, base, { east: 5 });
    const order = await placeOrder(services, base.customer, [{ sku, quantity: 1 }]);
    expect(await shipOrder(services, base.operator, { orderId: order.orderId, warehouseId: WAREHOUSE_EAST }, meta())).toEqual({
      kind: 'not_shippable',
      status: 'PENDING_PAYMENT',
    });
    await expect(shipOrder(services, base.customer, { orderId: order.orderId, warehouseId: WAREHOUSE_EAST }, meta())).rejects.toMatchObject({ code: 'FORBIDDEN' });
  });
});

describe('returns', () => {
  async function shippedOrder(quantity: number) {
    const sku = await createSku(services, base, { east: 10, priceMinor: 1500 });
    const order = await placeOrder(services, base.customer, [{ sku, quantity }]);
    await authorize(services, order);
    await shipOrder(services, base.operator, { orderId: order.orderId, warehouseId: WAREHOUSE_EAST }, meta());
    const lineId = await scalar<string>(services, 'SELECT id AS value FROM order_lines WHERE order_id = $1', [order.orderId]);
    return { sku, order, lineId };
  }

  it('S10: a partial return restocks once and refunds once', async () => {
    const { sku, order, lineId } = await shippedOrder(3);
    const requested = await requestReturn(services, base.customer, { orderId: order.orderId, reason: 'Too big', lines: [{ orderLineId: lineId, quantity: 2 }] }, meta());
    if (requested.kind !== 'requested') throw new Error('expected requested');

    expect((await receiveReturn(services, base.operator, requested.returnId, meta())).kind).toBe('received');
    expect(await receiveReturn(services, base.operator, requested.returnId, meta())).toEqual({ kind: 'not_receivable', status: 'RECEIVED' });
    const concurrent = await Promise.all([1, 2].map(() => receiveReturn(services, base.operator, requested.returnId, meta())));
    expect(concurrent.every((r) => r.kind === 'not_receivable')).toBe(true);

    await runWorkerUntilIdle(services);
    expect(await movementCounts(services, { referenceId: requested.returnId })).toEqual({ RETURN_RESTOCK: 1 });
    expect(await balance(services, sku.skuId, WAREHOUSE_EAST)).toEqual({ onHand: 9, reserved: 0 });
    expect(await orderState(services, order.orderId)).toMatchObject({ payment: 'PARTIALLY_REFUNDED' });
    expect(await scalar<number>(services, 'SELECT refunded_minor AS value FROM payments WHERE order_id = $1', [order.orderId])).toBe(3000);
    expect(await scalar<string>(services, 'SELECT status AS value FROM returns WHERE id = $1', [requested.returnId])).toBe('REFUNDED');

    const excess = await requestReturn(services, base.customer, { orderId: order.orderId, reason: 'More', lines: [{ orderLineId: lineId, quantity: 2 }] }, meta());
    expect(excess).toEqual({ kind: 'quantity_exceeded', lines: [{ orderLineId: lineId, requested: 2, returnable: 1 }] });
  });

  it('concurrent return requests cannot exceed the shipped quantity', async () => {
    const { order, lineId } = await shippedOrder(3);
    const results = await Promise.all(
      [1, 2, 3].map(() => requestReturn(services, base.customer, { orderId: order.orderId, reason: 'Again', lines: [{ orderLineId: lineId, quantity: 2 }] }, meta())),
    );
    expect(results.filter((r) => r.kind === 'requested')).toHaveLength(1);
    expect(results.filter((r) => r.kind === 'quantity_exceeded')).toHaveLength(2);
  });

  it('returns need a shipped order owned by the customer', async () => {
    const sku = await createSku(services, base, { east: 5 });
    const order = await placeOrder(services, base.customer, [{ sku, quantity: 1 }]);
    const lineId = await scalar<string>(services, 'SELECT id AS value FROM order_lines WHERE order_id = $1', [order.orderId]);
    const input = { orderId: order.orderId, reason: 'Nope', lines: [{ orderLineId: lineId, quantity: 1 }] };
    expect(await requestReturn(services, base.customer, input, meta())).toEqual({ kind: 'not_returnable', status: 'PENDING_PAYMENT' });
    await expect(requestReturn(services, base.customer2, input, meta())).rejects.toMatchObject({ code: 'NOT_FOUND' });
    await expect(receiveReturn(services, base.customer, '00000000-0000-4000-8000-000000000001', meta())).rejects.toMatchObject({ code: 'FORBIDDEN' });
  });
});
