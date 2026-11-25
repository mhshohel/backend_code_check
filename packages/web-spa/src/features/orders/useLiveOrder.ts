import {
  OrderDetailDocument,
  OrderUpdatedDocument,
  type OrderDetailFieldsFragment,
  type OrderUpdatedSubscription,
} from '@ofl/graphql-types';
import type { CombinedError } from '@urql/core';
import { useQuery, useSubscription } from 'urql';

export type OrderDetail = OrderDetailFieldsFragment;

export type LiveOrder = {
  order: OrderDetail | null | undefined;
  fetching: boolean;
  error: CombinedError | undefined;
  /** Error of the live subscription only (the page still shows the last known state). */
  liveError: CombinedError | undefined;
};

function newer(a: OrderDetail | undefined, b: OrderDetail | undefined): OrderDetail | undefined {
  if (!a) return b;
  if (!b) return a;
  return Date.parse(b.updatedAt) > Date.parse(a.updatedAt) ? b : a;
}

/** Subscription reducer: an event delivered late never replaces a newer state. */
function keepNewest(previous: OrderDetail | undefined, event: OrderUpdatedSubscription): OrderDetail | undefined {
  return newer(previous, event.orderUpdated.order);
}

/**
 * Order detail plus live updates. The query gives the first render; the
 * OrderUpdated subscription sends the current state on (re)subscribe and on
 * every change. Whichever copy has the later updatedAt wins, so a refetch
 * after a mutation and a pushed event can arrive in either order.
 */
export function useLiveOrder(orderId: string): LiveOrder {
  const [query] = useQuery({ query: OrderDetailDocument, variables: { id: orderId } });
  const exists = Boolean(query.data?.order);
  const [subscription] = useSubscription<OrderUpdatedSubscription, OrderDetail | undefined>(
    { query: OrderUpdatedDocument, variables: { orderId }, pause: !exists },
    keepNewest,
  );
  const pushed = subscription.data;
  const order = query.data ? (newer(pushed, query.data.order ?? undefined) ?? null) : undefined;
  return { order, fetching: query.fetching, error: query.error, liveError: subscription.error };
}
