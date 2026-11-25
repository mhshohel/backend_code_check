import type { OrderDetailFieldsFragment } from '@ofl/graphql-types';

export const SKU_A = '11111111-1111-4111-8111-111111111111';
export const SKU_B = '22222222-2222-4222-8222-222222222222';
export const ORDER_ID = '33333333-3333-4333-8333-333333333333';
export const LINE_ID = '44444444-4444-4444-8444-444444444444';
export const WH_EAST = '55555555-5555-4555-8555-555555555555';
export const RETURN_ID = '66666666-6666-4666-8666-666666666666';

const money = (amountMinor: number) => ({
  amountMinor,
  currency: 'USD',
  formatted: `$${(amountMinor / 100).toFixed(2)}`,
});

export function makeOrder(overrides: Partial<OrderDetailFieldsFragment> = {}): OrderDetailFieldsFragment {
  return {
    id: ORDER_ID,
    number: 'ORD-100042',
    status: 'PENDING_PAYMENT',
    cancellationReason: null,
    createdAt: '2026-11-25T10:00:00.000Z',
    updatedAt: '2026-11-25T10:00:00.000Z',
    reservationExpiresAt: '2026-11-25T10:15:00.000Z',
    customer: { id: 'c1', email: 'customer@example.com', displayName: 'Casey Customer' },
    subtotal: money(5998),
    total: money(5998),
    lines: [
      {
        id: LINE_ID,
        lineNumber: 1,
        productName: 'Desk lamp',
        skuCode: 'LAMP-L',
        quantity: 2,
        unitPrice: money(2999),
        lineTotal: money(5998),
        shippedQuantity: 0,
        returnedQuantity: 0,
        returnableQuantity: 0,
        sku: { id: SKU_A, product: { slug: 'desk-lamp' } },
      },
    ],
    reservations: [],
    payment: { id: 'p1', status: 'PENDING', amount: money(5998), refunded: money(0), declineReason: null },
    shipments: [],
    returns: [],
    allowedActions: { canCancel: true, canRequestReturn: false, shippableWarehouses: [], receivableReturnIds: [] },
    ...overrides,
  };
}
