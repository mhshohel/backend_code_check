import { randomUUID } from 'node:crypto';
import { createYoga } from 'graphql-yoga';
import { print, type ExecutionResult } from 'graphql';
import { createManualClock, createOffsetClock, type Clock } from '../../src/clock';
import { loadConfig, type AppConfig } from '../../src/config';
import { truncateAllData } from '../../src/db/migrate';
import { hashPassword } from '../../src/features/auth/passwords';
import { login, resolveSession, type SessionUser } from '../../src/features/auth/sessions';
import { applyStockChanges } from '../../src/features/inventory/ledger';
import { findLedgerDifferences } from '../../src/features/inventory/queries';
import { createGraphQLContext } from '../../src/graphql/context';
import type { TypedDocument } from '../../src/graphql/execute';
import { graphqlYogaPlugins } from '../../src/graphql/plugins';
import { buildGraphQLSchema } from '../../src/graphql/schema';
import { migrate } from '../../src/db/migrate';
import { createLogger } from '../../src/observability/logger';
import { closeServices, createServices, type Services } from '../../src/services';

export const TEST_DATABASE_URL = process.env.OFL_CORE_TEST_DATABASE_URL ?? 'postgresql://shohelshamim@localhost:5432/ofl_core_test';

export function testConfig(overrides: Record<string, string> = {}): AppConfig {
  return loadConfig({
    NODE_ENV: 'test',
    DATABASE_URL: TEST_DATABASE_URL,
    DB_POOL_MAX: '30',
    ELASTICSEARCH_URL: 'http://127.0.0.1:9200',
    ES_INDEX_PREFIX: 'ofl_coretest_',
    ENABLE_QUERY_COUNT: 'true',
    LOG_LEVEL: 'silent',
    PAYMENT_WEBHOOK_SECRET: 'test-webhook-secret-0123456789',
    ...overrides,
  });
}

export async function startServices(options: { clock?: Clock; config?: AppConfig } = {}): Promise<Services> {
  const config = options.config ?? testConfig();
  await migrate(config);
  return createServices(config, { role: 'api', clock: options.clock, logger: createLogger({ level: 'silent' }) });
}

export { closeServices, createManualClock, createOffsetClock };

export const WAREHOUSE_EAST = '00000000-0000-4000-8001-000000000001';
export const WAREHOUSE_WEST = '00000000-0000-4000-8001-000000000002';
export const PASSWORD = 'test-password-1';

export type TestUser = SessionUser & { password: string };
export type BaseData = { customer: TestUser; customer2: TestUser; operator: TestUser; admin: TestUser; categoryId: string };

let passwordHash: Promise<string> | null = null;

/** Empties the database and inserts warehouses, a category, and four users. */
export async function resetData(services: Services): Promise<BaseData> {
  await truncateAllData(services.db);
  passwordHash ??= hashPassword(PASSWORD);
  const hash = await passwordHash;
  await services.db.query(
    `INSERT INTO warehouses (id, code, name, priority) VALUES ($1, 'WH-EAST', 'East', 1), ($2, 'WH-WEST', 'West', 2)`,
    [WAREHOUSE_EAST, WAREHOUSE_WEST],
  );
  const users = await services.db.query<SessionUser>(
    `INSERT INTO users (email, display_name, password_hash, role)
     VALUES ('customer@test.example', 'Customer One', $1, 'CUSTOMER'), ('customer2@test.example', 'Customer Two', $1, 'CUSTOMER'),
            ('operator@test.example', 'Operator', $1, 'OPERATOR'), ('admin@test.example', 'Admin', $1, 'ADMIN')
     RETURNING id, email, display_name AS "displayName", role`,
    [hash],
  );
  const category = await services.db.query<{ id: string }>(`INSERT INTO categories (slug, name) VALUES ('gear', 'Gear') RETURNING id`);
  const [customer, customer2, operator, admin] = users.rows.map((u) => ({ ...u, password: PASSWORD }));
  if (!customer || !customer2 || !operator || !admin || !category.rows[0]) throw new Error('Base data insert failed.');
  return { customer, customer2, operator, admin, categoryId: category.rows[0].id };
}

export async function createCustomers(services: Services, count: number): Promise<TestUser[]> {
  passwordHash ??= hashPassword(PASSWORD);
  const hash = await passwordHash;
  const prefix = randomUUID().slice(0, 8);
  const result = await services.db.query<SessionUser>(
    `INSERT INTO users (email, display_name, password_hash, role)
     SELECT $1 || '-' || i || '@test.example', 'Customer ' || i, $2, 'CUSTOMER' FROM generate_series(1, $3::int) AS i
     RETURNING id, email, display_name AS "displayName", role`,
    [prefix, hash, count],
  );
  return result.rows.map((u) => ({ ...u, password: PASSWORD }));
}

export type TestSku = { productId: string; skuId: string; code: string; priceMinor: number; slug: string };

let skuCounter = 0;

