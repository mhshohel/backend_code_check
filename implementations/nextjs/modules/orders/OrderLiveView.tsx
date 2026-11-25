'use client';

import { useCallback, useEffect, useState } from 'react';
import { useRouter } from 'next/navigation';
import { useSubscription } from 'urql';
import { OrderUpdatedDocument, type OrderDetailFieldsFragment } from '@ofl/graphql-types';
import { useRealtimeStatus } from '../realtime/use-realtime-status';
import { CancelOrderButton } from './CancelOrderButton';
import { ReturnRequestForm } from './ReturnRequestForm';
import { OrderDetails } from './OrderDetails';
import { newerOrder } from './latest-order';
import { ShipOrderControls } from '../warehouse/ShipOrderControls';
import { ReceiveReturnButton } from '../warehouse/ReceiveReturnButton';

type Props = {
  readonly initialOrder: OrderDetailFieldsFragment;
  /** Role only decides which panels to show; the server re-checks every action. */
  readonly isStaff: boolean;
};

const STATUS_TEXT = {
  idle: 'Live updates paused.',
  connecting: 'Connecting to live updates…',
  connected: 'Live updates on.',
  reconnecting: 'Connection lost. Reconnecting; the latest status is shown again once connected.',
} as const;

/**
 * Server-rendered order + live subscription. On (re)subscribe the realtime
 * service sends the current order first, so after a reconnect the view jumps
 * to the latest state even if intermediate events were missed.
 */
export function OrderLiveView({ initialOrder, isStaff }: Props) {
  const router = useRouter();
  const [order, setOrder] = useState(initialOrder);
  const realtimeStatus = useRealtimeStatus();
  const [{ data }] = useSubscription({ query: OrderUpdatedDocument, variables: { orderId: initialOrder.id } });

  const event = data?.orderUpdated.order;
  useEffect(() => setOrder((current) => newerOrder(current, event)), [event]);
  // router.refresh() re-renders the page with a fresh server copy.
  useEffect(() => setOrder((current) => newerOrder(current, initialOrder)), [initialOrder]);

  const onOrderChanged = useCallback(
    (next: OrderDetailFieldsFragment) => {
      setOrder((current) => newerOrder(current, next));
      router.refresh();
    },
    [router],
  );

  const actions = order.allowedActions;
  return (
    <div className="order-live">
      <p className="realtime-status" role="status" aria-live="polite">
        {STATUS_TEXT[realtimeStatus]}
      </p>
      <OrderDetails order={order} />

      {actions.canCancel && (
        <section aria-labelledby="cancel-heading">
          <h2 id="cancel-heading">Cancel</h2>
          <CancelOrderButton orderId={order.id} orderNumber={order.number} onOrderChanged={onOrderChanged} />
        </section>
      )}
      {actions.canRequestReturn && (
        <section aria-labelledby="return-heading">
          <h2 id="return-heading">Request a return</h2>
          <ReturnRequestForm order={order} onOrderChanged={onOrderChanged} />
        </section>
      )}
      {isStaff && actions.shippableWarehouses.length > 0 && (
        <section aria-labelledby="ship-heading">
          <h2 id="ship-heading">Ship</h2>
          <ShipOrderControls
            orderId={order.id}
            orderNumber={order.number}
            warehouses={actions.shippableWarehouses}
            onShipped={onOrderChanged}
          />
        </section>
      )}
      {isStaff && actions.receivableReturnIds.length > 0 && (
        <section aria-labelledby="receive-heading">
          <h2 id="receive-heading">Receive returns</h2>
          <ul>
            {actions.receivableReturnIds.map((returnId, index) => (
              <li key={returnId}>
                <ReceiveReturnButton returnId={returnId} label={`return ${index + 1}`} onReceived={onOrderChanged} />
              </li>
            ))}
          </ul>
        </section>
      )}
    </div>
  );
}
