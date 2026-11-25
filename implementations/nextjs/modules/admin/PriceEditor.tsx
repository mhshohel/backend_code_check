'use client';

import { useActionState, useId } from 'react';
import { updateSkuPriceAction, type PriceUpdateState } from './actions';

type Props = { readonly skuId: string; readonly skuCode: string; readonly currentPriceMinor: number };

export function PriceEditor({ skuId, skuCode, currentPriceMinor }: Props) {
  const [state, formAction, pending] = useActionState<PriceUpdateState, FormData>(updateSkuPriceAction, { status: 'idle' });
  const priceId = useId();
  const statusId = useId();
  return (
    <form action={formAction} className="inline-form" aria-label={`Change price of ${skuCode}`}>
      <input type="hidden" name="skuId" value={skuId} />
      <label htmlFor={priceId}>New price for {skuCode} (USD)</label>
      <input
        id={priceId}
        name="price"
        type="number"
        min="0"
        step="0.01"
        required
        defaultValue={(currentPriceMinor / 100).toFixed(2)}
        aria-describedby={statusId}
        aria-invalid={state.status === 'error'}
      />
      <button type="submit" disabled={pending}>
        {pending ? 'Saving…' : 'Update price'}
      </button>
      <span id={statusId} role="status" aria-live="polite" className={state.status === 'error' ? 'error-text' : undefined}>
        {state.status === 'idle' ? '' : state.message}
      </span>
    </form>
  );
}
