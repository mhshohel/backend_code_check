import { AuditLogDocument } from '@ofl/graphql-types';
import { useCallback } from 'react';
import { CursorPages, DateTime, Section } from '../../components';
import { useUrlCursors } from '../../app/useUrlCursors';

export function AuditLogPanel() {
  const { cursors, loadMore } = useUrlCursors('auditAfter');
  const variablesFor = useCallback((after: string | null) => ({ first: 20, after }), []);
  return (
    <Section title="Audit log">
      <CursorPages
        query={AuditLogDocument}
        variablesFor={variablesFor}
        select={(data) => data.auditLog}
        cursors={cursors}
        onLoadMore={loadMore}
        empty={<p>No audit entries.</p>}
        renderEdges={(edges) => (
          <table className="table compact">
            <thead>
              <tr>
                <th scope="col">When</th>
                <th scope="col">Who</th>
                <th scope="col">Action</th>
                <th scope="col">Entity</th>
                <th scope="col">Details</th>
              </tr>
            </thead>
            <tbody>
              {edges.map(({ node }) => (
                <tr key={node.id}>
                  <td>
                    <DateTime value={node.createdAt} />
                  </td>
                  <td>{node.actor?.displayName ?? 'System'}</td>
                  <td>{node.action}</td>
                  <td>
                    {node.entityType} <span className="muted">{node.entityId}</span>
                  </td>
                  <td className="wrap">{node.details}</td>
                </tr>
              ))}
            </tbody>
          </table>
        )}
      />
    </Section>
  );
}
