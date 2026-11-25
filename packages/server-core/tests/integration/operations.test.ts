import { afterAll, beforeAll, beforeEach, describe, expect, it } from '@jest/globals';
import { AuditLogDocument, InventoryDocument, InventoryMovementsDocument, JobsDocument, OperationsSummaryDocument } from '@ofl/graphql-types';
import { login, logout, resolveSession } from '../../src/features/auth/sessions';
import { adjustInventory } from '../../src/features/inventory/operations';
import { reconcileLedger } from '../../src/features/operations/maintenance';
import { executeOperation } from '../../src/graphql/execute';
import { checkLiveness, checkReadiness } from '../../src/health';
import type { Services } from '../../src/services';
import {
  balance,
  closeServices,
  createSku,
  expectLedgerReconciles,
  meta,
  PASSWORD,
  resetData,
  scalar,
  startServices,
  testConfig,
  WAREHOUSE_EAST,
  WAREHOUSE_WEST,
  type BaseData,
} from '../helpers/harness';
import { authorize, placeOrder } from '../helpers/orders';

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

describe('authentication', () => {
  it('logs in, resolves the session, and revokes it on logout', async () => {
    const result = await login(services, { email: base.customer.email.toUpperCase(), password: PASSWORD }, meta());
    if (result.kind !== 'ok') throw new Error('login failed');
    expect(result.token).toMatch(/^[A-Za-z0-9_-]{43}$/);
    expect(await resolveSession(services, result.token)).toMatchObject({ id: base.customer.id, role: 'CUSTOMER' });
    await logout(services, result.token);
    expect(await resolveSession(services, result.token)).toBeNull();
  });

  it('rejects wrong passwords, unknown accounts, malformed tokens, and expired sessions', async () => {
    expect(await login(services, { email: base.customer.email, password: 'wrong-password' }, meta())).toEqual({ kind: 'invalid' });
    expect(await login(services, { email: 'nobody@test.example', password: PASSWORD }, meta())).toEqual({ kind: 'invalid' });
    await expect(login(services, { email: 'not-an-email', password: '' }, meta())).rejects.toMatchObject({ code: 'BAD_USER_INPUT' });
    expect(await resolveSession(services, 'garbage')).toBeNull();
    const ok = await login(services, { email: base.customer.email, password: PASSWORD }, meta());
    if (ok.kind !== 'ok') throw new Error('login failed');
    await services.db.query(`UPDATE sessions SET expires_at = now() - interval '1 second'`);
    expect(await resolveSession(services, ok.token)).toBeNull();
    expect(await scalar<string>(services, 'SELECT encode(token_hash, $1) AS value FROM sessions LIMIT 1', ['hex'])).not.toContain(ok.token);
  });
});

describe('inventory operations', () => {
  it('receipts add stock; adjustments cannot go below reserved; both are audited', async () => {
    const sku = await createSku(services, base, { east: 5 });
    await placeOrder(services, base.customer, [{ sku, quantity: 3 }]);
    const receipt = await adjustInventory(services, base.operator, { skuId: sku.skuId, warehouseId: WAREHOUSE_WEST, kind: 'RECEIPT', quantityDelta: 7, reason: 'New delivery' }, meta());
    expect(receipt).toMatchObject({ kind: 'adjusted', balance: { onHand: 7, reserved: 0 }, movement: { kind: 'RECEIPT', onHandDelta: 7 } });

    const rejected = await adjustInventory(services, base.operator, { skuId: sku.skuId, warehouseId: WAREHOUSE_EAST, kind: 'ADJUSTMENT', quantityDelta: -3, reason: 'Damaged' }, meta());
    expect(rejected).toEqual({ kind: 'rejected', onHand: 5, reserved: 3 });
    const shrink = await adjustInventory(services, base.operator, { skuId: sku.skuId, warehouseId: WAREHOUSE_EAST, kind: 'ADJUSTMENT', quantityDelta: -2, reason: 'Damaged' }, meta());
    expect(shrink.kind).toBe('adjusted');
    expect(await balance(services, sku.skuId, WAREHOUSE_EAST)).toEqual({ onHand: 3, reserved: 3 });
    expect(await scalar<number>(services, `SELECT count(*)::int AS value FROM audit_log WHERE action LIKE 'inventory.%'`)).toBe(2);
    await expect(
      adjustInventory(services, base.operator, { skuId: sku.skuId, warehouseId: WAREHOUSE_EAST, kind: 'RECEIPT', quantityDelta: -1, reason: 'Bad receipt' }, meta()),
    ).rejects.toMatchObject({ code: 'BAD_USER_INPUT' });
    await expectLedgerReconciles(services);
  });

  it('reconcileLedger reports a balance that drifted from its movements', async () => {
    const sku = await createSku(services, base, { east: 5 });
    expect(await reconcileLedger(services)).toEqual({ differences: [] });
    await services.db.query('UPDATE inventory_balances SET on_hand = 6 WHERE sku_id = $1', [sku.skuId]);
    expect(await reconcileLedger(services)).toEqual({
      differences: [{ skuId: sku.skuId, warehouseId: WAREHOUSE_EAST, field: 'on_hand', balance: 6, ledger: 5 }],
    });
  });
});

