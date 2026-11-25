'use client';

import { useId, useState, type FormEvent } from 'react';
import { useRouter } from 'next/navigation';
import { useMutation } from 'urql';
import { CheckoutDocument } from '@ofl/graphql-types';
import { checkoutInputSchema } from '@ofl/domain';
import { acceptPrices, clearCart, removeLine, setQuantity } from '../cart/cart-slice';
import { useAppDispatch, useAppSelector, useAppStore } from '../store/hooks';
import { toastShown } from '../ui/toast-slice';
import { FieldErrors } from '../ui/FieldErrors';
import type { FieldError } from '../graphql/errors';
import {
  attemptFailedInTransit,
  attemptReset,
  attemptSettled,
  attemptStarted,
  checkoutSignature,
} from './checkout-slice';
import { interpretCheckout, type CheckoutOutcome } from './checkout-outcome';
import { CheckoutFeedback } from './CheckoutFeedback';

export const PAYMENT_TOKENS = [
  { value: 'tok_approve', label: 'Test card: approved' },
  { value: 'tok_decline', label: 'Test card: declined' },
  { value: 'tok_slow_approve', label: 'Test card: approved after the hold expires' },
] as const;

type PaymentToken = (typeof PAYMENT_TOKENS)[number]['value'];

export function CheckoutPanel() {
  const dispatch = useAppDispatch();
  const store = useAppStore();
  const router = useRouter();
  const lines = useAppSelector((state) => state.cart.lines);
  const phase = useAppSelector((state) => state.checkout.phase);
  const [, executeCheckout] = useMutation(CheckoutDocument);
  const [paymentToken, setPaymentToken] = useState<PaymentToken>('tok_approve');
  const [outcome, setOutcome] = useState<CheckoutOutcome | null>(null);
  const [validationErrors, setValidationErrors] = useState<readonly FieldError[]>([]);
  const tokenId = useId();
  const submitting = phase === 'submitting';

  async function placeOrder(): Promise<void> {
    const checkoutLines = lines.map((line) => ({
      skuId: line.skuId,
      quantity: line.quantity,
      expectedUnitPriceMinor: line.unitPriceMinor,
    }));
    dispatch(attemptStarted({ signature: checkoutSignature({ lines: checkoutLines, paymentToken }), newKey: crypto.randomUUID() }));
    const idempotencyKey = store.getState().checkout.idempotencyKey ?? crypto.randomUUID();
    const input = { idempotencyKey, lines: checkoutLines, paymentToken };

    // Same schema as the server, so obvious mistakes are reported without a round trip.
    const parsed = checkoutInputSchema.safeParse(input);
    if (!parsed.success) {
      dispatch(attemptSettled());
      setOutcome(null);
      setValidationErrors(parsed.error.issues.map((issue) => ({ path: issue.path.join('.') || '(root)', message: issue.message })));
      return;
    }
    setValidationErrors([]);

    const result = await executeCheckout({ input });
    const next = interpretCheckout(result);
    setOutcome(next);
    applyOutcome(next);
  }

  function applyOutcome(next: CheckoutOutcome): void {
    switch (next.kind) {
      case 'succeeded':
        dispatch(clearCart());
        dispatch(attemptReset());
        dispatch(toastShown({ tone: 'success', message: `Order ${next.orderNumber} placed.` }));
        // Re-render server components that show orders or stock.
        router.refresh();
        return;
      case 'network-error':
        dispatch(attemptFailedInTransit());
        return;
      case 'key-reused':
        dispatch(attemptReset());
        return;
      default:
        dispatch(attemptSettled());
    }
  }

  function submit(event: FormEvent<HTMLFormElement>): void {
    event.preventDefault();
    if (!submitting) void placeOrder();
  }

  function applyAvailableQuantities(): void {
    if (outcome?.kind !== 'insufficient-stock') return;
    for (const line of outcome.lines) {
      if (line.available > 0) dispatch(setQuantity({ skuId: line.skuId, quantity: line.available }));
      else dispatch(removeLine({ skuId: line.skuId }));
    }
    setOutcome(null);
  }

  function acceptNewPrices(): void {
    if (outcome?.kind !== 'price-changed') return;
    dispatch(acceptPrices(outcome.lines.map((line) => ({ skuId: line.skuId, unitPriceMinor: line.currentUnitPriceMinor }))));
    setOutcome(null);
  }

  return (
    <div className="checkout">
      {(lines.length > 0 || outcome === null) && (
        <form onSubmit={submit} aria-describedby={validationErrors.length > 0 ? 'checkout-validation' : undefined}>
          <div className="field">
            <label htmlFor={tokenId}>Payment method</label>
            <select id={tokenId} value={paymentToken} onChange={(event) => setPaymentToken(event.target.value as PaymentToken)}>
              {PAYMENT_TOKENS.map((token) => (
                <option key={token.value} value={token.value}>
                  {token.label}
                </option>
              ))}
            </select>
          </div>
          <FieldErrors id="checkout-validation" errors={validationErrors} />
          <button type="submit" disabled={submitting || lines.length === 0} aria-disabled={submitting || lines.length === 0}>
            {submitting ? 'Placing order…' : 'Place order'}
          </button>
        </form>
      )}
      <p className="visually-hidden" role="status" aria-live="polite">
        {submitting ? 'Placing your order, please wait.' : ''}
      </p>
      {outcome && (
        <CheckoutFeedback
          outcome={outcome}
          cartLines={lines}
          onRetry={() => void placeOrder()}
          onApplyAvailableQuantities={applyAvailableQuantities}
          onAcceptPrices={acceptNewPrices}
          onStartNewAttempt={() => {
            dispatch(attemptReset());
            setOutcome(null);
          }}
        />
      )}
    </div>
  );
}
