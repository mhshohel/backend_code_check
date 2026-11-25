import { formatMoney } from '@ofl/domain';
import type { OrderStatus } from '@ofl/graphql-types';

const dateTimeFormat = new Intl.DateTimeFormat('en-US', {
  dateStyle: 'medium',
  timeStyle: 'short',
  timeZone: 'UTC',
});

/** Server and client render the same text (UTC), so hydration never mismatches. */
export function formatDateTime(iso: string): string {
  return `${dateTimeFormat.format(new Date(iso))} UTC`;
}

export function formatMinor(amountMinor: number): string {
  return formatMoney(amountMinor);
}

export const ORDER_STATUS_LABELS: Record<OrderStatus, string> = {
  PENDING_PAYMENT: 'Pending payment',
  CONFIRMED: 'Confirmed',
  PARTIALLY_SHIPPED: 'Partially shipped',
  SHIPPED: 'Shipped',
  CANCELLED: 'Cancelled',
};

export function humanize(value: string): string {
  const lower = value.toLowerCase().replaceAll('_', ' ');
  return lower.charAt(0).toUpperCase() + lower.slice(1);
}
