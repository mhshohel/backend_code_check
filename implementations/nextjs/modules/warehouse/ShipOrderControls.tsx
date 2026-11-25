'use client';

import { useId, useState, type FormEvent } from 'react';
import { useRouter } from 'next/navigation';
import { useMutation } from 'urql';
import { ShipOrderDocument, type OrderDetailFieldsFragment, type WarehouseFieldsFragment } from '@ofl/graphql-types';
import { describeError } from '../graphql/errors';
import { ORDER_STATUS_LABELS } from '../ui/format';

type Props = {
  readonly orderId: string;
  readonly orderNumber: string;
  readonly warehouses: readonly WarehouseFieldsFragment[];
  readonly onShipped?: (order: OrderDetailFieldsFragment) => void;
};

/** One ship form per warehouse that still holds confirmed, unshipped reservations for the order. */
export function ShipOrderControls({ orderId, orderNumber, warehouses, onShipped }: Props) {
  if (warehouses.length === 0) return <p className="muted">Nothing left to ship.</p>;
  return (
    <div className="action-group">
      {warehouses.map((warehouse) => (
        <ShipFromWarehouse key={warehouse.id} orderId={orderId} orderNumber={orderNumber} warehouse={warehouse} onShipped={onShipped} />
      ))}
    </div>
  );
}

function ShipFromWarehouse({
  orderId,
  orderNumber,
  warehouse,
  onShipped,
}: {
  readonly orderId: string;
  readonly orderNumber: string;
  readonly warehouse: WarehouseFieldsFragment;
  readonly onShipped: ((order: OrderDetailFieldsFragment) => void) | undefined;
}) {
  const router = useRouter();
  const [trackingCode, setTrackingCode] = useState('');
  const [message, setMessage] = useState<string | null>(null);
  const [{ fetching }, shipOrder] = useMutation(ShipOrderDocument);
  const trackingId = useId();

  async function submit(event: FormEvent<HTMLFormElement>): Promise<void> {
    event.preventDefault();
    const result = await shipOrder({
      input: { orderId, warehouseId: warehouse.id, trackingCode: trackingCode.trim() || null },
    });
    if (result.error) {
      setMessage(describeError(result.error).message);
      return;
    }
    const payload = result.data?.shipOrder;
    switch (payload?.__typename) {
      case 'ShipmentCreated':
        setMessage(`Shipped from ${warehouse.code}, tracking ${payload.shipment.trackingCode}.`);
        // On the order page the live view refreshes; in dashboard lists we re-render the server list.
        if (onShipped) onShipped(payload.order);
        else router.refresh();
        return;
      case 'NothingToShip':
        setMessage(`Nothing left to ship from ${warehouse.code}.`);
        return;
      case 'OrderNotShippable':
        setMessage(`Order cannot be shipped (status: ${ORDER_STATUS_LABELS[payload.status]}).`);
        return;
      default:
        return;
    }
  }

  return (
    <form className="inline-form" onSubmit={(event) => void submit(event)} aria-label={`Ship order ${orderNumber} from ${warehouse.code}`}>
      <label htmlFor={trackingId}>Tracking code for {warehouse.code} (optional)</label>
      <input
        id={trackingId}
        value={trackingCode}
        minLength={4}
        maxLength={64}
        onChange={(event) => setTrackingCode(event.target.value)}
      />
      <button type="submit" disabled={fetching}>
        {fetching ? 'Shipping…' : `Ship from ${warehouse.code}`}
      </button>
      <span role="status" aria-live="polite">
        {message}
      </span>
    </form>
  );
}
