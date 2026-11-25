'use client';

import { useId, useState, type FormEvent } from 'react';
import { useRouter } from 'next/navigation';
import { useMutation } from 'urql';
import { AdjustInventoryDocument, type StockChangeKind } from '@ofl/graphql-types';
import { describeError, type FieldError } from '../graphql/errors';
import { FieldErrors } from '../ui/FieldErrors';

type Props = {
  readonly skuId: string;
  readonly skuCode: string;
  readonly warehouseId: string;
  readonly warehouseCode: string;
};

export function AdjustInventoryForm({ skuId, skuCode, warehouseId, warehouseCode }: Props) {
  const router = useRouter();
  const [kind, setKind] = useState<StockChangeKind>('RECEIPT');
  const [delta, setDelta] = useState('');
  const [reason, setReason] = useState('');
  const [errors, setErrors] = useState<readonly FieldError[]>([]);
  const [message, setMessage] = useState<string | null>(null);
  const [{ fetching }, adjust] = useMutation(AdjustInventoryDocument);
  const ids = { kind: useId(), delta: useId(), reason: useId(), errors: useId() };

  async function submit(event: FormEvent<HTMLFormElement>): Promise<void> {
    event.preventDefault();
    setMessage(null);
    const quantityDelta = Number(delta);
    if (!Number.isInteger(quantityDelta) || quantityDelta === 0) {
      setErrors([{ path: 'quantityDelta', message: 'Enter a whole number other than zero.' }]);
      return;
    }
    setErrors([]);
    const result = await adjust({ input: { skuId, warehouseId, kind, quantityDelta, reason: reason.trim() } });
    if (result.error) {
      const described = describeError(result.error);
      setErrors(described.fieldErrors.length > 0 ? described.fieldErrors : [{ path: '(root)', message: described.message }]);
      return;
    }
    const payload = result.data?.adjustInventory;
    if (payload?.__typename === 'InventoryAdjusted') {
      setMessage(`Saved. On hand ${payload.balance.onHand}, reserved ${payload.balance.reserved}, available ${payload.balance.available}.`);
      setDelta('');
      setReason('');
      router.refresh();
    } else if (payload?.__typename === 'AdjustmentRejected') {
      setErrors([
        {
          path: 'quantityDelta',
          message: `${payload.message} On hand ${payload.onHand}, reserved ${payload.reserved}.`,
        },
      ]);
    }
  }

  return (
    <form className="adjust-form" onSubmit={(event) => void submit(event)} aria-label={`Adjust ${skuCode} in ${warehouseCode}`}>
      <div className="field">
        <label htmlFor={ids.kind}>Change</label>
        <select id={ids.kind} value={kind} onChange={(event) => setKind(event.target.value as StockChangeKind)}>
          <option value="RECEIPT">Receipt (goods arrived)</option>
          <option value="ADJUSTMENT">Adjustment (count correction)</option>
        </select>
      </div>
      <div className="field">
        <label htmlFor={ids.delta}>Quantity change</label>
        <input
          id={ids.delta}
          type="number"
          inputMode="numeric"
          required
          value={delta}
          aria-invalid={errors.some((error) => error.path === 'quantityDelta')}
          aria-describedby={errors.length > 0 ? ids.errors : undefined}
          onChange={(event) => setDelta(event.target.value)}
        />
      </div>
      <div className="field">
        <label htmlFor={ids.reason}>Reason</label>
        <input id={ids.reason} required minLength={3} maxLength={500} value={reason} onChange={(event) => setReason(event.target.value)} />
      </div>
      <FieldErrors id={ids.errors} errors={errors} />
      <button type="submit" disabled={fetching}>
        {fetching ? 'Saving…' : 'Save change'}
      </button>
      <p role="status" aria-live="polite">
        {message}
      </p>
    </form>
  );
}
