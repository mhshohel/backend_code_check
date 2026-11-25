import type { Dataset } from './dataset';

/**
 * Tracks stock while a profile builds history, and appends one movement
 * per change. Seeded orders therefore obey the same invariants as live ones.
 */
export type Ledger = {
  available(skuId: string, warehouseId: string): number;
  move(change: {
    skuId: string;
    warehouseId: string;
    kind: 'RECEIPT' | 'RESERVE' | 'RELEASE' | 'SHIP' | 'RETURN_RESTOCK' | 'ADJUSTMENT';
    onHandDelta: number;
    reservedDelta: number;
    referenceType?: string;
    referenceId?: string;
    reason?: string;
    actorUserId?: string;
    at: Date;
  }): void;
};

export function createLedger(dataset: Dataset): Ledger {
  const balances = new Map<string, { onHand: number; reserved: number }>();
  const key = (skuId: string, warehouseId: string) => `${skuId}|${warehouseId}`;
  return {
    available(skuId, warehouseId) {
      const balance = balances.get(key(skuId, warehouseId));
      return balance ? balance.onHand - balance.reserved : 0;
    },
    move(change) {
      const balance = balances.get(key(change.skuId, change.warehouseId)) ?? { onHand: 0, reserved: 0 };
      const onHand = balance.onHand + change.onHandDelta;
      const reserved = balance.reserved + change.reservedDelta;
      if (onHand < 0 || reserved < 0 || reserved > onHand) {
        throw new Error(`Fixture would break an inventory invariant for ${change.skuId} in ${change.warehouseId}.`);
      }
      balances.set(key(change.skuId, change.warehouseId), { onHand, reserved });
      dataset.inventory_movements.push({
        sku_id: change.skuId,
        warehouse_id: change.warehouseId,
        kind: change.kind,
        on_hand_delta: change.onHandDelta,
        reserved_delta: change.reservedDelta,
        reference_type: change.referenceType ?? null,
        reference_id: change.referenceId ?? null,
        reason: change.reason ?? null,
        actor_user_id: change.actorUserId ?? null,
        created_at: change.at.toISOString(),
      });
    },
  };
}
