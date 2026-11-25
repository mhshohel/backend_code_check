import type { OrderDetailFieldsFragment, ProductDetailQuery, SearchProductsQuery } from '@ofl/graphql-types';

export const ids = {
  sku1: '11111111-1111-4111-8111-111111111111',
  sku2: '22222222-2222-4222-8222-222222222222',
  order: '33333333-3333-4333-8333-333333333333',
  line1: '44444444-4444-4444-8444-444444444444',
  east: '55555555-5555-4555-8555-555555555555',
  west: '66666666-6666-4666-8666-666666666666',
  ret: '77777777-7777-4777-8777-777777777777',
};

export function money(amountMinor: number) {
  return { amountMinor, currency: 'USD', formatted: `$${(amountMinor / 100).toFixed(2)}` };
}

export const east = { id: ids.east, code: 'WH-EAST', name: 'East' };
export const west = { id: ids.west, code: 'WH-WEST', name: 'West' };

export function searchResult(names: string[] = ['Trail Mug', 'Camp Kettle'], hasNextPage = false): SearchProductsQuery {
  return {
    searchProducts: {
      totalCount: names.length,
      edges: names.map((name, index) => ({
        cursor: `c-${name}`,
        node: {
          productId: `p-${index}`,
          slug: name.toLowerCase().replaceAll(' ', '-'),
          name,
          categorySlug: 'kitchen',
          categoryName: 'Kitchen',
          inStock: true,
          score: 1,
          fromPrice: money(1250),
        },
      })),
      pageInfo: { hasNextPage, endCursor: hasNextPage ? 'cursor-2' : null },
      facets: {
        categories: [
          { value: 'kitchen', label: 'Kitchen', count: 2, selected: false },
          { value: 'outdoor', label: 'Outdoor', count: 5, selected: false },
        ],
        priceRanges: [
          { value: '0-2500', label: 'Under $25', count: 2, selected: false },
          { value: '2500-5000', label: '$25 to $50', count: 0, selected: false },
        ],
        availability: [
          { value: 'in_stock', label: 'In stock', count: 2, selected: false },
          { value: 'out_of_stock', label: 'Out of stock', count: 0, selected: false },
        ],
      },
    },
  };
}

export function productDetail(): ProductDetailQuery {
  return {
    product: {
      id: 'p-1',
      slug: 'trail-mug',
      name: 'Trail Mug',
      description: 'An enamel mug.',
      availableQuantity: 7,
      category: { id: 'c-1', slug: 'kitchen', name: 'Kitchen' },
      fromPrice: money(1250),
      skus: [
        {
          id: ids.sku1,
          code: 'MUG-BLUE',
          label: 'Blue',
          availableQuantity: 7,
          price: money(1250),
          stock: [
            { warehouse: east, onHand: 5, reserved: 1, available: 4 },
            { warehouse: west, onHand: 3, reserved: 0, available: 3 },
          ],
        },
      ],
    },
  };
}

export function orderDetail(overrides: Partial<OrderDetailFieldsFragment> = {}): OrderDetailFieldsFragment {
  return {
    id: ids.order,
    number: 'ORD-100042',
    status: 'PENDING_PAYMENT',
    cancellationReason: null,
    createdAt: '2026-11-25T10:00:00.000Z',
    updatedAt: '2026-11-25T10:00:00.000Z',
    reservationExpiresAt: '2026-11-25T10:15:00.000Z',
    customer: { id: 'u-customer', email: 'customer@example.com', displayName: 'Casey Customer' },
    subtotal: money(2500),
    total: money(2500),
    lines: [
      {
        id: ids.line1,
        lineNumber: 1,
        productName: 'Trail Mug',
        skuCode: 'MUG-BLUE',
        quantity: 2,
        shippedQuantity: 0,
        returnedQuantity: 0,
        returnableQuantity: 0,
        unitPrice: money(1250),
        lineTotal: money(2500),
        sku: { id: ids.sku1, product: { slug: 'trail-mug' } },
      },
    ],
    reservations: [],
    payment: { id: 'pay-1', status: 'PENDING', declineReason: null, amount: money(2500), refunded: money(0) },
    shipments: [],
    returns: [],
    allowedActions: { canCancel: true, canRequestReturn: false, shippableWarehouses: [], receivableReturnIds: [] },
    ...overrides,
  };
}
