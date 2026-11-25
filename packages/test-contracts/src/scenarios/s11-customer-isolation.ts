import { expect, it } from '@jest/globals';
import {
  AdjustInventoryDocument,
  CancelOrderDocument,
  CheckoutDocument,
  OrderDetailDocument,
  OrderUpdatedDocument,
  RequestReturnDocument,
  ShipOrderDocument,
} from '@ofl/graphql-types';
import { checkoutInput } from '../support/context';
import { errorCodes } from '../support/graphql-http';
import { createWsClient, recordSubscription } from '../support/graphql-ws';
import type { Scenario } from './types';

export const s11CustomerIsolation: Scenario = (context) => {
  it('S11 customers cannot see or change other customers orders or use operator mutations', async () => {
    const ctx = context();
    const { east } = ctx.warehouses;
    const { customer: owner, customer2: other } = ctx.clients;
    const sku = await ctx.createSku('ISOLATION', 1700, { east: 5 });
    const order = await ctx.placeOrder(owner, [{ sku, quantity: 1 }]);
    const orderLineId = order.lines[0]!.id;

    const read = await other.execute(OrderDetailDocument, { id: order.id });
    expect(errorCodes(read)).toEqual(['NOT_FOUND']);
    expect(read.data?.order ?? null).toBeNull();
    expect(errorCodes(await other.execute(CancelOrderDocument, { orderId: order.id }))).toEqual(['NOT_FOUND']);
    const returnInput = { orderId: order.id, reason: 'Not mine', lines: [{ orderLineId, quantity: 1 }] };
    expect(errorCodes(await other.execute(RequestReturnDocument, { input: returnInput }))).toEqual(['NOT_FOUND']);

    const ws = createWsClient(ctx.target.http.wsUrl, other.sessionCookie);
    try {
      const subscription = recordSubscription(ws, OrderUpdatedDocument, { orderId: order.id });
      const error = await subscription.firstError();
      expect(error.extensions?.code).toBe('NOT_FOUND');
      expect(subscription.events).toEqual([]);
    } finally {
      await ws.dispose();
    }

    const shipInput = { orderId: order.id, warehouseId: east };
    expect(errorCodes(await owner.execute(ShipOrderDocument, { input: shipInput }))).toEqual(['FORBIDDEN']);
    const adjustInput = { skuId: sku.id, warehouseId: east, kind: 'ADJUSTMENT' as const, quantityDelta: -1, reason: 'not allowed' };
    expect(errorCodes(await owner.execute(AdjustInventoryDocument, { input: adjustInput }))).toEqual(['FORBIDDEN']);

    const anonymous = ctx.client();
    expect(errorCodes(await anonymous.execute(OrderDetailDocument, { id: order.id }))).toEqual(['UNAUTHENTICATED']);
    const anonymousCheckout = await anonymous.execute(CheckoutDocument, { input: checkoutInput([{ sku, quantity: 1 }], 'tok_approve') });
    expect(errorCodes(anonymousCheckout)).toEqual(['UNAUTHENTICATED']);

    expect(await ctx.db.order(order.id)).toEqual({ status: 'PENDING_PAYMENT', cancellationReason: null });
    expect(await ctx.db.balance(sku.id, east)).toEqual({ onHand: 5, reserved: 1 });
    expect(await ctx.db.countWhere('order_lines', 'sku_id', sku.id)).toBe(1);
  });
};
