// Allowed status transitions. Each entity has its own table so that the
// rules are easy to read and to test. Services call assertTransition()
// inside the transaction that holds the row lock, so the check and the
// update see the same state.

export const ORDER_STATUSES = ['PENDING_PAYMENT', 'CONFIRMED', 'PARTIALLY_SHIPPED', 'SHIPPED', 'CANCELLED'] as const;
export type OrderStatus = (typeof ORDER_STATUSES)[number];

export const RESERVATION_STATUSES = ['ACTIVE', 'CONFIRMED', 'SHIPPED', 'RELEASED'] as const;
export type ReservationStatus = (typeof RESERVATION_STATUSES)[number];

export const PAYMENT_STATUSES = ['PENDING', 'CAPTURED', 'DECLINED', 'PARTIALLY_REFUNDED', 'REFUNDED'] as const;
export type PaymentStatus = (typeof PAYMENT_STATUSES)[number];

export const RETURN_STATUSES = ['REQUESTED', 'RECEIVED', 'REFUNDED'] as const;
export type ReturnStatus = (typeof RETURN_STATUSES)[number];

export const CANCELLATION_REASONS = ['CUSTOMER_REQUEST', 'PAYMENT_DECLINED', 'RESERVATION_EXPIRED', 'OPERATOR_REQUEST'] as const;
export type CancellationReason = (typeof CANCELLATION_REASONS)[number];

type TransitionTable<S extends string> = Readonly<Record<S, readonly S[]>>;

export const ORDER_TRANSITIONS: TransitionTable<OrderStatus> = {
  PENDING_PAYMENT: ['CONFIRMED', 'CANCELLED'],
  CONFIRMED: ['PARTIALLY_SHIPPED', 'SHIPPED', 'CANCELLED'],
  PARTIALLY_SHIPPED: ['SHIPPED'],
  SHIPPED: [],
  CANCELLED: [],
};

export const RESERVATION_TRANSITIONS: TransitionTable<ReservationStatus> = {
  ACTIVE: ['CONFIRMED', 'RELEASED'],
  CONFIRMED: ['SHIPPED', 'RELEASED'],
  SHIPPED: [],
  RELEASED: [],
};

export const PAYMENT_TRANSITIONS: TransitionTable<PaymentStatus> = {
  PENDING: ['CAPTURED', 'DECLINED'],
  CAPTURED: ['PARTIALLY_REFUNDED', 'REFUNDED'],
  PARTIALLY_REFUNDED: ['PARTIALLY_REFUNDED', 'REFUNDED'],
  DECLINED: [],
  REFUNDED: [],
};

export const RETURN_TRANSITIONS: TransitionTable<ReturnStatus> = {
  REQUESTED: ['RECEIVED'],
  RECEIVED: ['REFUNDED'],
  REFUNDED: [],
};

export function canTransition<S extends string>(table: TransitionTable<S>, from: S, to: S): boolean {
  return table[from].includes(to);
}

export class InvalidTransitionError extends Error {
  constructor(
    readonly entity: string,
    readonly from: string,
    readonly to: string,
  ) {
    super(`${entity} cannot move from ${from} to ${to}`);
    this.name = 'InvalidTransitionError';
  }
}

export function assertTransition<S extends string>(entity: string, table: TransitionTable<S>, from: S, to: S): void {
  if (!canTransition(table, from, to)) {
    throw new InvalidTransitionError(entity, from, to);
  }
}

/** Order status after a shipment, given how many reservations remain unshipped. */
export function orderStatusAfterShipment(unshippedConfirmedReservations: number): OrderStatus {
  return unshippedConfirmedReservations === 0 ? 'SHIPPED' : 'PARTIALLY_SHIPPED';
}

/** Payment status after a refund of refundedMinor out of amountMinor. */
export function paymentStatusAfterRefund(amountMinor: number, refundedMinor: number): PaymentStatus {
  return refundedMinor >= amountMinor ? 'REFUNDED' : 'PARTIALLY_REFUNDED';
}
