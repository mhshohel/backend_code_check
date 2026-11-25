import { hashPassword, type Queryable } from '@ofl/server-core';
import { WAREHOUSES } from '../accounts';
import { NS } from '../ids';
import { DEMO_CATALOG } from './demo-catalog';

export type BenchOptions = {
  /** Number of products (one SKU each). Default 20 000. */
  products: number;
  /** Number of historical orders. Default 10 x products. */
  orders: number;
  /** Number of extra customer accounts. Default 1000. */
  customers: number;
};

export function benchOptions(size: number | undefined, env: Record<string, string | undefined> = process.env): BenchOptions {
  const products = size ?? Number(env.BENCH_PRODUCTS ?? 20_000);
  const orders = Number(env.BENCH_ORDERS ?? products * 10);
  const customers = Number(env.BENCH_CUSTOMERS ?? 1000);
  for (const [name, value] of Object.entries({ products, orders, customers })) {
    if (!Number.isInteger(value) || value < 1 || value > 5_000_000) throw new Error(`Bench ${name} must be an integer between 1 and 5000000.`);
  }
  return { products, orders, customers };
}

// Bench ids reuse the fixture UUID layout with namespaces 0x100+, built in SQL.
const id = (namespace: number, expression: string) =>
  `('00000000-0000-4000-8' || lpad(to_hex(${0x100 + namespace}), 3, '0') || '-' || lpad(to_hex(${expression}), 12, '0'))::uuid`;

/**
 * Loads a large data set with set-based SQL (generate_series), so 20k
 * products and 200k orders load in tens of seconds. The demo accounts,
 * warehouses, and categories must already exist (the demo profile runs first).
 * Every order line reserves and ships (or releases) through movements, so
 * the ledger reconciles.
 */
