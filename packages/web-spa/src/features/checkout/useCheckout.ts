import { checkoutInputSchema } from '@ofl/domain';
import { CheckoutDocument, type CheckoutMutation } from '@ofl/graphql-types';
import type { CombinedError } from '@urql/core';
import { useState } from 'react';
import { useMutation } from 'urql';
import { useAppDispatch, useAppSelector, useAppStore } from '../../app/store';
import { describeError, type ErrorDescription } from '../../graphql/errors';
import { cartCleared } from '../cart/cartSlice';
import { attemptFinished, attemptStarted } from './checkoutSlice';

export type CheckoutResult = CheckoutMutation['checkout'];

export type CheckoutFeedback =
  | { kind: 'none' }
  | { kind: 'result'; result: CheckoutResult }
  | { kind: 'error'; error: ErrorDescription }
  | { kind: 'invalid'; messages: string[] };

function feedbackFromError(error: CombinedError): CheckoutFeedback {
  return { kind: 'error', error: describeError(error) };
}

/**
 * Checkout workflow on the client. The idempotency key lives in Redux and is
 * reused until the server answers with a CheckoutResult; a network failure
 * keeps it so the retry replays rather than duplicates the order.
 */
export function useCheckout(onSucceeded: (orderId: string, replayed: boolean) => void) {
  const dispatch = useAppDispatch();
  const store = useAppStore();
  const lines = useAppSelector((state) => state.cart.lines);
  const paymentToken = useAppSelector((state) => state.checkout.paymentToken);
  const [{ fetching }, executeCheckout] = useMutation(CheckoutDocument);
  const [feedback, setFeedback] = useState<CheckoutFeedback>({ kind: 'none' });

  async function submit() {
    dispatch(attemptStarted());
    const idempotencyKey = store.getState().checkout.idempotencyKey ?? '';
    const input = {
      idempotencyKey,
      paymentToken,
      lines: lines.map((line) => ({ skuId: line.skuId, quantity: line.quantity, expectedUnitPriceMinor: line.unitPriceMinor })),
    };
    const parsed = checkoutInputSchema.safeParse(input);
    if (!parsed.success) {
      setFeedback({ kind: 'invalid', messages: [...new Set(parsed.error.issues.map((issue) => issue.message))] });
      return;
    }
    setFeedback({ kind: 'none' });
    const response = await executeCheckout({ input }, { requestPolicy: 'network-only' });
    if (!response.data) {
      setFeedback(response.error ? feedbackFromError(response.error) : { kind: 'none' });
      return;
    }
    const result = response.data.checkout;
    // Every union member is a definitive answer for this key.
    dispatch(attemptFinished());
    if (result.__typename === 'CheckoutSucceeded') {
      dispatch(cartCleared());
      onSucceeded(result.order.id, result.replayed);
      return;
    }
    setFeedback({ kind: 'result', result });
  }

  return { submit, fetching, feedback, clearFeedback: () => setFeedback({ kind: 'none' }) };
}
