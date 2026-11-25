import { afterAll, afterEach, beforeAll, beforeEach, describe, expect, it } from '@jest/globals';
import {
  AdjustInventoryDocument,
  CancelOrderDocument,
  CheckoutDocument,
  MyOrdersDocument,
  OperationsSummaryDocument,
  OperatorOrdersDocument,
  OrderDetailDocument,
  ProductDetailDocument,
  RequestReturnDocument,
  ShipOrderDocument,
  ViewerDocument,
  type MyOrdersQuery,
} from '@ofl/graphql-types';
import type { ExecutionResult } from 'graphql';
import type { Services } from '../../src/services';
import {
  closeServices,
  createSku,
  createTestYoga,
  expectLedgerReconciles,
  idempotencyKey,
  resetData,
  startServices,
  tokenFor,
  WAREHOUSE_EAST,
  type BaseData,
} from '../helpers/harness';
import { authorize, placeOrder } from '../helpers/orders';

let services: Services;
let base: BaseData;
let gql: ReturnType<typeof createTestYoga>['request'];
const tokens: Record<'customer' | 'customer2' | 'operator' | 'admin', string> = { customer: '', customer2: '', operator: '', admin: '' };

beforeAll(async () => {
  services = await startServices();
  gql = createTestYoga(services).request;
});
afterAll(async () => {
  await closeServices(services);
});
beforeEach(async () => {
  base = await resetData(services);
  for (const role of ['customer', 'customer2', 'operator', 'admin'] as const) tokens[role] = await tokenFor(services, base[role]);
});
afterEach(async () => {
  await expectLedgerReconciles(services);
});

function codes(result: { errors?: readonly { extensions?: Record<string, unknown> }[] }): unknown[] {
  return (result.errors ?? []).map((e) => e.extensions?.code);
}

