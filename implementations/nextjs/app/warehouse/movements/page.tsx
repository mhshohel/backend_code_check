import type { Metadata } from 'next';
import Link from 'next/link';
import { notFound } from 'next/navigation';
import { loadMovements } from '@/modules/server/data/warehouse';
import { STAFF_ROLES, requireRole } from '@/modules/server/session';
import { Pagination } from '@/modules/ui/Pagination';
import { firstParam, type PageSearchParams } from '@/modules/ui/search-param';
import { formatDateTime, humanize } from '@/modules/ui/format';

export const metadata: Metadata = { title: 'Movement history' };

type Props = { searchParams: Promise<PageSearchParams> };

function signed(value: number): string {
  return value > 0 ? `+${value}` : String(value);
}

export default async function MovementsPage({ searchParams }: Props) {
  await requireRole(STAFF_ROLES, '/warehouse/inventory');
  const params = await searchParams;
  const skuId = firstParam(params, 'sku');
  if (!skuId) notFound();
  const warehouseId = firstParam(params, 'warehouse');
  const after = firstParam(params, 'after');
  const movements = await loadMovements({ skuId, warehouseId, after });

  const keep = new URLSearchParams({ sku: skuId });
  if (warehouseId) keep.set('warehouse', warehouseId);

  return (
    <section>
      <p>
        <Link href="/warehouse/inventory">Back to inventory</Link>
      </p>
      <h1>Movement history</h1>
      <div className="table-wrap">
        <table>
          <thead>
            <tr>
              <th scope="col">When</th>
              <th scope="col">Kind</th>
              <th scope="col">Warehouse</th>
              <th scope="col">On hand</th>
              <th scope="col">Reserved</th>
              <th scope="col">Reference</th>
              <th scope="col">Reason</th>
              <th scope="col">By</th>
            </tr>
          </thead>
          <tbody>
            {movements.edges.map(({ node }) => (
              <tr key={node.id}>
                <td>{formatDateTime(node.createdAt)}</td>
                <td>{humanize(node.kind)}</td>
                <td>{node.warehouse.code}</td>
                <td>{signed(node.onHandDelta)}</td>
                <td>{signed(node.reservedDelta)}</td>
                <td>{node.referenceType ? `${node.referenceType} ${node.referenceId ?? ''}` : '—'}</td>
                <td>{node.reason ?? '—'}</td>
                <td>{node.actor?.displayName ?? 'System'}</td>
              </tr>
            ))}
          </tbody>
        </table>
      </div>
      {movements.edges.length === 0 && <p>No movements recorded.</p>}
      <Pagination
        basePath="/warehouse/movements"
        params={keep}
        hasNextPage={movements.pageInfo.hasNextPage}
        endCursor={movements.pageInfo.endCursor}
        isFirstPage={after === null}
      />
    </section>
  );
}
