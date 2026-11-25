import type { Metadata } from 'next';
import { loadAuditLog } from '@/modules/server/data/admin';
import { ADMIN_ROLES, requireRole } from '@/modules/server/session';
import { Pagination } from '@/modules/ui/Pagination';
import { firstParam, type PageSearchParams } from '@/modules/ui/search-param';
import { formatDateTime } from '@/modules/ui/format';

export const metadata: Metadata = { title: 'Audit log' };

type Props = { searchParams: Promise<PageSearchParams> };

export default async function AuditPage({ searchParams }: Props) {
  await requireRole(ADMIN_ROLES, '/admin/audit');
  const after = firstParam(await searchParams, 'after');
  const audit = await loadAuditLog(after);
  return (
    <section>
      <h1>Audit log</h1>
      <div className="table-wrap">
        <table>
          <thead>
            <tr>
              <th scope="col">When</th>
              <th scope="col">Actor</th>
              <th scope="col">Action</th>
              <th scope="col">Entity</th>
              <th scope="col">Details</th>
              <th scope="col">Correlation ID</th>
            </tr>
          </thead>
          <tbody>
            {audit.edges.map(({ node }) => (
              <tr key={node.id}>
                <td>{formatDateTime(node.createdAt)}</td>
                <td>{node.actor?.displayName ?? 'System'}</td>
                <th scope="row">{node.action}</th>
                <td>
                  {node.entityType} {node.entityId}
                </td>
                <td>
                  <code>{node.details}</code>
                </td>
                <td>
                  <code>{node.correlationId ?? '—'}</code>
                </td>
              </tr>
            ))}
          </tbody>
        </table>
      </div>
      {audit.edges.length === 0 && <p>No audit entries yet.</p>}
      <Pagination
        basePath="/admin/audit"
        params={new URLSearchParams()}
        hasNextPage={audit.pageInfo.hasNextPage}
        endCursor={audit.pageInfo.endCursor}
        isFirstPage={after === null}
      />
    </section>
  );
}
