import { hash } from '@node-rs/argon2';
import pg from 'pg';

export type WarehouseIds = { east: string; west: string };
export type SkuRef = { id: string; code: string; productId: string; productSlug: string; productName: string; priceMinor: number };
export type StockSpec = { east?: number; west?: number };
export type Balance = { onHand: number; reserved: number };
export type MovementKind = 'RECEIPT' | 'RESERVE' | 'RELEASE' | 'SHIP' | 'RETURN_RESTOCK' | 'ADJUSTMENT';
export type MovementRow = { kind: MovementKind; warehouseId: string; onHandDelta: number; reservedDelta: number; referenceId: string | null };
export type JobRow = { id: string; topic: string; status: string; attempts: number; lastError: string | null };
export type CustomerAccount = { email: string; password: string };

/**
 * Direct SQL for scenario setup and verification. It deliberately bypasses
 * the API: setup creates isolated catalog rows per scenario, verification
 * reads the source of truth instead of trusting the API's own answers.
 */
export class ScenarioDatabase {
  private readonly pool: pg.Pool;
  private categoryId: string | undefined;
  private sequence = 0;

  constructor(databaseUrl: string) {
    this.pool = new pg.Pool({ connectionString: databaseUrl, max: 4 });
  }

  close(): Promise<void> {
    return this.pool.end();
  }

  async query<TRow extends pg.QueryResultRow>(sql: string, params: unknown[] = []): Promise<TRow[]> {
    const result = await this.pool.query<TRow>(sql, params);
    return result.rows;
  }

  async one<TRow extends pg.QueryResultRow>(sql: string, params: unknown[] = []): Promise<TRow> {
    const [row] = await this.query<TRow>(sql, params);
    if (!row) throw new Error(`expected one row from: ${sql}`);
    return row;
  }

  async warehouseIds(): Promise<WarehouseIds> {
    const rows = await this.query<{ id: string; code: string }>(
      `SELECT id, code FROM warehouses WHERE code IN ('WH-EAST', 'WH-WEST')`,
    );
    const east = rows.find((row) => row.code === 'WH-EAST')?.id;
    const west = rows.find((row) => row.code === 'WH-WEST')?.id;
    if (!east || !west) throw new Error('contract fixture must contain WH-EAST and WH-WEST');
    return { east, west };
  }

  /** Creates a product with one SKU and the given stock, recorded as RECEIPT movements. */
  async createSku(
    label: string,
    priceMinor: number,
    stock: StockSpec,
    warehouses: WarehouseIds,
  ): Promise<SkuRef> {
    const n = ++this.sequence;
    const code = `ACC-${label}-${n}`.toUpperCase().replace(/[^A-Z0-9-]/g, '-');
    const slug = code.toLowerCase();
    const productName = `Acceptance ${label} ${n}`;
    const client = await this.pool.connect();
    try {
      await client.query('BEGIN');
      const categoryId = await this.ensureCategory(client);
      const product = await client.query<{ id: string }>(
        `INSERT INTO products (slug, name, description, category_id) VALUES ($1, $2, $3, $4) RETURNING id`,
        [slug, productName, `Acceptance test product for ${label}.`, categoryId],
      );
      const productId = product.rows[0]!.id;
      const sku = await client.query<{ id: string }>(
        `INSERT INTO skus (product_id, code, label, price_minor) VALUES ($1, $2, $3, $4) RETURNING id`,
        [productId, code, label, priceMinor],
      );
      const skuId = sku.rows[0]!.id;
      for (const [warehouseId, quantity] of [
        [warehouses.east, stock.east ?? 0],
        [warehouses.west, stock.west ?? 0],
      ] as const) {
        if (quantity <= 0) continue;
        await client.query(
          `INSERT INTO inventory_balances (sku_id, warehouse_id, on_hand, reserved) VALUES ($1, $2, $3, 0)`,
          [skuId, warehouseId, quantity],
        );
        await client.query(
          `INSERT INTO inventory_movements (sku_id, warehouse_id, kind, on_hand_delta, reserved_delta, reason)
           VALUES ($1, $2, 'RECEIPT', $3, 0, 'acceptance setup')`,
          [skuId, warehouseId, quantity],
        );
      }
      await client.query('COMMIT');
      return { id: skuId, code, productId, productSlug: slug, productName, priceMinor };
    } catch (error) {
      await client.query('ROLLBACK');
      throw error;
    } finally {
      client.release();
    }
  }

  /** Creates customer accounts that can sign in with the returned password. */
  async createCustomers(count: number, prefix: string): Promise<CustomerAccount[]> {
    const password = 'acceptance-pass-1';
    const passwordHash = await hash(password);
    const accounts = Array.from({ length: count }, (_, index) => ({
      email: `${prefix}-${String(index + 1).padStart(2, '0')}@acceptance.test`,
      password,
    }));
    for (const account of accounts) {
      await this.pool.query(
        `INSERT INTO users (email, display_name, password_hash, role) VALUES ($1, $2, $3, 'CUSTOMER')`,
        [account.email, account.email.split('@')[0], passwordHash],
      );
    }
    return accounts;
  }

  async balance(skuId: string, warehouseId: string): Promise<Balance> {
    const rows = await this.query<{ on_hand: number; reserved: number }>(
      `SELECT on_hand, reserved FROM inventory_balances WHERE sku_id = $1 AND warehouse_id = $2`,
      [skuId, warehouseId],
    );
    const row = rows[0];
    return row ? { onHand: row.on_hand, reserved: row.reserved } : { onHand: 0, reserved: 0 };
  }

  async movements(skuId: string): Promise<MovementRow[]> {
    return this.query<MovementRow>(
      `SELECT kind, warehouse_id AS "warehouseId", on_hand_delta AS "onHandDelta",
              reserved_delta AS "reservedDelta", reference_id AS "referenceId"
         FROM inventory_movements WHERE sku_id = $1 ORDER BY id`,
      [skuId],
    );
  }

