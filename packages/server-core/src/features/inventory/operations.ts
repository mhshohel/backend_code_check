import { adjustInventoryInputSchema, notFound, parseInput } from '@ofl/domain';
import type { Services } from '../../services';
import { writeAudit } from '../audit/audit';
import { requireStaff } from '../auth/guards';
import type { RequestMeta, SessionUser } from '../auth/sessions';
import { enqueueSearchUpdateForSkus } from '../catalog/search-events';
import { applyStockChanges, lockBalance } from './ledger';
import { BALANCE_COLUMNS, MOVEMENT_COLUMNS, type BalanceRecord, type MovementRecord } from './queries';

export type AdjustInventoryOutcome =
  | { kind: 'adjusted'; balance: BalanceRecord; movement: MovementRecord }
  | { kind: 'rejected'; onHand: number; reserved: number };

/** Operator. RECEIPT adds stock; ADJUSTMENT corrects it but never below the reserved units. */
export async function adjustInventory(services: Services, viewer: SessionUser | null, input: unknown, meta: RequestMeta): Promise<AdjustInventoryOutcome> {
  const operator = requireStaff(viewer);
  const request = parseInput(adjustInventoryInputSchema, input);

  return services.db.transaction(async (tx) => {
    const exists = await tx.query(
      'SELECT 1 FROM skus s, warehouses w WHERE s.id = $1 AND w.id = $2',
      [request.skuId, request.warehouseId],
    );
    if (exists.rowCount === 0) throw notFound('SKU or warehouse');
    // First stock for this SKU in this warehouse: create the zero row so it can be locked.
    await tx.query(
      `INSERT INTO inventory_balances (sku_id, warehouse_id, on_hand, reserved) VALUES ($1, $2, 0, 0) ON CONFLICT DO NOTHING`,
      [request.skuId, request.warehouseId],
    );
    const balance = await lockBalance(tx, request.skuId, request.warehouseId);
    if (!balance) throw notFound('Inventory balance');
    if (balance.onHand + request.quantityDelta < balance.reserved) {
      return { kind: 'rejected', onHand: balance.onHand, reserved: balance.reserved };
    }

    const [movement] = await applyStockChanges(tx, [
      {
        skuId: request.skuId,
        warehouseId: request.warehouseId,
        kind: request.kind,
        onHandDelta: request.quantityDelta,
        reservedDelta: 0,
        reason: request.reason,
        actorUserId: operator.id,
      },
    ]);
    if (!movement) throw new Error('Movement insert returned no row.');
    await writeAudit(tx, {
      actorUserId: operator.id,
      action: request.kind === 'RECEIPT' ? 'inventory.received' : 'inventory.adjusted',
      entityType: 'inventory_balance',
      entityId: `${request.skuId}:${request.warehouseId}`,
      details: { quantityDelta: request.quantityDelta, reason: request.reason, onHandBefore: balance.onHand },
      correlationId: meta.correlationId,
    });
    await enqueueSearchUpdateForSkus(tx, [request.skuId], meta.correlationId);

    const updated = await tx.query<BalanceRecord>(
      `SELECT ${BALANCE_COLUMNS} FROM inventory_balances b WHERE b.sku_id = $1 AND b.warehouse_id = $2`,
      [request.skuId, request.warehouseId],
    );
    const movementRow = await tx.query<MovementRecord>(`SELECT ${MOVEMENT_COLUMNS} FROM inventory_movements m WHERE m.id = $1`, [movement.id]);
    const balanceRecord = updated.rows[0];
    const movementRecord = movementRow.rows[0];
    if (!balanceRecord || !movementRecord) throw new Error('Adjusted rows could not be read back.');
    return { kind: 'adjusted', balance: balanceRecord, movement: movementRecord };
  });
}