describe('admin queries', () => {
  it('lists inventory, movements, summary, jobs, and audit entries', async () => {
    const sku = await createSku(services, base, { east: 2, west: 10 });
    const order = await placeOrder(services, base.customer, [{ sku, quantity: 1 }]);
    await authorize(services, order);
    await services.db.query(`INSERT INTO outbox_events (topic, aggregate_type, aggregate_id, status, last_error) VALUES ('x', 'y', 'z', 'FAILED', 'boom')`);
    await adjustInventory(services, base.admin, { skuId: sku.skuId, warehouseId: WAREHOUSE_EAST, kind: 'RECEIPT', quantityDelta: 1, reason: 'Count' }, meta());

    const inventory = await executeOperation(services, base.operator, meta(), InventoryDocument, { lowStockOnly: true });
    expect(inventory.inventory.edges.map((e) => [e.node.warehouse.code, e.node.available])).toEqual([['WH-EAST', 2]]);
    const movements = await executeOperation(services, base.operator, meta(), InventoryMovementsDocument, { skuId: sku.skuId, first: 2 });
    expect(movements.inventoryMovements.edges.map((e) => e.node.kind)).toEqual(['RECEIPT', 'RESERVE']);
    expect(movements.inventoryMovements.pageInfo.hasNextPage).toBe(true);

    const summary = await executeOperation(services, base.admin, meta(), OperationsSummaryDocument, { days: 3, threshold: 5 });
    expect(summary.operationsSummary.ordersByStatus.find((s) => s.status === 'CONFIRMED')?.count).toBe(1);
    expect(summary.operationsSummary.dailyRevenue).toHaveLength(3);
    expect(summary.operationsSummary.dailyRevenue.at(-1)?.cumulativeRevenue.amountMinor).toBe(order.amountMinor);
    expect(summary.operationsSummary.failedJobs).toBe(1);
    expect(summary.operationsSummary.lowStock.map((l) => l.warehouse.code)).toEqual(['WH-EAST']);

    const jobs = await executeOperation(services, base.admin, meta(), JobsDocument, {});
    expect(jobs.jobs.edges.map((e) => e.node.lastError)).toEqual(['boom']);
    const audit = await executeOperation(services, base.admin, meta(), AuditLogDocument, {});
    expect(audit.auditLog.edges[0]?.node).toMatchObject({ action: 'inventory.received', actor: { id: base.admin.id } });
    expect(JSON.parse(audit.auditLog.edges[0]?.node.details ?? '{}')).toMatchObject({ quantityDelta: 1 });
    await expect(executeOperation(services, base.customer, meta(), JobsDocument, {})).rejects.toMatchObject({ code: 'FORBIDDEN' });
  });
});

describe('health and metrics', () => {
  it('reports liveness, readiness, and Prometheus metrics', async () => {
    expect(checkLiveness()).toEqual({ ok: true });
    const ready = await checkReadiness(services);
    expect(ready.ok).toBe(true);
    expect(ready.checks.postgres.ok).toBe(true);
    expect(ready.checks.elasticsearch.ok).toBe(true);
    services.metrics.observeHttp({ method: 'GET', route: '/health', status: 200, durationMs: 3 });
    const text = await services.metrics.render();
    expect(text).toContain('ofl_http_request_duration_seconds_bucket');
    expect(text).toContain('ofl_outbox_backlog');
  });

  it('stays ready without Elasticsearch, but reports it', async () => {
    const down = await startServices({ config: testConfig({ ELASTICSEARCH_URL: 'http://127.0.0.1:9' }) });
    try {
      const ready = await checkReadiness(down);
      expect(ready.ok).toBe(true);
      expect(ready.checks.elasticsearch).toMatchObject({ ok: false, error: 'unreachable' });
      expect(JSON.stringify(ready)).not.toContain('127.0.0.1');
    } finally {
      await closeServices(down);
    }
  });
});
