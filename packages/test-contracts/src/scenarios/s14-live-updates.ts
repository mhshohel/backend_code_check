import { expect, it } from '@jest/globals';
import { OrderUpdatedDocument, ShipOrderDocument, type OrderUpdatedSubscription } from '@ofl/graphql-types';
import { DEMO_ACCOUNTS } from '../support/context';
import { expectTypename } from '../support/graphql-http';
import { createWsClient, recordSubscription } from '../support/graphql-ws';
import type { Scenario } from './types';

type OrderEvent = OrderUpdatedSubscription;
const statusOf = (event: OrderEvent) => event.orderUpdated.order.status;

export const s14LiveUpdates: Scenario = (context) => {
  it('S14 live order updates cross API instances and resume with current state after reconnect', async () => {
    const ctx = context();
    const { east } = ctx.warehouses;
    const { customer, customer2 } = ctx.clients;
    const sku = await ctx.createSku('LIVE', 1600, { east: 10 });
    const order = await ctx.placeOrder(customer, [{ sku, quantity: 1 }]);
    const otherOrder = await ctx.placeOrder(customer2, [{ sku, quantity: 1 }]);
    const second = await ctx.target.startSecondInstance();
    const firstSocket = createWsClient(ctx.target.http.wsUrl, customer.sessionCookie);
    const reconnectSocket = createWsClient(ctx.target.http.wsUrl, customer.sessionCookie);
    try {
      const live = recordSubscription(firstSocket, OrderUpdatedDocument, { orderId: order.id });
      await live.nextEvent((event) => statusOf(event) === 'PENDING_PAYMENT');

      expect((await ctx.confirmPayment(order.id, second.baseUrl)).body.status).toBe('processed');
      expect((await ctx.confirmPayment(otherOrder.id, second.baseUrl)).body.status).toBe('processed');
      await live.nextEvent((event) => statusOf(event) === 'CONFIRMED');
      expect(live.events.map(statusOf).slice(0, 2)).toEqual(['PENDING_PAYMENT', 'CONFIRMED']);
      live.unsubscribe();
      await firstSocket.dispose();

      const operator = ctx.client(second.baseUrl);
      await operator.login(DEMO_ACCOUNTS.operator.email, DEMO_ACCOUNTS.operator.password);
      const shipped = await operator.data(ShipOrderDocument, { input: { orderId: order.id, warehouseId: east } });
      expectTypename(shipped.shipOrder, 'ShipmentCreated');

      const resumed = recordSubscription(reconnectSocket, OrderUpdatedDocument, { orderId: order.id });
      const firstAfterReconnect = await resumed.nextEvent(() => true);
      expect(statusOf(firstAfterReconnect)).toBe('SHIPPED');

      const seenOrderIds = [...live.events, ...resumed.events].map((event) => event.orderUpdated.order.id);
      expect(new Set(seenOrderIds)).toEqual(new Set([order.id]));
      expect([...live.errors, ...resumed.errors]).toEqual([]);
      resumed.unsubscribe();
    } finally {
      await firstSocket.dispose();
      await reconnectSocket.dispose();
      await second.stop();
    }
  });
};
