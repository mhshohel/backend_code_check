'use client';

import { useState } from 'react';
import { useMutation } from 'urql';
import { CancelOrderDocument, type OrderDetailFieldsFragment } from '@ofl/graphql-types';
import { describeError } from '../graphql/errors';
import { ORDER_STATUS_LABELS } from '../ui/format';

type Props = {
  readonly orderId: string;
  readonly orderNumber: string;
  readonly onOrderChanged: (order: OrderDetailFieldsFragment) => void;
};

/** Two-step cancel: the first click asks for confirmation, so a stray click never cancels an order. */
export function CancelOrderButton({ orderId, orderNumber, onOrderChanged }: Props) {
  const [confirming, setConfirming] = useState(false);
  const [message, setMessage] = useState<string | null>(null);
  const [{ fetching }, cancelOrder] = useMutation(CancelOrderDocument);

  async function confirm(): Promise<void> {
    const result = await cancelOrder({ orderId });
    setConfirming(false);
    if (result.error) {
      setMessage(describeError(result.error).message);
      return;
    }
    const payload = result.data?.cancelOrder;
    if (payload?.__typename === 'OrderCancelled') {
      setMessage(`Order ${orderNumber} was cancelled.`);
      onOrderChanged(payload.order);
    } else if (payload?.__typename === 'OrderNotCancellable') {
      setMessage(`This order can no longer be cancelled (status: ${ORDER_STATUS_LABELS[payload.status]}).`);
    }
  }

  return (
    <div className="action-group">
      {!confirming ? (
        <button type="button" onClick={() => setConfirming(true)} disabled={fetching}>
          Cancel order
        </button>
      ) : (
        <div role="group" aria-label="Confirm cancellation">
          <p>Cancel order {orderNumber}? Reserved items are released and any payment is refunded.</p>
          <button type="button" className="danger" onClick={() => void confirm()} disabled={fetching}>
            {fetching ? 'Cancelling…' : 'Yes, cancel order'}
          </button>
          <button type="button" className="secondary" onClick={() => setConfirming(false)} disabled={fetching}>
            Keep order
          </button>
        </div>
      )}
      <p role="status" aria-live="polite">
        {message}
      </p>
    </div>
  );
}
