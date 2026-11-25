'use client';

import { useEffect, useRef, type RefObject } from 'react';
import Link from 'next/link';
import type { CartLine } from '../cart/cart-slice';
import { FieldErrors } from '../ui/FieldErrors';
import { formatDateTime, formatMinor } from '../ui/format';
import type { CheckoutOutcome } from './checkout-outcome';

type Props = {
  readonly outcome: CheckoutOutcome;
  readonly cartLines: readonly CartLine[];
  readonly onRetry: () => void;
  readonly onApplyAvailableQuantities: () => void;
  readonly onAcceptPrices: () => void;
  readonly onStartNewAttempt: () => void;
};

function lineName(lines: readonly CartLine[], skuId: string): string {
  const line = lines.find((candidate) => candidate.skuId === skuId);
  return line ? `${line.productName} (${line.skuLabel})` : skuId;
}

/** Feedback for one checkout attempt. Focus moves to the heading so keyboard and screen-reader users land on it. */
export function CheckoutFeedback(props: Props) {
  const headingRef = useRef<HTMLHeadingElement>(null);
  useEffect(() => headingRef.current?.focus(), [props.outcome]);

  return (
    <section className={`feedback feedback-${props.outcome.kind}`} aria-labelledby="checkout-feedback-heading">
      <FeedbackBody {...props} headingRef={headingRef} />
    </section>
  );
}

function FeedbackBody({
  outcome,
  cartLines,
  onRetry,
  onApplyAvailableQuantities,
  onAcceptPrices,
  onStartNewAttempt,
  headingRef,
}: Props & { headingRef: RefObject<HTMLHeadingElement | null> }) {
  const heading = (text: string) => (
    <h2 id="checkout-feedback-heading" tabIndex={-1} ref={headingRef}>
      {text}
    </h2>
  );

  switch (outcome.kind) {
    case 'succeeded':
      return (
        <>
          {heading(outcome.replayed ? `Order ${outcome.orderNumber} was already placed` : `Order ${outcome.orderNumber} placed`)}
          {outcome.replayed && <p>We had already received this checkout, so no second order was created.</p>}
          <p>
            Total {outcome.totalFormatted}. Payment is being processed; your items are reserved until{' '}
            {formatDateTime(outcome.reservationExpiresAt)}.
          </p>
          <p>
            <Link href={`/orders/${outcome.orderId}`}>Follow the order status live</Link>
          </p>
        </>
      );
    case 'insufficient-stock':
      return (
        <>
          {heading('Some items are no longer available in that quantity')}
          <p>{outcome.message} Nothing was reserved or charged.</p>
          <ul>
            {outcome.lines.map((line) => (
              <li key={line.skuId}>
                {lineName(cartLines, line.skuId)}: you asked for {line.requested}, {line.available} available.
              </li>
            ))}
          </ul>
          <button type="button" onClick={onApplyAvailableQuantities}>
            Reduce to available quantities
          </button>
        </>
      );
    case 'price-changed':
      return (
        <>
          {heading('Prices changed since you added these items')}
          <p>{outcome.message} Nothing was reserved or charged.</p>
          <ul>
            {outcome.lines.map((line) => (
              <li key={line.skuId}>
                {lineName(cartLines, line.skuId)}: was {formatMinor(line.expectedUnitPriceMinor)}, now {line.currentFormatted}.
              </li>
            ))}
          </ul>
          <button type="button" onClick={onAcceptPrices}>
            Accept new prices
          </button>
        </>
      );
    case 'key-reused':
      return (
        <>
          {heading('This checkout attempt conflicts with an earlier one')}
          <p>{outcome.message} Review your cart and place the order again.</p>
          <button type="button" onClick={onStartNewAttempt}>
            Start a new checkout
          </button>
        </>
      );
    case 'network-error':
      return (
        <>
          {heading('We could not confirm your order')}
          <p>
            {outcome.error.message} Retrying is safe: the retry uses the same checkout key, so you will not be charged
            twice.
          </p>
          <button type="button" onClick={onRetry}>
            Retry checkout
          </button>
        </>
      );
    case 'request-error':
      return (
        <>
          {heading('Checkout failed')}
          <p>{outcome.error.message}</p>
          {outcome.error.kind === 'unauthenticated' && (
            <p>
              <Link href="/login?next=/cart">Sign in again</Link>
            </p>
          )}
          <FieldErrors id="checkout-field-errors" errors={outcome.error.fieldErrors} />
        </>
      );
    default:
      return null;
  }
}
