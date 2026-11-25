import { afterAll, beforeAll, describe, expect, it } from '@jest/globals';
import pg from 'pg';
import { loadConfig, type AppConfig } from '@ofl/server-core';
import { CONTRACT_FIXTURE, createCustomers, DEMO_ACCOUNTS, fixtureId, resetToFixture, seededRandom, WAREHOUSES } from '../src/index';

const config: AppConfig = loadConfig({
  NODE_ENV: 'test',
  DATABASE_URL: process.env.OFL_CORE_TEST_DATABASE_URL ?? 'postgresql://shohelshamim@localhost:5432/ofl_core_test',
  ES_INDEX_PREFIX: 'ofl_coretest_',
  LOG_LEVEL: 'silent',
});

let client: pg.Client;

beforeAll(async () => {
  client = new pg.Client({ connectionString: config.databaseUrl });
  await client.connect();
});
afterAll(async () => {
  await client.end();
});

async function count(sql: string): Promise<number> {
  const result = await client.query<{ n: string }>(`SELECT (${sql})::text AS n`);
  return Number(result.rows[0]?.n ?? -1);
}

async function ledgerDifferences(): Promise<number> {
  return count(`SELECT count(*) FROM inventory_balances b
    LEFT JOIN (SELECT sku_id, warehouse_id, sum(on_hand_delta) oh, sum(reserved_delta) r FROM inventory_movements GROUP BY 1, 2) m
      ON m.sku_id = b.sku_id AND m.warehouse_id = b.warehouse_id
    WHERE b.on_hand <> COALESCE(m.oh, 0) OR b.reserved <> COALESCE(m.r, 0)`);
}

describe('fixture helpers', () => {
  it('builds deterministic ids and random sequences', () => {
    expect(fixtureId(1, 1)).toBe('00000000-0000-4000-8001-000000000001');
    expect(() => fixtureId(5000, 1)).toThrow(RangeError);
    const a = seededRandom(7);
    const b = seededRandom(7);
    expect([a(), a(), a()]).toEqual([b(), b(), b()]);
  });
});

describe('resetToFixture', () => {
  it('loads the contract profile: warehouses, demo accounts, LAST-5 in WH-EAST only', async () => {
    await resetToFixture(config, 'contract');
    expect(await count('SELECT count(*) FROM warehouses')).toBe(2);
    expect(await count(`SELECT count(*) FROM users WHERE email IN ('customer@example.com', 'customer2@example.com', 'operator@example.com', 'admin@example.com')`)).toBe(4);
    const last5 = await client.query<{ warehouse_id: string; on_hand: number; reserved: number }>(
      'SELECT warehouse_id, on_hand, reserved FROM inventory_balances WHERE sku_id = $1',
      [CONTRACT_FIXTURE.lastFive.skuId],
    );
    expect(last5.rows).toEqual([{ warehouse_id: WAREHOUSES.east.id, on_hand: 5, reserved: 0 }]);
    expect(await ledgerDifferences()).toBe(0);

    const customers = await createCustomers(client, 20, { prefix: 'fixture-test' });
    expect(customers).toHaveLength(20);
    expect(new Set(customers.map((c) => c.email)).size).toBe(20);
  });

  it('loads the demo profile with consistent history', async () => {
    await resetToFixture(config, 'demo');
    expect(await count('SELECT count(*) FROM categories')).toBe(8);
    expect(await count('SELECT count(*) FROM products')).toBe(60);
    expect(await count(`SELECT count(DISTINCT status) FROM orders`)).toBeGreaterThanOrEqual(4);
    expect(await count(`SELECT count(*) FROM returns WHERE status = 'REFUNDED'`)).toBeGreaterThan(0);
    expect(await ledgerDifferences()).toBe(0);
    // Payments agree with refunds.
    expect(await count(`SELECT count(*) FROM payments p WHERE p.refunded_minor <> COALESCE((SELECT sum(amount_minor) FROM refunds r WHERE r.payment_id = p.id), 0)`)).toBe(0);
    expect(await count(`SELECT count(*) FROM users WHERE id = '${DEMO_ACCOUNTS.admin.id}' AND role = 'ADMIN'`)).toBe(1);
  });

  it('loads a small bench profile that reconciles', async () => {
    await resetToFixture(config, 'bench', { bench: { products: 200, orders: 2000, customers: 20 } });
    expect(await count(`SELECT count(*) FROM orders WHERE id::text LIKE '00000000-0000-4000-81%'`)).toBe(2000);
    expect(await count(`SELECT count(*) FROM order_lines`)).toBeGreaterThanOrEqual(4000);
    expect(await ledgerDifferences()).toBe(0);
    expect(await count(`SELECT count(*) FROM orders o WHERE o.total_minor <> (SELECT sum(line_total_minor) FROM order_lines l WHERE l.order_id = o.id)`)).toBe(0);
  });

  it('refuses databases not named ofl_*', async () => {
    await expect(resetToFixture({ ...config, databaseUrl: 'postgresql://x@localhost/postgres' }, 'contract')).rejects.toThrow(/ofl_/);
  });
});
