import { afterAll, beforeAll, beforeEach, describe, expect, it } from '@jest/globals';
import { applyStockChanges, StockInvariantError } from '../../src/features/inventory/ledger';
import type { Services } from '../../src/services';
import { closeServices, createSku, expectLedgerReconciles, resetData, startServices, WAREHOUSE_EAST, type BaseData } from '../helpers/harness';

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

describe('transactions', () => {
  it('commits all statements together', async () => {
    await services.db.transaction(async (tx) => {
      await tx.query(`INSERT INTO categories (slug, name) VALUES ('a', 'A')`);
      await tx.query(`INSERT INTO categories (slug, name) VALUES ('b', 'B')`);
    });
    const count = await services.db.query<{ count: number }>(`SELECT count(*)::int AS count FROM categories WHERE slug IN ('a', 'b')`);
    expect(count.rows[0]?.count).toBe(2);
  });

  it('rolls back every statement when one fails', async () => {
    await expect(
      services.db.transaction(async (tx) => {
        await tx.query(`INSERT INTO categories (slug, name) VALUES ('c', 'C')`);
        await tx.query(`INSERT INTO categories (slug, name) VALUES ('c', 'duplicate')`);
      }),
    ).rejects.toMatchObject({ code: '23505' });
    const count = await services.db.query<{ count: number }>(`SELECT count(*)::int AS count FROM categories WHERE slug = 'c'`);
    expect(count.rows[0]?.count).toBe(0);
  });

  it('retries a transaction that hit a serialization failure', async () => {
    let attempts = 0;
    const result = await services.db.transaction(async (tx) => {
      attempts += 1;
      if (attempts === 1) {
        await tx.query(`DO $$ BEGIN RAISE EXCEPTION 'simulated' USING ERRCODE = '40001'; END $$`);
      }
      return attempts;
    });
    expect(result).toBe(2);
  });

  it('returns bigint columns as safe JavaScript numbers', async () => {
    const result = await services.db.query<{ big: number; sum: number }>(`SELECT 9007199254740991::bigint AS big, sum(x)::numeric AS sum FROM (VALUES (1), (2)) v(x)`);
    expect(result.rows[0]).toEqual({ big: 9007199254740991, sum: 3 });
    await expect(services.db.query(`SELECT 9007199254740993::bigint AS big`)).rejects.toThrow(RangeError);
  });
});

describe('inventory constraints', () => {
  it('rejects negative on-hand stock', async () => {
    const sku = await createSku(services, base, { east: 2 });
    await expect(services.db.query('UPDATE inventory_balances SET on_hand = -1 WHERE sku_id = $1', [sku.skuId])).rejects.toMatchObject({ code: '23514' });
  });

  it('rejects reserved above on-hand', async () => {
    const sku = await createSku(services, base, { east: 2 });
    await expect(services.db.query('UPDATE inventory_balances SET reserved = 3 WHERE sku_id = $1', [sku.skuId])).rejects.toMatchObject({
      code: '23514',
      constraint: 'inventory_reserved_within_on_hand',
    });
  });

  it('rejects a movement whose signs do not match its kind', async () => {
    const sku = await createSku(services, base, { east: 2 });
    await expect(
      services.db.query(
        `INSERT INTO inventory_movements (sku_id, warehouse_id, kind, on_hand_delta, reserved_delta) VALUES ($1, $2, 'SHIP', 1, 1)`,
        [sku.skuId, WAREHOUSE_EAST],
      ),
    ).rejects.toMatchObject({ constraint: 'movement_sign_pattern' });
  });

  it('rejects a second movement for the same reference, kind, SKU, and warehouse', async () => {
    const sku = await createSku(services, base, { east: 5 });
    const reference = '00000000-0000-4000-8fff-000000000001';
    const insert = () =>
      services.db.query(
        `INSERT INTO inventory_movements (sku_id, warehouse_id, kind, on_hand_delta, reserved_delta, reference_type, reference_id)
         VALUES ($1, $2, 'RETURN_RESTOCK', 1, 0, 'return', $3)`,
        [sku.skuId, WAREHOUSE_EAST, reference],
      );
    await insert();
    await expect(insert()).rejects.toMatchObject({ code: '23505', constraint: 'inventory_movements_once_per_reference' });
  });

  it('applies nothing when one change in a batch would break an invariant', async () => {
    const sku = await createSku(services, base, { east: 2 });
    await expect(
      services.db.transaction((tx) =>
        applyStockChanges(tx, [{ skuId: sku.skuId, warehouseId: WAREHOUSE_EAST, kind: 'RESERVE', onHandDelta: 0, reservedDelta: 3 }]),
      ),
    ).rejects.toBeInstanceOf(StockInvariantError);
    await expectLedgerReconciles(services);
  });
});
