import type { OperationResult } from '@urql/core';
import type { CheckoutMutation, CheckoutMutationVariables, OrderStatus } from '@ofl/graphql-types';
import { describeError, type DescribedError } from '../graphql/errors';

// Translates the mutation response into a UI outcome. Every member of the
// CheckoutResult union and every transport failure has its own branch; the
// `never` check makes a new union member a compile error here.

export type CheckoutOutcome =
  | {
      kind: 'succeeded';
      orderId: string;
      orderNumber: string;
      status: OrderStatus;
      totalFormatted: string;
      reservationExpiresAt: string;
      replayed: boolean;
    }
  | { kind: 'insufficient-stock'; message: string; lines: ReadonlyArray<{ skuId: string; requested: number; available: number }> }
  | {
      kind: 'price-changed';
      message: string;
      lines: ReadonlyArray<{ skuId: string; expectedUnitPriceMinor: number; currentUnitPriceMinor: number; currentFormatted: string }>;
    }
  | { kind: 'key-reused'; message: string }
  | { kind: 'network-error'; error: DescribedError }
  | { kind: 'request-error'; error: DescribedError };

export function interpretCheckout(result: OperationResult<CheckoutMutation, CheckoutMutationVariables>): CheckoutOutcome {
  if (result.error) {
    const error = describeError(result.error);
    return error.kind === 'network' ? { kind: 'network-error', error } : { kind: 'request-error', error };
  }
  const payload = result.data?.checkout;
  if (!payload) {
    return { kind: 'network-error', error: { kind: 'network', message: 'The server returned no result.', fieldErrors: [] } };
  }
  switch (payload.__typename) {
    case 'CheckoutSucceeded':
      return {
        kind: 'succeeded',
        orderId: payload.order.id,
        orderNumber: payload.order.number,
        status: payload.order.status,
        totalFormatted: payload.order.total.formatted,
        reservationExpiresAt: payload.order.reservationExpiresAt,
        replayed: payload.replayed,
      };
    case 'InsufficientStock':
      return { kind: 'insufficient-stock', message: payload.message, lines: payload.lines };
    case 'PriceChanged':
      return {
        kind: 'price-changed',
        message: payload.message,
        lines: payload.lines.map((line) => ({
          skuId: line.skuId,
          expectedUnitPriceMinor: line.expectedUnitPriceMinor,
          currentUnitPriceMinor: line.currentUnitPrice.amountMinor,
          currentFormatted: line.currentUnitPrice.formatted,
        })),
      };
    case 'IdempotencyKeyReused':
      return { kind: 'key-reused', message: payload.message };
    default:
      return assertNever(payload);
  }
}

function assertNever(value: never): never {
  throw new Error(`Unhandled checkout result: ${JSON.stringify(value)}`);
}
