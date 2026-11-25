const LABELS: Record<string, string> = {
  PENDING_PAYMENT: 'Payment pending',
  CONFIRMED: 'Confirmed',
  PARTIALLY_SHIPPED: 'Partially shipped',
  SHIPPED: 'Shipped',
  CANCELLED: 'Cancelled',
  PENDING: 'Pending',
  CAPTURED: 'Captured',
  DECLINED: 'Declined',
  PARTIALLY_REFUNDED: 'Partially refunded',
  REFUNDED: 'Refunded',
  REQUESTED: 'Requested',
  RECEIVED: 'Received',
  ACTIVE: 'Held',
  RELEASED: 'Released',
  PROCESSING: 'Processing',
  DONE: 'Done',
  FAILED: 'Failed',
};

export function humanize(value: string): string {
  return LABELS[value] ?? value.charAt(0) + value.slice(1).toLowerCase().replaceAll('_', ' ');
}

/** Shows an enum value from the server as a readable badge. */
export function StatusBadge({ status }: { status: string }) {
  return <span className={`badge badge-${status.toLowerCase().replaceAll('_', '-')}`}>{humanize(status)}</span>;
}