export async function loadBenchData(db: Queryable, options: BenchOptions): Promise<void> {
  const passwordHash = await hashPassword('bench-pass-1');
  const east = WAREHOUSES.east.id;
  const categoryCount = DEMO_CATALOG.length;
  await db.query('SET LOCAL synchronous_commit = off');
  await skipForeignKeyChecksIfAllowed(db);

  await db.query(
    `INSERT INTO users (id, email, display_name, password_hash, role)
     SELECT ${id(NS.user, 'i')}, 'bench' || i || '@example.com', 'Bench Customer ' || i, $1, 'CUSTOMER'
     FROM generate_series(1, $2::int) AS i`,
    [passwordHash, options.customers],
  );

  await db.query(
    `WITH cats AS (SELECT id, row_number() OVER (ORDER BY slug) - 1 AS n FROM categories)
     INSERT INTO products (id, slug, name, description, category_id, created_at)
     SELECT ${id(NS.product, 'i')}, 'bench-product-' || i,
            (ARRAY['Compact','Wireless','Premium','Classic','Smart','Portable','Ultra','Eco','Pro','Mini'])[1 + i % 10] || ' ' ||
            (ARRAY['Speaker','Lamp','Backpack','Keyboard','Kettle','Chair','Tent','Mat','Monitor','Puzzle','Notebook','Drone'])[1 + (i / 10) % 12] ||
            ' ' || i,
            'Benchmark product number ' || i || '.',
            cats.id, now() - (i % 365) * interval '1 day'
     FROM generate_series(1, $1::int) AS i JOIN cats ON cats.n = i % $2`,
    [options.products, categoryCount],
  );
  await db.query(
    `INSERT INTO skus (id, product_id, code, label, price_minor)
     SELECT ${id(NS.sku, 'i')}, ${id(NS.product, 'i')}, 'BEN-' || i, 'Standard', 500 + (i * 37) % 50000
     FROM generate_series(1, $1::int) AS i`,
    [options.products],
  );
  // Orders: 75% SHIPPED, 15% CANCELLED, 10% CONFIRMED. Two lines each, from WH-EAST.
  await db.query(
    `CREATE TEMP TABLE bench_lines ON COMMIT DROP AS
     SELECT o AS order_n, l AS line_n,
            CASE WHEN l = 1 THEN 1 + (o * 7) % $1 ELSE 1 + ((o * 7) % $1 + 1 + (o * 13) % ($1 - 1)) % $1 END AS sku_n,
            1 + o % 2 AS quantity,
            CASE WHEN o % 20 < 15 THEN 'SHIPPED' WHEN o % 20 < 18 THEN 'CANCELLED' ELSE 'CONFIRMED' END AS status,
            now() - (o % 365) * interval '1 day' - (o % 1440) * interval '1 minute' AS created_at
     FROM generate_series(1, $2::int) AS o CROSS JOIN generate_series(1, 2) AS l`,
    [Math.max(2, options.products), options.orders],
  );
  // Opening stock covers every unit the generated orders reserve from
  // WH-EAST, plus a buffer: 1000 units, or 3 for every 50th SKU so that
  // low-stock views have something to show. WH-WEST gets the buffer only.
  await db.query(
    `INSERT INTO inventory_movements (sku_id, warehouse_id, kind, on_hand_delta, reserved_delta, reason, created_at)
     SELECT ${id(NS.sku, 's.i')}, w.id, 'RECEIPT',
            CASE WHEN s.i % 50 = 0 THEN 3 ELSE 1000 END + CASE WHEN w.id = $2::uuid THEN COALESCE(used.quantity, 0) ELSE 0 END,
            0, 'Bench opening stock', now() - interval '400 days'
     FROM generate_series(1, $1::int) AS s(i)
     CROSS JOIN warehouses w
     LEFT JOIN (SELECT sku_n, sum(quantity)::int AS quantity FROM bench_lines GROUP BY sku_n) used ON used.sku_n = s.i`,
    [options.products, east],
  );
  await db.query(
    `INSERT INTO orders (id, customer_id, status, cancellation_reason, subtotal_minor, total_minor, reservation_expires_at, created_at, updated_at)
     SELECT ${id(NS.order, 'b.order_n')}, ${id(NS.user, '1 + b.order_n % $1')}, b.status,
            CASE WHEN b.status = 'CANCELLED' THEN 'CUSTOMER_REQUEST' END,
            sum((500 + (b.sku_n * 37) % 50000) * b.quantity), sum((500 + (b.sku_n * 37) % 50000) * b.quantity),
            min(b.created_at) + interval '15 minutes', min(b.created_at), min(b.created_at) + interval '1 hour'
     FROM bench_lines b GROUP BY b.order_n, b.status`,
    [options.customers],
  );
  await db.query(
    `INSERT INTO order_lines (id, order_id, line_number, sku_id, product_name, sku_code, quantity, unit_price_minor, line_total_minor)
     SELECT ${id(NS.orderLine, 'b.order_n * 2 + b.line_n')}, ${id(NS.order, 'b.order_n')}, b.line_n, ${id(NS.sku, 'b.sku_n')},
            'Bench product ' || b.sku_n, 'BEN-' || b.sku_n, b.quantity, 500 + (b.sku_n * 37) % 50000, (500 + (b.sku_n * 37) % 50000) * b.quantity
     FROM bench_lines b`,
  );
  await db.query(
    `INSERT INTO reservations (id, order_id, order_line_id, sku_id, warehouse_id, quantity, status, expires_at, created_at, updated_at)
     SELECT ${id(NS.reservation, 'b.order_n * 2 + b.line_n')}, ${id(NS.order, 'b.order_n')}, ${id(NS.orderLine, 'b.order_n * 2 + b.line_n')},
            ${id(NS.sku, 'b.sku_n')}, $1::uuid, b.quantity,
            CASE b.status WHEN 'SHIPPED' THEN 'SHIPPED' WHEN 'CANCELLED' THEN 'RELEASED' ELSE 'CONFIRMED' END,
            b.created_at + interval '15 minutes', b.created_at, b.created_at
     FROM bench_lines b`,
    [east],
  );
  await db.query(
    `INSERT INTO payments (id, order_id, status, amount_minor, refunded_minor, payment_token, created_at, updated_at)
     SELECT ${id(NS.payment, 'g.order_n')}, ${id(NS.order, 'g.order_n')},
            CASE WHEN g.status = 'CANCELLED' THEN 'REFUNDED' ELSE 'CAPTURED' END,
            g.total, CASE WHEN g.status = 'CANCELLED' THEN g.total ELSE 0 END, 'tok_approve', g.created_at, g.created_at + interval '1 hour'
     FROM (SELECT order_n, status, sum((500 + (sku_n * 37) % 50000) * quantity)::bigint AS total, min(created_at) AS created_at
           FROM bench_lines GROUP BY order_n, status) g`,
  );
  await db.query(
    `INSERT INTO shipments (id, order_id, warehouse_id, tracking_code, shipped_at)
     SELECT ${id(NS.shipment, 'g.order_n')}, ${id(NS.order, 'g.order_n')}, $1::uuid, 'TRK-BENCH' || g.order_n, g.created_at + interval '1 day'
     FROM (SELECT DISTINCT order_n, created_at FROM bench_lines WHERE status = 'SHIPPED' AND line_n = 1) g`,
    [east],
  );
  await db.query(
    `INSERT INTO shipment_lines (shipment_id, order_line_id, quantity)
     SELECT ${id(NS.shipment, 'b.order_n')}, ${id(NS.orderLine, 'b.order_n * 2 + b.line_n')}, b.quantity
     FROM bench_lines b WHERE b.status = 'SHIPPED'`,
  );
  // Ledger: RESERVE for every line; then RELEASE (cancelled) or SHIP (shipped).
  await db.query(
    `INSERT INTO inventory_movements (sku_id, warehouse_id, kind, on_hand_delta, reserved_delta, reference_type, reference_id, created_at)
     SELECT ${id(NS.sku, 'b.sku_n')}, $1::uuid, m.kind,
            CASE m.kind WHEN 'SHIP' THEN -b.quantity ELSE 0 END,
            CASE m.kind WHEN 'RESERVE' THEN b.quantity ELSE -b.quantity END,
            CASE m.kind WHEN 'SHIP' THEN 'shipment' ELSE 'order' END,
            CASE m.kind WHEN 'SHIP' THEN ${id(NS.shipment, 'b.order_n')} ELSE ${id(NS.order, 'b.order_n')} END,
            b.created_at + CASE m.kind WHEN 'RESERVE' THEN interval '0' ELSE interval '1 day' END
     FROM bench_lines b
     JOIN (VALUES ('RESERVE'), ('RELEASE'), ('SHIP')) AS m(kind)
       ON m.kind = 'RESERVE' OR (m.kind = 'RELEASE' AND b.status = 'CANCELLED') OR (m.kind = 'SHIP' AND b.status = 'SHIPPED')`,
    [east],
  );
  await db.query(
    `INSERT INTO inventory_balances (sku_id, warehouse_id, on_hand, reserved, updated_at)
     SELECT sku_id, warehouse_id, sum(on_hand_delta)::int, sum(reserved_delta)::int, max(created_at)
     FROM inventory_movements GROUP BY sku_id, warehouse_id
     ON CONFLICT (sku_id, warehouse_id) DO UPDATE SET on_hand = EXCLUDED.on_hand, reserved = EXCLUDED.reserved, updated_at = EXCLUDED.updated_at`,
  );
  await db.query('ANALYZE');
}

/**
 * Generated rows reference only rows this loader created, so the per-row
 * foreign key triggers are pure overhead here (they dominate the load time).
 * session_replication_role = replica skips them for this transaction only;
 * CHECK and UNIQUE constraints still apply. It needs superuser rights, so
 * without them the loader keeps the checks and is just slower.
 */
async function skipForeignKeyChecksIfAllowed(db: Queryable): Promise<void> {
  await db.query('SAVEPOINT bench_replica_role');
  try {
    await db.query('SET LOCAL session_replication_role = replica');
    await db.query('RELEASE SAVEPOINT bench_replica_role');
  } catch {
    await db.query('ROLLBACK TO SAVEPOINT bench_replica_role');
  }
}
