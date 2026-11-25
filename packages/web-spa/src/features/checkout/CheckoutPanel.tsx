import { useId } from 'react';
import { Button, StatusMessage } from '../../components';
import { useAppDispatch, useAppSelector } from '../../app/store';
import { pricesUpdated, quantitiesLimited } from '../cart/cartSlice';
import { paymentTokenChosen, type PaymentToken } from './checkoutSlice';
import { CheckoutFeedbackView } from './CheckoutFeedbackView';
import { useCheckout } from './useCheckout';

const PAYMENT_OPTIONS: ReadonlyArray<{ value: PaymentToken; label: string; hint: string }> = [
  { value: 'tok_approve', label: 'Test card: approve', hint: 'Payment succeeds.' },
  { value: 'tok_decline', label: 'Test card: decline', hint: 'Payment is declined and the stock is released.' },
  { value: 'tok_slow_approve', label: 'Test card: slow approve', hint: 'Payment succeeds after the reservation hold expires.' },
];

export function CheckoutPanel({ onSucceeded }: { onSucceeded: (orderId: string, replayed: boolean) => void }) {
  const dispatch = useAppDispatch();
  const lines = useAppSelector((state) => state.cart.lines);
  const paymentToken = useAppSelector((state) => state.checkout.paymentToken);
  const pendingKey = useAppSelector((state) => state.checkout.idempotencyKey);
  const { submit, fetching, feedback, clearFeedback } = useCheckout(onSucceeded);
  const groupName = useId();

  return (
    <section className="card checkout" aria-label="Checkout">
      <h2>Checkout</h2>
      <fieldset>
        <legend>Payment method</legend>
        {PAYMENT_OPTIONS.map((option) => (
          <label key={option.value} className="radio-option">
            <input
              type="radio"
              name={groupName}
              value={option.value}
              checked={paymentToken === option.value}
              onChange={() => dispatch(paymentTokenChosen(option.value))}
            />
            <span>
              {option.label} <span className="muted">— {option.hint}</span>
            </span>
          </label>
        ))}
      </fieldset>
      <CheckoutFeedbackView
        feedback={feedback}
        lines={lines}
        onAcceptPrices={(changes) => {
          dispatch(pricesUpdated(changes));
          clearFeedback();
        }}
        onLimitQuantities={(limits) => {
          dispatch(quantitiesLimited(limits));
          clearFeedback();
        }}
      />
      <Button variant="primary" busy={fetching} onClick={() => void submit()}>
        {pendingKey && !fetching ? 'Retry placing order' : 'Place order'}
      </Button>
      <StatusMessage>{fetching ? 'Reserving stock…' : ''}</StatusMessage>
    </section>
  );
}
