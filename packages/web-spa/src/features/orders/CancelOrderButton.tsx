import { CancelOrderDocument } from '@ofl/graphql-types';
import { useState } from 'react';
import { useMutation } from 'urql';
import { Button, ErrorAlert } from '../../components';
import { useAppDispatch } from '../../app/store';
import { describeError } from '../../graphql/errors';
import { toastShown } from '../ui/uiSlice';

/** Shown only when order.allowedActions.canCancel; the server decides again. */
export function CancelOrderButton({ orderId, orderNumber }: { orderId: string; orderNumber: string }) {
  const [{ fetching }, cancelOrder] = useMutation(CancelOrderDocument);
  const [confirming, setConfirming] = useState(false);
  const [message, setMessage] = useState<string | null>(null);
  const dispatch = useAppDispatch();

  async function cancel() {
    setMessage(null);
    const response = await cancelOrder({ orderId });
    setConfirming(false);
    if (response.error) return setMessage(describeError(response.error).message);
    const result = response.data?.cancelOrder;
    if (result?.__typename === 'OrderCancelled') dispatch(toastShown('success', `Order ${orderNumber} was cancelled.`));
    else if (result) setMessage(result.message);
  }

  return (
    <div className="cancel-order">
      {confirming ? (
        <div role="group" aria-label="Confirm cancellation" className="inline-form">
          <span>Cancel order {orderNumber}?</span>
          <Button variant="danger" busy={fetching} onClick={() => void cancel()}>
            Yes, cancel order
          </Button>
          <Button onClick={() => setConfirming(false)}>Keep order</Button>
        </div>
      ) : (
        <Button variant="danger" onClick={() => setConfirming(true)}>
          Cancel order
        </Button>
      )}
      {message ? <ErrorAlert>{message}</ErrorAlert> : null}
    </div>
  );
}
