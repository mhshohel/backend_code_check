import type { Queryable } from '../../db/db';
import { assertCursorId, toPage, type Page, type PageRequest } from '../../db/pagination';
import type { MovementKind } from './ledger';

export type BalanceRecord = { skuId: string; warehouseId: string; onHand: number; reserved: number; updatedAt: Date };

export const BALANCE_COLUMNS = `b.sku_id AS "skuId", b.warehouse_id AS "warehouseId", b.on_hand AS "onHand", b.reserved,
  b.updated_at AS "updatedAt"`;

export type MovementRecord = {
  id: string;
  skuId: string;
  warehouseId: string;
  kind: MovementKind;
  onHandDelta: number;
  reservedDelta: number;
  referenceType: string | null;
  referenceId: string | null;
  reason: string | null;
  actorUserId: string | null;
  createdAt: Date;
};

export const MOVEMENT_COLUMNS = `m.id::text AS id, m.sku_id AS "skuId", m.warehouse_id AS "warehouseId", m.kind,
  m.on_hand_delta AS "onHandDelta", m.reserved_delta AS "reservedDelta", m.reference_type AS "referenceType",
  m.reference_id AS "referenceId", m.reason, m.actor_user_id AS "actorUserId", m.created_at AS "createdAt"`;

export const LOW_STOCK_THRESHOLD = 5;

type BalancePageRow = BalanceRecord & { skuCode: string };

/** Balances ordered by SKU code, then warehouse id (keyset). */
export async function listBalances(
  db: Queryable,
  filter: { warehouseId: string | null; lowStockOnly: boolean },
  page: PageRequest,
): Promise<Page<BalanceRecord>> {
  assertCursorId(page, 'uuid');
  const result = await db.query<BalancePageRow>(
    `SELECT ${BALANCE_COLUMNS}, s.code AS "skuCode"
     FROM inventory_balances b JOIN skus s ON s.id = b.sku_id
     WHERE ($1::uuid IS NULL OR b.warehouse_id = $1)
       AND (NOT $2::boolean OR b.on_hand - b.reserved <= $3)
       AND ($4::text IS NULL OR (s.code, b.warehouse_id) > ($4::text, $5::uuid))
     ORDER BY s.code, b.warehouse_id
     LIMIT $6`,
    [filter.warehouseId, filter.lowStockOnly, LOW_STOCK_THRESHOLD, page.after?.sortKey ?? null, page.after?.id ?? null, page.limit + 1],
  );
  return toPage(result.rows, page.limit, (row) => ({ sortKey: row.skuCode, id: row.warehouseId }));
}

/** Movements newest first. The bigint id is both the sort key and the tie-breaker. */
export async function listMovements(
  db: Queryable,
  filter: { skuId: string; warehouseId: string | null },
  page: PageRequest,
): Promise<Page<MovementRecord>> {
  assertCursorId(page, 'bigint');
  const result = await db.query<MovementRecord>(
    `SELECT ${MOVEMENT_COLUMNS} FROM inventory_movements m
     WHERE m.sku_id = $1 AND ($2::uuid IS NULL OR m.warehouse_id = $2)
       AND ($3::bigint IS NULL OR m.id < $3::bigint)
     ORDER BY m.id DESC LIMIT $4`,
    [filter.skuId, filter.warehouseId, page.after?.id ?? null, page.limit + 1],
  );
  return toPage(result.rows, page.limit, (row) => ({ sortKey: row.id, id: row.id }));
}

export type LedgerDifference = { skuId: string; warehouseId: string; field: string; balance: number; ledger: number };

/** Compares every balance with the sum of its movements (requirements §4, invariant 2). */
export async function findLedgerDifferences(db: Queryable): Promise<LedgerDifference[]> {
  const result = await db.query<{ skuId: string; warehouseId: string; onHand: number; reserved: number; ledgerOnHand: number; ledgerReserved: number }>(
    `SELECT COALESCE(b.sku_id, m.sku_id) AS "skuId", COALESCE(b.warehouse_id, m.warehouse_id) AS "warehouseId",
            COALESCE(b.on_hand, 0) AS "onHand", COALESCE(b.reserved, 0) AS reserved,
            COALESCE(m.on_hand, 0)::bigint AS "ledgerOnHand", COALESCE(m.reserved, 0)::bigint AS "ledgerReserved"
     FROM inventory_balances b
     FULL JOIN (
       SELECT sku_id, warehouse_id, sum(on_hand_delta) AS on_hand, sum(reserved_delta) AS reserved
       FROM inventory_movements GROUP BY sku_id, warehouse_id
     ) m ON m.sku_id = b.sku_id AND m.warehouse_id = b.warehouse_id
     WHERE COALESCE(b.on_hand, 0) <> COALESCE(m.on_hand, 0) OR COALESCE(b.reserved, 0) <> COALESCE(m.reserved, 0)
     ORDER BY 1, 2`,
  );
  const differences: LedgerDifference[] = [];
  for (const row of result.rows) {
    if (row.onHand !== row.ledgerOnHand) {
      differences.push({ skuId: row.skuId, warehouseId: row.warehouseId, field: 'on_hand', balance: row.onHand, ledger: row.ledgerOnHand });
    }
    if (row.reserved !== row.ledgerReserved) {
      differences.push({ skuId: row.skuId, warehouseId: row.warehouseId, field: 'reserved', balance: row.reserved, ledger: row.ledgerReserved });
    }
  }
  return differences;
}