  async movementCount(skuId: string, kind: MovementKind): Promise<number> {
    return (await this.movements(skuId)).filter((movement) => movement.kind === kind).length;
  }

  async countWhere(table: CountableTable, column: string, value: string): Promise<number> {
    if (!(COUNTABLE[table] as readonly string[]).includes(column)) throw new Error(`column ${column} is not countable on ${table}`);
    // Identifiers come from the fixed COUNTABLE allowlist above; values stay parameterized.
    const row = await this.one<{ count: string }>(`SELECT count(*) AS count FROM ${table} WHERE ${column} = $1`, [value]);
    return Number(row.count);
  }

  async order(orderId: string): Promise<{ status: string; cancellationReason: string | null }> {
    return this.one(
      `SELECT status, cancellation_reason AS "cancellationReason" FROM orders WHERE id = $1`,
      [orderId],
    );
  }

  async payment(orderId: string): Promise<{ id: string; status: string; amountMinor: number; refundedMinor: number }> {
    return this.one(
      `SELECT id, status, amount_minor::int AS "amountMinor", refunded_minor::int AS "refundedMinor"
         FROM payments WHERE order_id = $1`,
      [orderId],
    );
  }

  async reservationStatuses(orderId: string): Promise<string[]> {
    const rows = await this.query<{ status: string }>(`SELECT status FROM reservations WHERE order_id = $1 ORDER BY id`, [orderId]);
    return rows.map((row) => row.status);
  }

  async refundReasons(paymentId: string): Promise<string[]> {
    const rows = await this.query<{ reason: string }>(`SELECT reason FROM refunds WHERE payment_id = $1 ORDER BY created_at`, [paymentId]);
    return rows.map((row) => row.reason);
  }

  /** Highest outbox id so far. Jobs created by a step have a larger id. */
  async lastJobId(): Promise<string> {
    const row = await this.one<{ id: string }>(`SELECT coalesce(max(id), 0)::text AS id FROM outbox_events`);
    return row.id;
  }

  /**
   * Jobs of one topic that mention any of the given ids, either as the
   * aggregate or inside the payload. The suite does not depend on which id
   * server-core uses as the aggregate.
   */
  async jobs(topic: string, referencedIds: readonly string[], afterJobId = '0'): Promise<JobRow[]> {
    return this.query<JobRow>(
      `SELECT id::text AS id, topic, status, attempts, last_error AS "lastError"
         FROM outbox_events
        WHERE topic = $1 AND id > $3::bigint
          AND (aggregate_id = ANY($2::text[])
               OR EXISTS (SELECT 1 FROM unnest($2::text[]) AS ref WHERE payload::text LIKE '%' || ref || '%'))
        ORDER BY id`,
      [topic, referencedIds, afterJobId],
    );
  }

  async job(jobId: string): Promise<JobRow & { leaseExpiresAt: Date | null }> {
    return this.one(
      `SELECT id::text AS id, topic, status, attempts, last_error AS "lastError", lease_expires_at AS "leaseExpiresAt"
         FROM outbox_events WHERE id = $1::bigint`,
      [jobId],
    );
  }

  /** Simulates redelivery: a finished job becomes claimable again. */
  async makeJobClaimableAgain(jobId: string): Promise<void> {
    await this.pool.query(
      `UPDATE outbox_events SET status = 'PENDING', available_at = now(), locked_by = NULL, lease_expires_at = NULL
        WHERE id = $1::bigint`,
      [jobId],
    );
  }

  async expireLease(jobId: string): Promise<void> {
    await this.pool.query(
      `UPDATE outbox_events SET lease_expires_at = now() - interval '1 second' WHERE id = $1::bigint`,
      [jobId],
    );
  }

  /** Moves the reservation hold of an order into the past. */
  async expireHold(orderId: string): Promise<void> {
    await this.pool.query(
      `UPDATE orders SET reservation_expires_at = now() - interval '1 second' WHERE id = $1`,
      [orderId],
    );
    await this.pool.query(
      `UPDATE reservations SET expires_at = now() - interval '1 second' WHERE order_id = $1 AND status = 'ACTIVE'`,
      [orderId],
    );
  }

  /** The search document version as defined in requirements §8. */
  async productSearchVersion(productId: string): Promise<number> {
    const row = await this.one<{ version: string }>(
      `SELECT (p.version
               + (SELECT coalesce(sum(s.version), 0) FROM skus s WHERE s.product_id = p.id)
               + (SELECT coalesce(sum(b.version), 0) FROM inventory_balances b JOIN skus s ON s.id = b.sku_id
                   WHERE s.product_id = p.id))::text AS version
         FROM products p WHERE p.id = $1`,
      [productId],
    );
    return Number(row.version);
  }

  private async ensureCategory(client: pg.PoolClient): Promise<string> {
    if (this.categoryId) return this.categoryId;
    const result = await client.query<{ id: string }>(
      `INSERT INTO categories (slug, name) VALUES ('acceptance', 'Acceptance')
       ON CONFLICT (slug) DO UPDATE SET name = EXCLUDED.name RETURNING id`,
    );
    this.categoryId = result.rows[0]!.id;
    return this.categoryId;
  }
}

const COUNTABLE = {
  orders: ['customer_id'],
  order_lines: ['sku_id', 'order_id'],
  reservations: ['sku_id', 'order_id'],
  payment_events: ['payment_id'],
  shipments: ['order_id'],
  simulated_gateway_operations: ['idempotency_key'],
} as const satisfies Record<string, readonly string[]>;

export type CountableTable = keyof typeof COUNTABLE;