describe('GraphQL over Yoga', () => {
  it('returns the viewer and a product read from PostgreSQL', async () => {
    const sku = await createSku(services, base, { east: 3, west: 2, priceMinor: 1999 });
    const viewer = await gql(ViewerDocument, {}, { token: tokens.customer });
    expect(viewer.data?.viewer).toMatchObject({ email: base.customer.email, role: 'CUSTOMER' });
    const product = await gql(ProductDetailDocument, { slug: sku.slug }, {});
    expect(product.data?.product).toMatchObject({
      availableQuantity: 5,
      fromPrice: { amountMinor: 1999, currency: 'USD', formatted: '$19.99' },
    });
    expect(product.data?.product?.skus[0]?.stock.map((s) => s.warehouse.code)).toEqual(['WH-EAST', 'WH-WEST']);
  });

  it('checks out and returns the order with UTC timestamps', async () => {
    const sku = await createSku(services, base, { east: 3, priceMinor: 500 });
    const result = await gql(
      CheckoutDocument,
      { input: { idempotencyKey: idempotencyKey(), paymentToken: 'tok_approve', lines: [{ skuId: sku.skuId, quantity: 2, expectedUnitPriceMinor: 500 }] } },
      { token: tokens.customer },
    );
    const checkout = result.data?.checkout;
    if (checkout?.__typename !== 'CheckoutSucceeded') throw new Error(JSON.stringify(result));
    expect(checkout.order).toMatchObject({ status: 'PENDING_PAYMENT', total: { amountMinor: 1000 }, allowedActions: { canCancel: true } });
    expect(checkout.order.number).toMatch(/^ORD-\d+$/);
    expect(checkout.order.createdAt).toMatch(/^\d{4}-\d{2}-\d{2}T\d{2}:\d{2}:\d{2}\.\d{3}Z$/);
  });

  it('S11: customers are isolated; roles are enforced', async () => {
    const sku = await createSku(services, base, { east: 5 });
    const order = await placeOrder(services, base.customer, [{ sku, quantity: 1 }]);
    const other = { token: tokens.customer2 };
    expect(codes(await gql(OrderDetailDocument, { id: order.orderId }, other))).toEqual(['NOT_FOUND']);
    expect(codes(await gql(CancelOrderDocument, { orderId: order.orderId }, other))).toEqual(['NOT_FOUND']);
    const lineId = (await services.db.query<{ id: string }>('SELECT id FROM order_lines WHERE order_id = $1', [order.orderId])).rows[0]?.id ?? '';
    expect(codes(await gql(RequestReturnDocument, { input: { orderId: order.orderId, reason: 'Not mine', lines: [{ orderLineId: lineId, quantity: 1 }] } }, other))).toEqual([
      'NOT_FOUND',
    ]);
    expect(codes(await gql(ShipOrderDocument, { input: { orderId: order.orderId, warehouseId: WAREHOUSE_EAST } }, { token: tokens.customer }))).toEqual(['FORBIDDEN']);
    expect(
      codes(
        await gql(AdjustInventoryDocument, { input: { skuId: sku.skuId, warehouseId: WAREHOUSE_EAST, kind: 'RECEIPT', quantityDelta: 5, reason: 'nope' } }, { token: tokens.customer }),
      ),
    ).toEqual(['FORBIDDEN']);
    expect(codes(await gql(MyOrdersDocument, {}, {}))).toEqual(['UNAUTHENTICATED']);
    expect(codes(await gql(OperationsSummaryDocument, {}, { token: tokens.operator }))).toEqual(['FORBIDDEN']);
    const owner = await gql(OrderDetailDocument, { id: order.orderId }, { token: tokens.customer });
    expect(owner.data?.order?.status).toBe('PENDING_PAYMENT');
  });

  it('reports invalid input with BAD_USER_INPUT and field errors', async () => {
    const result = await gql(
      CheckoutDocument,
      { input: { idempotencyKey: 'short', paymentToken: 'tok_bogus', lines: [] } },
      { token: tokens.customer },
    );
    expect(codes(result)).toEqual(['BAD_USER_INPUT']);
    const fieldErrors = result.errors?.[0]?.extensions?.fieldErrors;
    expect(Array.isArray(fieldErrors) && fieldErrors.length).toBeGreaterThanOrEqual(2);
    expect(codes(await gql('{ nope }', {}, {}))).toEqual(['BAD_USER_INPUT']);
    expect(codes(await gql(MyOrdersDocument, { first: 51 }, { token: tokens.customer }))).toEqual(['BAD_USER_INPUT']);
  });

  it('rejects queries that are too deep or too expensive', async () => {
    const deep = '{ orders(first: 1) { edges { node { lines { sku { product { skus { product { skus { product { id } } } } } } } } } } }';
    expect(codes(await gql(deep, {}, { token: tokens.operator }))).toEqual(['QUERY_TOO_COMPLEX']);
    const costly = '{ orders(first: 50) { edges { node { lines { sku { product { skus { stock { warehouse { id } } } } } } } } } }';
    expect(codes(await gql(costly, {}, { token: tokens.operator }))).toEqual(['QUERY_TOO_COMPLEX']);
    const viaVariable = 'query($n: Int) { orders(first: $n) { edges { node { lines { sku { product { skus { stock { warehouse { id } } } } } } } } } }';
    expect(codes(await gql(viaVariable, { n: 50 }, { token: tokens.operator }))).toEqual(['QUERY_TOO_COMPLEX']);
    expect(codes(await gql(viaVariable, { n: 1 }, { token: tokens.operator }))).toEqual([]);
  });

  it('F1: 300 aliased searchProducts are rejected before any resolver runs', async () => {
    const original = services.search.search;
    let calls = 0;
    services.search.search = async (...args) => {
      calls += 1;
      return original(...args);
    };
    try {
      const query = `{ ${Array.from({ length: 300 }, (_, i) => `s${i}: searchProducts(first: 1) { totalCount }`).join(' ')} }`;
      const result = await gql(query, {}, {});
      expect(codes(result)).toEqual(['QUERY_TOO_COMPLEX']);
      expect(result.data ?? null).toBeNull();
      const aliasedProducts = `{ ${Array.from({ length: 25 }, (_, i) => `p${i}: product(slug: "x${i}") { id }`).join(' ')} }`;
      expect(codes(await gql(aliasedProducts, {}, {}))).toEqual(['QUERY_TOO_COMPLEX']);
      expect(calls).toBe(0);
    } finally {
      services.search.search = original;
    }
  });

  it('F6/F7: forged search cursors and malformed id arguments are BAD_USER_INPUT', async () => {
    await createSku(services, base, { east: 1 });
    await services.search.indexProducts(services.db, [(await createSku(services, base, { east: 1 })).productId]);
    const forged = Buffer.from(JSON.stringify(['not-a-number', 'x'])).toString('base64url');
    const search = 'query($after: String) { searchProducts(input: { sort: PRICE_ASC }, first: 5, after: $after) { totalCount } }';
    expect(codes(await gql(search, { after: forged }, {}))).toEqual(['BAD_USER_INPUT']);
    const operator = { token: tokens.operator };
    expect(codes(await gql('{ inventoryMovements(skuId: "abc") { edges { cursor } } }', {}, operator))).toEqual(['BAD_USER_INPUT']);
    expect(codes(await gql('{ inventory(warehouseId: "abc") { edges { cursor } } }', {}, operator))).toEqual(['BAD_USER_INPUT']);
    expect(codes(await gql('{ orders(filter: { awaitingShipmentFromWarehouseId: "abc" }) { edges { cursor } } }', {}, operator))).toEqual([
      'BAD_USER_INPUT',
    ]);
  });

  it('pages myOrders newest first with stable cursors', async () => {
    const sku = await createSku(services, base, { east: 50 });
    const created: string[] = [];
    for (let i = 0; i < 5; i += 1) created.push((await placeOrder(services, base.customer, [{ sku, quantity: 1 }])).orderId);
    await placeOrder(services, base.customer2, [{ sku, quantity: 1 }]);

    const seen: string[] = [];
    let after: string | null = null;
    for (;;) {
      const page: ExecutionResult<MyOrdersQuery> = await gql(MyOrdersDocument, { first: 2, after }, { token: tokens.customer });
      const connection: MyOrdersQuery['myOrders'] | undefined = page.data?.myOrders;
      if (!connection) throw new Error(JSON.stringify(page.errors));
      seen.push(...connection.edges.map((e) => e.node.id));
      if (!connection.pageInfo.hasNextPage) break;
      after = connection.pageInfo.endCursor ?? null;
    }
    expect(seen).toEqual([...created].reverse());
  });

  it('S12: the number of SQL queries does not grow with the number of orders', async () => {
    const a = await createSku(services, base, { east: 500 });
    const b = await createSku(services, base, { west: 500 });
    const counts: number[] = [];
    let total = 0;
    for (const n of [5, 20, 50]) {
      while (total < n) {
        const order = await placeOrder(services, base.customer, [{ sku: a, quantity: 1 }, { sku: b, quantity: 1 }]);
        if (total % 2 === 0) await authorize(services, order);
        total += 1;
      }
      const result = await gql(OperatorOrdersDocument, { first: n }, { token: tokens.operator, headers: { 'x-ofl-debug-query-count': '1' } });
      expect(result.errors).toBeUndefined();
      expect(result.data?.orders.edges).toHaveLength(n);
      const count = result.extensions?.queryCount;
      if (typeof count !== 'number') throw new Error('queryCount missing');
      counts.push(count);
    }
    expect(new Set(counts).size).toBe(1);
    expect(counts[0]).toBeLessThanOrEqual(15);
    const withoutHeader = await gql(OperatorOrdersDocument, { first: 5 }, { token: tokens.operator });
    expect(withoutHeader.extensions?.queryCount).toBeUndefined();
  });

  it('operators see shippable warehouses; customers see return eligibility', async () => {
    const sku = await createSku(services, base, { east: 5 });
    const order = await placeOrder(services, base.customer, [{ sku, quantity: 1 }]);
    await authorize(services, order);
    const asOperator = await gql(OrderDetailDocument, { id: order.orderId }, { token: tokens.operator });
    expect(asOperator.data?.order?.allowedActions).toMatchObject({ canCancel: true, shippableWarehouses: [{ code: 'WH-EAST' }] });
    await gql(ShipOrderDocument, { input: { orderId: order.orderId, warehouseId: WAREHOUSE_EAST } }, { token: tokens.operator });
    const asCustomer = await gql(OrderDetailDocument, { id: order.orderId }, { token: tokens.customer });
    expect(asCustomer.data?.order).toMatchObject({
      status: 'SHIPPED',
      allowedActions: { canCancel: false, canRequestReturn: true, shippableWarehouses: [], receivableReturnIds: [] },
    });
    expect(asCustomer.data?.order?.lines[0]).toMatchObject({ shippedQuantity: 1, returnableQuantity: 1 });
  });
});
