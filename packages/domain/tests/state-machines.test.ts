import { describe, expect, it } from '@jest/globals';
import {
  assertTransition,
  canTransition,
  InvalidTransitionError,
  ORDER_TRANSITIONS,
  orderStatusAfterShipment,
  PAYMENT_TRANSITIONS,
  paymentStatusAfterRefund,
  RESERVATION_TRANSITIONS,
  RETURN_TRANSITIONS,
} from '../src/state-machines';

describe('order transitions', () => {
  it.each([
    ['PENDING_PAYMENT', 'CONFIRMED', true],
    ['PENDING_PAYMENT', 'CANCELLED', true],
    ['CONFIRMED', 'CANCELLED', true],
    ['PARTIALLY_SHIPPED', 'CANCELLED', false],
    ['SHIPPED', 'CANCELLED', false],
    ['CANCELLED', 'CONFIRMED', false],
    ['PENDING_PAYMENT', 'SHIPPED', false],
  ] as const)('%s -> %s is %s', (from, to, allowed) => {
    expect(canTransition(ORDER_TRANSITIONS, from, to)).toBe(allowed);
  });

  it('throws a typed error for an invalid transition', () => {
    expect(() => assertTransition('Order', ORDER_TRANSITIONS, 'CANCELLED', 'CONFIRMED')).toThrow(InvalidTransitionError);
  });
});

describe('reservation, payment and return transitions', () => {
  it('never moves a released or shipped reservation again', () => {
    expect(RESERVATION_TRANSITIONS.RELEASED).toEqual([]);
    expect(RESERVATION_TRANSITIONS.SHIPPED).toEqual([]);
    expect(canTransition(RESERVATION_TRANSITIONS, 'ACTIVE', 'SHIPPED')).toBe(false);
  });

  it('does not allow a declined payment to be captured later', () => {
    expect(canTransition(PAYMENT_TRANSITIONS, 'DECLINED', 'CAPTURED')).toBe(false);
  });

  it('only refunds a received return', () => {
    expect(canTransition(RETURN_TRANSITIONS, 'REQUESTED', 'REFUNDED')).toBe(false);
    expect(canTransition(RETURN_TRANSITIONS, 'RECEIVED', 'REFUNDED')).toBe(true);
  });
});

describe('derived statuses', () => {
  it('marks an order shipped only when no confirmed reservation is left', () => {
    expect(orderStatusAfterShipment(1)).toBe('PARTIALLY_SHIPPED');
    expect(orderStatusAfterShipment(0)).toBe('SHIPPED');
  });

  it('computes payment status after partial and full refunds', () => {
    expect(paymentStatusAfterRefund(1000, 400)).toBe('PARTIALLY_REFUNDED');
    expect(paymentStatusAfterRefund(1000, 1000)).toBe('REFUNDED');
  });
});
