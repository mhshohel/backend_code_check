'use client';

import { useId, useState, type FormEvent } from 'react';
import { useMutation } from 'urql';
import { RequestReturnDocument, type OrderDetailFieldsFragment } from '@ofl/graphql-types';
import { describeError, type FieldError } from '../graphql/errors';
import { FieldErrors } from '../ui/FieldErrors';
import { ORDER_STATUS_LABELS } from '../ui/format';

type Props = {
  readonly order: OrderDetailFieldsFragment;
  readonly onOrderChanged: (order: OrderDetailFieldsFragment) => void;
};

/** Partial return: the customer picks a quantity per shipped line, up to the server-computed returnable quantity. */
export function ReturnRequestForm({ order, onOrderChanged }: Props) {
  const returnable = order.lines.filter((line) => line.returnableQuantity > 0);
  const [quantities, setQuantities] = useState<Record<string, string>>({});
  const [reason, setReason] = useState('');
  const [errors, setErrors] = useState<readonly FieldError[]>([]);
  const [message, setMessage] = useState<string | null>(null);
  const [{ fetching }, requestReturn] = useMutation(RequestReturnDocument);
  const reasonId = useId();
  const errorsId = useId();

  if (returnable.length === 0) return <p>No shipped items are left to return.</p>;

  async function submit(event: FormEvent<HTMLFormElement>): Promise<void> {
    event.preventDefault();
    const lines = returnable
      .map((line) => ({ orderLineId: line.id, quantity: Number(quantities[line.id] ?? '0') }))
      .filter((line) => line.quantity > 0);
    if (lines.length === 0) {
      setErrors([{ path: '(root)', message: 'Select at least one item to return.' }]);
      return;
    }
    setErrors([]);
    const result = await requestReturn({ input: { orderId: order.id, reason: reason.trim(), lines } });
    if (result.error) {
      const described = describeError(result.error);
      setErrors(described.fieldErrors.length > 0 ? described.fieldErrors : [{ path: '(root)', message: described.message }]);
      return;
    }
    const payload = result.data?.requestReturn;
    switch (payload?.__typename) {
      case 'ReturnRequested':
        setMessage('Return requested. You will be refunded when the warehouse receives the items.');
        setQuantities({});
        setReason('');
        onOrderChanged(payload.order);
        return;
      case 'ReturnQuantityExceeded':
        setErrors(
          payload.lines.map((line) => ({
            path: order.lines.find((candidate) => candidate.id === line.orderLineId)?.skuCode ?? line.orderLineId,
            message: `you asked to return ${line.requested}, only ${line.returnable} can be returned`,
          })),
        );
        return;
      case 'OrderNotReturnable':
        setErrors([{ path: '(root)', message: `This order cannot be returned (status: ${ORDER_STATUS_LABELS[payload.status]}).` }]);
        return;
      default:
        return;
    }
  }

  return (
    <form className="return-form" onSubmit={(event) => void submit(event)} aria-describedby={errors.length > 0 ? errorsId : undefined}>
      <fieldset>
        <legend>Items to return</legend>
        {returnable.map((line) => (
          <div className="field inline" key={line.id}>
            <label htmlFor={`return-${line.id}`}>
              {line.productName} ({line.skuCode}) — up to {line.returnableQuantity}
            </label>
            <input
              id={`return-${line.id}`}
              type="number"
              inputMode="numeric"
              min={0}
              max={line.returnableQuantity}
              value={quantities[line.id] ?? '0'}
              onChange={(event) => setQuantities((current) => ({ ...current, [line.id]: event.target.value }))}
            />
          </div>
        ))}
      </fieldset>
      <div className="field">
        <label htmlFor={reasonId}>Reason</label>
        <textarea id={reasonId} value={reason} required minLength={3} maxLength={500} onChange={(event) => setReason(event.target.value)} />
      </div>
      <FieldErrors id={errorsId} errors={errors} />
      <button type="submit" disabled={fetching}>
        {fetching ? 'Requesting return…' : 'Request return'}
      </button>
      <p role="status" aria-live="polite">
        {message}
      </p>
    </form>
  );
}
