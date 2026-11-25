import { describe, expect, it } from '@jest/globals';
import { checkReturnQuantities, isCancellable, isReturnableStatus, returnableQuantity } from '../src/eligibility';
import { isReservationExpired, reservationExpiry } from '../src/reservations';

describe('cancellation eligibility', () => {
  it('allows cancellation before any shipment', () => {
    expect(isCancellable({ status: 'PENDING_PAYMENT', shipmentCount: 0 })).toBe(true);
    expect(isCancellable({ status: 'CONFIRMED', shipmentCount: 0 })).toBe(true);
  });

  it('refuses cancellation after a shipment or in a final state', () => {
    expect(isCancellable({ status: 'CONFIRMED', shipmentCount: 1 })).toBe(false);
    expect(isCancellable({ status: 'PARTIALLY_SHIPPED', shipmentCount: 1 })).toBe(false);
    expect(isCancellable({ status: 'CANCELLED', shipmentCount: 0 })).toBe(false);
  });
});

describe('return eligibility', () => {
  const lines = [
    { orderLineId: 'l1', shippedQuantity: 3, returnedQuantity: 1 },
    { orderLineId: 'l2', shippedQuantity: 0, returnedQuantity: 0 },
  ];

  it('limits returns to shipped units that are not already returned', () => {
    expect(returnableQuantity(lines[0]!)).toBe(2);
    expect(checkReturnQuantities([{ orderLineId: 'l1', quantity: 2 }], lines)).toEqual({ kind: 'ok' });
  });

  it('reports every line that exceeds the returnable quantity', () => {
    expect(
      checkReturnQuantities(
        [
          { orderLineId: 'l1', quantity: 3 },
          { orderLineId: 'l2', quantity: 1 },
          { orderLineId: 'unknown', quantity: 1 },
        ],
        lines,
      ),
    ).toEqual({
      kind: 'exceeded',
      lines: [
        { orderLineId: 'l1', requested: 3, returnable: 2 },
        { orderLineId: 'l2', requested: 1, returnable: 0 },
        { orderLineId: 'unknown', requested: 1, returnable: 0 },
      ],
    });
  });

  it('only accepts returns for shipped orders', () => {
    expect(isReturnableStatus('CONFIRMED')).toBe(false);
    expect(isReturnableStatus('PARTIALLY_SHIPPED')).toBe(true);
  });
});

describe('reservation expiration', () => {
  it('expires exactly at expires_at', () => {
    const now = new Date('2026-01-01T00:00:00.000Z');
    const expiresAt = reservationExpiry(now, 60);
    expect(expiresAt.toISOString()).toBe('2026-01-01T00:01:00.000Z');
    expect(isReservationExpired(expiresAt, new Date('2026-01-01T00:00:59.999Z'))).toBe(false);
    expect(isReservationExpired(expiresAt, new Date('2026-01-01T00:01:00.000Z'))).toBe(true);
  });
});
