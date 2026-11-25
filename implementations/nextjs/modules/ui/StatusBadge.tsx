import type { OrderStatus } from '@ofl/graphql-types';
import { ORDER_STATUS_LABELS } from './format';

export function OrderStatusBadge({ status }: { readonly status: OrderStatus }) {
  return <span className={`badge badge-${status.toLowerCase()}`}>{ORDER_STATUS_LABELS[status]}</span>;
}
