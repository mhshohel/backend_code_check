import { formatMoney } from '@ofl/domain';
import { Link } from 'react-router';
import { Button, ErrorAlert } from '../../components';
import type { CartLine } from '../cart/cartSlice';
import type { CheckoutFeedback, CheckoutResult } from './useCheckout';

type FeedbackProps = {
  feedback: CheckoutFeedback;
  lines: readonly CartLine[];
  onAcceptPrices: (changes: Array<{ skuId: string; unitPriceMinor: number }>) => void;
  onLimitQuantities: (limits: Array<{ skuId: string; available: number }>) => void;
};

function lineName(lines: readonly CartLine[], skuId: string): string {
  const line = lines.find((l) => l.skuId === skuId);
  return line ? `${line.productName} (${line.skuLabel})` : skuId;
}

/** Explains each checkout outcome and offers the matching next step. */
export function CheckoutFeedbackView({ feedback, lines, onAcceptPrices, onLimitQuantities }: FeedbackProps) {
  switch (feedback.kind) {
    case 'none':
      return null;
    case 'invalid':
      return (
        <ErrorAlert title="Please check your cart">
          <ul>
            {feedback.messages.map((message) => (
              <li key={message}>{message}</li>
            ))}
          </ul>
        </ErrorAlert>
      );
    case 'error':
      return <ErrorView code={feedback.error.code} message={feedback.error.message} />;
    case 'result':
      return <ResultView result={feedback.result} lines={lines} onAcceptPrices={onAcceptPrices} onLimitQuantities={onLimitQuantities} />;
  }
}

function ErrorView({ code, message }: { code: string; message: string }) {
  if (code === 'NETWORK_ERROR') {
    return (
      <ErrorAlert title="Checkout did not complete">
        {message} Your order may already have been placed. Retrying is safe: the same checkout key is sent again, so you
        will not be charged twice.
      </ErrorAlert>
    );
  }
  if (code === 'UNAUTHENTICATED') {
    return (
      <ErrorAlert title="Sign in required">
        {message} <Link to="/login?next=%2Fcart">Sign in</Link>
      </ErrorAlert>
    );
  }
  return <ErrorAlert title="Checkout failed">{message}</ErrorAlert>;
}

type ResultViewProps = Omit<FeedbackProps, 'feedback'> & { result: CheckoutResult };

function ResultView({ result, lines, onAcceptPrices, onLimitQuantities }: ResultViewProps) {
  switch (result.__typename) {
    case 'CheckoutSucceeded':
      return null;
    case 'PriceChanged':
      return (
        <ErrorAlert title="Prices changed">
          <p>{result.message}</p>
          <ul>
            {result.lines.map((line) => (
              <li key={line.skuId}>
                {lineName(lines, line.skuId)}: was {formatMoney(line.expectedUnitPriceMinor)}, now {line.currentUnitPrice.formatted}
              </li>
            ))}
          </ul>
          <Button
            variant="primary"
            onClick={() => onAcceptPrices(result.lines.map((l) => ({ skuId: l.skuId, unitPriceMinor: l.currentUnitPrice.amountMinor })))}
          >
            Update cart prices
          </Button>
        </ErrorAlert>
      );
    case 'InsufficientStock':
      return (
        <ErrorAlert title="Not enough stock">
          <p>{result.message}</p>
          <ul>
            {result.lines.map((line) => (
              <li key={line.skuId}>
                {lineName(lines, line.skuId)}: you asked for {line.requested}, {line.available} available
              </li>
            ))}
          </ul>
          <Button onClick={() => onLimitQuantities(result.lines.map((l) => ({ skuId: l.skuId, available: l.available })))}>
            Reduce to available quantities
          </Button>
        </ErrorAlert>
      );
    case 'IdempotencyKeyReused':
      return (
        <ErrorAlert title="Checkout already submitted">
          {result.message} Review your cart and place the order again; a new checkout will be started.
        </ErrorAlert>
      );
  }
}
