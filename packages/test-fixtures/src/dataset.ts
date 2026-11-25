import type { Queryable } from '@ofl/server-core';

type Value = string | number | boolean | null | string[];
export type RowObject = Record<string, Value>;

/** Rows per table, in insertion order (parents before children). */
export const DATASET_TABLES = [
  'users',
  'categories',
  'warehouses',
  'products',
  'skus',
  'orders',
  'order_lines',
  'reservations',
  'payments',
  'payment_events',
  'refunds',
  'shipments',
  'shipment_lines',
  'returns',
  'return_lines',
  'inventory_movements',
] as const;
export type DatasetTable = (typeof DATASET_TABLES)[number];

export type Dataset = Record<DatasetTable, RowObject[]>;

export function emptyDataset(): Dataset {
  return Object.fromEntries(DATASET_TABLES.map((table) => [table, []])) as unknown as Dataset;
}

const CHUNK = 2000;
const COLUMN_NAME = /^[a-z_]+$/;

/**
 * Inserts every table with jsonb_populate_recordset (one statement per
 * chunk), then derives inventory_balances from the movement ledger, so the
 * seeded balances reconcile by construction.
 */
export async function writeDataset(db: Queryable, dataset: Dataset): Promise<void> {
  for (const table of DATASET_TABLES) {
    const rows = dataset[table];
    for (let start = 0; start < rows.length; start += CHUNK) {
      await insertRows(db, table, rows.slice(start, start + CHUNK));
    }
  }
  await db.query(
    `INSERT INTO inventory_balances (sku_id, warehouse_id, on_hand, reserved, updated_at)
     SELECT sku_id, warehouse_id, sum(on_hand_delta)::int, sum(reserved_delta)::int, max(created_at)
     FROM inventory_movements GROUP BY sku_id, warehouse_id
     ON CONFLICT (sku_id, warehouse_id) DO UPDATE
       SET on_hand = EXCLUDED.on_hand, reserved = EXCLUDED.reserved, updated_at = EXCLUDED.updated_at`,
  );
}

async function insertRows(db: Queryable, table: DatasetTable, rows: readonly RowObject[]): Promise<void> {
  const first = rows[0];
  if (!first) return;
  const columns = Object.keys(first);
  for (const column of columns) {
    if (!COLUMN_NAME.test(column)) throw new Error(`Invalid column name ${column}.`);
  }
  const list = columns.join(', ');
  // Table names come from DATASET_TABLES and columns are checked above.
  await db.query(`INSERT INTO ${table} (${list}) SELECT ${list} FROM jsonb_populate_recordset(NULL::${table}, $1::jsonb)`, [
    JSON.stringify(rows),
  ]);
}
