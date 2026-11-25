import type { Metadata } from 'next';
import Link from 'next/link';
import { loadOrdersWithReturnsAwaitingReceipt } from '@/modules/server/data/warehouse';
import { STAFF_ROLES, requireRole } from '@/modules/server/session';
import { ReceiveReturnButton } from '@/modules/warehouse/ReceiveReturnButton';

export const metadata: Metadata = { title: 'Returns to receive' };

export default async function ReturnsPage() {
  await requireRole(STAFF_ROLES, '/warehouse/returns');
  const orders = await loadOrdersWithReturnsAwaitingReceipt();
  return (
    <section>
      <h1>Returns to receive</h1>
      {orders.edges.length === 0 ? (
        <p>No returns are waiting.</p>
      ) : (
        <ul className="card-list">
          {orders.edges.map(({ node }) => (
            <li key={node.id} className="card">
              <h2>
                <Link href={`/orders/${node.id}`}>{node.number}</Link>
              </h2>
              <p className="muted">{node.customer.displayName}</p>
              <ul>
                {node.allowedActions.receivableReturnIds.map((returnId, index) => (
                  <li key={returnId}>
                    <ReceiveReturnButton returnId={returnId} label={`return ${index + 1} of ${node.number}`} />
                  </li>
                ))}
              </ul>
            </li>
          ))}
        </ul>
      )}
    </section>
  );
}
