import { expect, it } from '@jest/globals';
import { ReceiveReturnDocument, RequestReturnDocument, ShipOrderDocument } from '@ofl/graphql-types';
import { expectTypename } from '../support/graphql-http';
import type { Scenario } from './types';

const UNIT_PRICE = 2500;

export const s10PartialReturn: Scenario = (context) => {
  it('S10 partial return restocks once and refunds once', async () => {
    const ctx = context();
    const { east } = ctx.warehouses;
    const { customer, operator } = ctx.clients;
    const sku = await ctx.createSku('RETURN', UNIT_PRICE, { east: 10 });
    const order = await ctx.placeOrder(customer, [{ sku, quantity: 3 }]);
    await ctx.confirmPayment(order.id);
    const shipped = await operator.data(ShipOrderDocument, { input: { orderId: order.id, warehouseId: east } });
    expect(expectTypename(shipped.shipOrder, 'ShipmentCreated').order.status).toBe('SHIPPED');
    const orderLineId = order.lines[0]!.id;
    const requestReturn = async (quantity: number) =>
      (
        await customer.data(RequestReturnDocument, {
          input: { orderId: order.id, reason: 'Too many', lines: [{ orderLineId, quantity }] },
        })
      ).requestReturn;
    const receive = async (returnId: string) =>
      (await operator.data(ReceiveReturnDocument, { returnId })).receiveReturn.__typename;

    const requested = expectTypename(await requestReturn(2), 'ReturnRequested');
    const returnId = requested.return.id;
    expect(await receive(returnId)).toBe('ReturnReceived');
    expect(await receive(returnId)).toBe('ReturnNotReceivable');
    expect(await Promise.all([receive(returnId), receive(returnId)])).toEqual(['ReturnNotReceivable', 'ReturnNotReceivable']);

    const payment = await ctx.db.payment(order.id);
    const refundJobs = await ctx.db.jobs('refund.process', [returnId, ...(await refundIds(returnId))]);
    expect(refundJobs).toHaveLength(1);
    await ctx.runJobs(refundJobs.map((job) => job.id));

    const exceeded = expectTypename(await requestReturn(2), 'ReturnQuantityExceeded');
    expect(exceeded.lines).toEqual([{ orderLineId, requested: 2, returnable: 1 }]);

    const restocks = (await ctx.db.movements(sku.id)).filter((movement) => movement.kind === 'RETURN_RESTOCK');
    expect(restocks.map((movement) => movement.onHandDelta)).toEqual([2]);
    expect(await ctx.db.balance(sku.id, east)).toEqual({ onHand: 9, reserved: 0 });
    expect(await ctx.db.payment(order.id)).toEqual({ ...payment, status: 'PARTIALLY_REFUNDED', refundedMinor: 2 * UNIT_PRICE });
    const returnRow = await ctx.db.one<{ status: string }>(`SELECT status FROM returns WHERE id = $1`, [returnId]);
    expect(returnRow.status).toBe('REFUNDED');

    async function refundIds(id: string): Promise<string[]> {
      const rows = await ctx.db.query<{ id: string }>(`SELECT id FROM refunds WHERE return_id = $1`, [id]);
      return rows.map((row) => row.id);
    }
  });
};
