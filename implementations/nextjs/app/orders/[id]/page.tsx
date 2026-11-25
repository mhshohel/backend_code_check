import type { Metadata } from 'next';
import Link from 'next/link';
import { notFound } from 'next/navigation';
import { OrderLiveView } from '@/modules/orders/OrderLiveView';
import { loadOrder } from '@/modules/server/data/orders';
import { STAFF_ROLES, hasRole, requireViewer } from '@/modules/server/session';

export const metadata: Metadata = { title: 'Order' };

type Props = { params: Promise<{ id: string }> };

const UUID_PATTERN = /^[0-9a-f]{8}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{12}$/i;

export default async function OrderPage({ params }: Props) {
  const { id } = await params;
  const viewer = await requireViewer(`/orders/${id}`);
  if (!UUID_PATTERN.test(id)) notFound();
  // Another customer's order resolves to NOT_FOUND in the application layer, which renders not-found.tsx.
  const order = await loadOrder(id);
  if (!order) notFound();
  const isStaff = hasRole(viewer, STAFF_ROLES);

  return (
    <section>
      <p>
        <Link href={isStaff ? '/warehouse' : '/orders'}>{isStaff ? 'Back to warehouse' : 'All orders'}</Link>
      </p>
      <h1>Order {order.number}</h1>
      <OrderLiveView initialOrder={order} isStaff={isStaff} />
    </section>
  );
}
