import { notFound, parseInput, updateSkuPriceInputSchema } from '@ofl/domain';
import type { Services } from '../../services';
import { writeAudit } from '../audit/audit';
import { requireAdmin } from '../auth/guards';
import type { RequestMeta, SessionUser } from '../auth/sessions';
import { SKU_COLUMNS, type SkuRecord } from './records';
import { enqueueSearchUpdateForSkus } from './search-events';

/** Administrator. Bumps skus.version so the search document version grows (requirements §6.9). */
export async function updateSkuPrice(services: Services, viewer: SessionUser | null, input: unknown, meta: RequestMeta): Promise<SkuRecord> {
  const admin = requireAdmin(viewer);
  const request = parseInput(updateSkuPriceInputSchema, input);

  return services.db.transaction(async (tx) => {
    const current = await tx.query<SkuRecord>(`SELECT ${SKU_COLUMNS} FROM skus s WHERE s.id = $1 FOR UPDATE`, [request.skuId]);
    const before = current.rows[0];
    if (!before) throw notFound('SKU');
    const updated = await tx.query<SkuRecord>(
      `UPDATE skus s SET price_minor = $2, version = version + 1 WHERE s.id = $1 RETURNING ${SKU_COLUMNS}`,
      [request.skuId, request.priceMinor],
    );
    const sku = updated.rows[0];
    if (!sku) throw notFound('SKU');
    await writeAudit(tx, {
      actorUserId: admin.id,
      action: 'sku.price_changed',
      entityType: 'sku',
      entityId: sku.id,
      details: { code: sku.code, fromMinor: before.priceMinor, toMinor: sku.priceMinor },
      correlationId: meta.correlationId,
    });
    await enqueueSearchUpdateForSkus(tx, [sku.id], meta.correlationId);
    return sku;
  });
}
