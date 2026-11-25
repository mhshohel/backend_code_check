import type { Metadata } from 'next';
import Link from 'next/link';
import { loadMyOrders } from '@/modules/server/data/orders';
import { requireViewer } from '@/modules/server/session';
import { OrderStatusBadge } from '@/modules/ui/StatusBadge';
import { Pagination } from '@/modules/ui/Pagination';
import { formatDateTime } from '@/modules/ui/format';

export const metadata: Metadata = { title: 'My orders' };

type Props = { searchParams: Promise<{ after?: string | string[] }> };

export default async function MyOrdersPage({ searchParams }: Props) {
  await requireViewer('/orders');
  const { after } = await searchParams;
  const cursor = (Array.isArray(after) ? after[0] : after) ?? null;
  const orders = await loadMyOrders(cursor);

  return (
    <section>
      <h1>My orders</h1>
      {orders.edges.length === 0 ? (
        <p>
          You have no orders yet. <Link href="/">Browse the catalog</Link>.
        </p>
      ) : (
        <div className="table-wrap">
          <table>
            <thead>
              <tr>
                <th scope="col">Order</th>
                <th scope="col">Placed</th>
                <th scope="col">Status</th>
                <th scope="col">Total</th>
              </tr>
            </thead>
            <tbody>
              {orders.edges.map(({ node }) => (
                <tr key={node.id}>
                  <th scope="row">
                    <Link href={`/orders/${node.id}`}>{node.number}</Link>
                  </th>
                  <td>{formatDateTime(node.createdAt)}</td>
                  <td>
                    <OrderStatusBadge status={node.status} />
                  </td>
                  <td>{node.total.formatted}</td>
                </tr>
              ))}
            </tbody>
          </table>
        </div>
      )}
      <Pagination
        basePath="/orders"
        params={new URLSearchParams()}
        hasNextPage={orders.pageInfo.hasNextPage}
        endCursor={orders.pageInfo.endCursor}
        isFirstPage={cursor === null}
      />
    </section>
  );
}
