import type { Tx } from '../../db/db';

/**
 * Enqueues one search.product_changed event per product that owns one of
 * the SKUs. The indexer re-reads PostgreSQL, so the payload carries only the id.
 */
export async function enqueueSearchUpdateForSkus(tx: Tx, skuIds: readonly string[], correlationId: string | null): Promise<void> {
  if (skuIds.length === 0) return;
  await tx.query(
    `INSERT INTO outbox_events (topic, aggregate_type, aggregate_id, payload, correlation_id)
     SELECT 'search.product_changed', 'product', p.product_id::text, jsonb_build_object('productId', p.product_id), $2
     FROM (SELECT DISTINCT product_id FROM skus WHERE id = ANY($1::uuid[])) p`,
    [[...new Set(skuIds)], correlationId],
  );
}

export async function enqueueSearchUpdateForProducts(tx: Tx, productIds: readonly string[], correlationId: string | null): Promise<void> {
  if (productIds.length === 0) return;
  await tx.query(
    `INSERT INTO outbox_events (topic, aggregate_type, aggregate_id, payload, correlation_id)
     SELECT 'search.product_changed', 'product', id::text, jsonb_build_object('productId', id), $2
     FROM unnest($1::uuid[]) AS id`,
    [[...new Set(productIds)], correlationId],
  );
}
