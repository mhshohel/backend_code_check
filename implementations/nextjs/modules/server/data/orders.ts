import 'server-only';
import {
  MyOrdersDocument,
  OrderDetailDocument,
  type MyOrdersQuery,
  type OrderDetailFieldsFragment,
} from '@ofl/graphql-types';
import { queryAsViewer } from './execute';

// Per-user data: always executed as the signed-in viewer, never wrapped in a
// data cache. Pages that call these read cookies() first, which makes them
// dynamic (rendered per request, never stored in the full route cache).

export const ORDERS_PAGE_SIZE = 20;

export async function loadMyOrders(after: string | null): Promise<MyOrdersQuery['myOrders']> {
  const result = await queryAsViewer(
    MyOrdersDocument,
    { first: ORDERS_PAGE_SIZE, after },
    { returnTo: '/orders' },
  );
  return result.myOrders;
}

export async function loadOrder(id: string): Promise<OrderDetailFieldsFragment | null> {
  const result = await queryAsViewer(OrderDetailDocument, { id }, { returnTo: `/orders/${id}` });
  return result.order;
}