/** A product with one SKU, stocked through RECEIPT movements so the ledger reconciles. */
export async function createSku(
  services: Services,
  base: Pick<BaseData, 'categoryId'>,
  options: { priceMinor?: number; east?: number; west?: number; name?: string } = {},
): Promise<TestSku> {
  skuCounter += 1;
  const code = `T-${Date.now().toString(36)}-${skuCounter}`.toUpperCase();
  const slug = code.toLowerCase();
  const priceMinor = options.priceMinor ?? 1000;
  return services.db.transaction(async (tx) => {
    const product = await tx.query<{ id: string }>(
      `INSERT INTO products (slug, name, description, category_id) VALUES ($1, $2, 'Test product', $3) RETURNING id`,
      [slug, options.name ?? `Test Product ${skuCounter}`, base.categoryId],
    );
    const productId = product.rows[0]?.id ?? '';
    const sku = await tx.query<{ id: string }>(
      `INSERT INTO skus (product_id, code, label, price_minor) VALUES ($1, $2, 'Standard', $3) RETURNING id`,
      [productId, code, priceMinor],
    );
    const skuId = sku.rows[0]?.id ?? '';
    const stock = [
      { warehouseId: WAREHOUSE_EAST, quantity: options.east ?? 0 },
      { warehouseId: WAREHOUSE_WEST, quantity: options.west ?? 0 },
    ].filter((s) => s.quantity > 0);
    for (const s of stock) {
      await tx.query('INSERT INTO inventory_balances (sku_id, warehouse_id, on_hand, reserved) VALUES ($1, $2, 0, 0)', [skuId, s.warehouseId]);
    }
    await applyStockChanges(
      tx,
      stock.map((s) => ({ skuId, warehouseId: s.warehouseId, kind: 'RECEIPT' as const, onHandDelta: s.quantity, reservedDelta: 0, reason: 'test' })),
    );
    return { productId, skuId, code, priceMinor, slug };
  });
}

export function meta(): { correlationId: string } {
  return { correlationId: `test-${randomUUID()}` };
}

export async function balance(services: Services, skuId: string, warehouseId: string): Promise<{ onHand: number; reserved: number }> {
  const result = await services.db.query<{ onHand: number; reserved: number }>(
    'SELECT on_hand AS "onHand", reserved FROM inventory_balances WHERE sku_id = $1 AND warehouse_id = $2',
    [skuId, warehouseId],
  );
  return result.rows[0] ?? { onHand: 0, reserved: 0 };
}

export async function movementCounts(services: Services, filter: { referenceId?: string; skuId?: string }): Promise<Record<string, number>> {
  const result = await services.db.query<{ kind: string; count: number }>(
    `SELECT kind, count(*)::int AS count FROM inventory_movements
     WHERE ($1::uuid IS NULL OR reference_id = $1) AND ($2::uuid IS NULL OR sku_id = $2) GROUP BY kind`,
    [filter.referenceId ?? null, filter.skuId ?? null],
  );
  return Object.fromEntries(result.rows.map((r) => [r.kind, r.count]));
}

export async function expectLedgerReconciles(services: Services): Promise<void> {
  const differences = await findLedgerDifferences(services.db);
  if (differences.length > 0) throw new Error(`Ledger differences: ${JSON.stringify(differences)}`);
}

export async function scalar<T>(services: Services, sql: string, params: unknown[] = []): Promise<T> {
  const result = await services.db.query<{ value: T }>(sql, params);
  const row = result.rows[0];
  if (!row) throw new Error(`No row for ${sql}`);
  return row.value;
}

/** Bounded polling for asynchronous effects. Never a fixed sleep. */
export async function pollUntil<T>(probe: () => Promise<T | null | undefined | false>, options: { timeoutMs?: number; intervalMs?: number } = {}): Promise<T> {
  const deadline = Date.now() + (options.timeoutMs ?? 10_000);
  for (;;) {
    const value = await probe();
    if (value) return value;
    if (Date.now() > deadline) throw new Error('pollUntil timed out.');
    await new Promise((resolve) => setTimeout(resolve, options.intervalMs ?? 50));
  }
}

/** In-process Yoga server with the production plugins, driven over fetch semantics. */
export function createTestYoga(services: Services) {
  const schema = buildGraphQLSchema(services);
  const yoga = createYoga({
    schema,
    plugins: graphqlYogaPlugins(services),
    maskedErrors: false,
    logging: false,
    context: async ({ request }) => {
      const token = /ofl_session=([^;]+)/.exec(request.headers.get('cookie') ?? '')?.[1];
      const viewer = await resolveSession(services, token);
      return createGraphQLContext(services, viewer, meta());
    },
  });

  async function request<TResult, TVariables>(
    document: TypedDocument<TResult, TVariables> | string,
    variables: TVariables,
    options: { token?: string; headers?: Record<string, string> } = {},
  ): Promise<ExecutionResult<TResult> & { extensions?: Record<string, unknown> }> {
    const response = await yoga.fetch('http://test.local/graphql', {
      method: 'POST',
      headers: {
        'content-type': 'application/json',
        ...(options.token ? { cookie: `ofl_session=${options.token}` } : {}),
        ...options.headers,
      },
      body: JSON.stringify({ query: typeof document === 'string' ? document : print(document), variables }),
    });
    return (await response.json()) as ExecutionResult<TResult> & { extensions?: Record<string, unknown> };
  }
  return { yoga, request };
}

export async function tokenFor(services: Services, user: TestUser): Promise<string> {
  const result = await login(services, { email: user.email, password: user.password }, meta());
  if (result.kind !== 'ok') throw new Error(`Login failed for ${user.email}`);
  return result.token;
}

export function idempotencyKey(): string {
  return `key-${randomUUID()}`;
}
