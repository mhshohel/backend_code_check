import { InventoryMovementsDocument } from '@ofl/graphql-types';
import { useCallback } from 'react';
import { CursorPages, DateTime, Section, humanize } from '../../components';
import { useUrlCursors } from '../../app/useUrlCursors';

function signed(value: number): string {
  return value > 0 ? `+${value}` : String(value);
}

type MovementHistoryProps = { skuId: string; warehouseId: string; cursorParam: string };

export function MovementHistory({ skuId, warehouseId, cursorParam }: MovementHistoryProps) {
  const { cursors, loadMore } = useUrlCursors(cursorParam);
  const variablesFor = useCallback((after: string | null) => ({ skuId, warehouseId, first: 20, after }), [skuId, warehouseId]);
  return (
    <Section title="Movement history">
      <CursorPages
        query={InventoryMovementsDocument}
        variablesFor={variablesFor}
        select={(data) => data.inventoryMovements}
        cursors={cursors}
        onLoadMore={loadMore}
        empty={<p>No movements yet.</p>}
        renderEdges={(edges) => (
          <table className="table compact">
            <thead>
              <tr>
                <th scope="col">When</th>
                <th scope="col">Kind</th>
                <th scope="col">On hand</th>
                <th scope="col">Reserved</th>
                <th scope="col">Reference</th>
                <th scope="col">By</th>
              </tr>
            </thead>
            <tbody>
              {edges.map(({ node }) => (
                <tr key={node.id}>
                  <td>
                    <DateTime value={node.createdAt} />
                  </td>
                  <td>{humanize(node.kind)}</td>
                  <td>{signed(node.onHandDelta)}</td>
                  <td>{signed(node.reservedDelta)}</td>
                  <td>{node.reason ?? node.referenceType ?? '—'}</td>
                  <td>{node.actor?.displayName ?? 'System'}</td>
                </tr>
              ))}
            </tbody>
          </table>
        )}
      />
    </Section>
  );
}
