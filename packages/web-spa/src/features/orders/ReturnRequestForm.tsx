import { requestReturnInputSchema } from '@ofl/domain';
import { RequestReturnDocument } from '@ofl/graphql-types';
import { useState, type FormEvent } from 'react';
import { useMutation } from 'urql';
import { Button, ErrorAlert, StatusMessage, TextAreaField } from '../../components';
import { useAppDispatch } from '../../app/store';
import { describeError } from '../../graphql/errors';
import { toastShown } from '../ui/uiSlice';
import type { OrderDetail } from './useLiveOrder';

type Quantities = Record<string, number>;

/** Per-line return quantities, each limited to line.returnableQuantity from the server. */
export function ReturnRequestForm({ order }: { order: OrderDetail }) {
  const returnable = order.lines.filter((line) => line.returnableQuantity > 0);
  const [quantities, setQuantities] = useState<Quantities>({});
  const [reason, setReason] = useState('');
  const [errors, setErrors] = useState<string[]>([]);
  const [{ fetching }, requestReturn] = useMutation(RequestReturnDocument);
  const dispatch = useAppDispatch();

  if (returnable.length === 0) return null;

  async function submit(event: FormEvent<HTMLFormElement>) {
    event.preventDefault();
    const over = returnable.filter((line) => (quantities[line.id] ?? 0) > line.returnableQuantity);
    const input = {
      orderId: order.id,
      reason,
      lines: returnable
        .map((line) => ({ orderLineId: line.id, quantity: quantities[line.id] ?? 0 }))
        .filter((line) => line.quantity > 0),
    };
    const parsed = requestReturnInputSchema.safeParse(input);
    const messages = [
      ...over.map((line) => `${line.skuCode}: at most ${line.returnableQuantity} can be returned.`),
      ...(parsed.success ? [] : parsed.error.issues.map((issue) => issue.message)),
    ];
    setErrors(messages);
    if (messages.length > 0) return;

    const response = await requestReturn({ input });
    if (response.error) return setErrors([describeError(response.error).message]);
    const result = response.data?.requestReturn;
    if (!result) return;
    if (result.__typename === 'ReturnRequested') {
      dispatch(toastShown('success', 'Return requested. We will refund you when the items arrive.'));
      setQuantities({});
      setReason('');
    } else if (result.__typename === 'ReturnQuantityExceeded') {
      setErrors(result.lines.map((line) => `Only ${line.returnable} can be returned (you asked for ${line.requested}).`));
    } else {
      setErrors([result.message]);
    }
  }

  return (
    <form className="form return-form" onSubmit={submit} noValidate aria-label="Request a return">
      <h3>Request a return</h3>
      {errors.length > 0 ? (
        <ErrorAlert title="The return could not be requested">
          <ul>
            {errors.map((message) => (
              <li key={message}>{message}</li>
            ))}
          </ul>
        </ErrorAlert>
      ) : null}
      {returnable.map((line) => (
        <div key={line.id} className="inline-form">
          <label htmlFor={`return-${line.id}`}>
            {line.productName} ({line.skuCode}), up to {line.returnableQuantity}
          </label>
          <input
            id={`return-${line.id}`}
            type="number"
            min={0}
            max={line.returnableQuantity}
            value={quantities[line.id] ?? 0}
            onChange={(e) => setQuantities({ ...quantities, [line.id]: Math.max(0, Math.trunc(Number(e.target.value) || 0)) })}
          />
        </div>
      ))}
      <TextAreaField label="Reason" value={reason} onChange={(e) => setReason(e.target.value)} rows={2} required />
      <Button type="submit" busy={fetching}>
        Request return
      </Button>
      <StatusMessage>{fetching ? 'Sending return request…' : ''}</StatusMessage>
    </form>
  );
}
