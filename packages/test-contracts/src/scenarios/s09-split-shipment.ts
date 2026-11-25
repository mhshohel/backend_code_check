import { expect, it } from '@jest/globals';
import { ShipOrderDocument } from '@ofl/graphql-types';
import { expectTypename } from '../support/graphql-http';
import type { Scenario } from './types';

export const s09SplitShipment: Scenario = (context) => {
  it('S9 one order ships from two warehouses; duplicate ships are rejected', async () => {
    const ctx = context();
    const { east, west } = ctx.warehouses;
    const operator = ctx.clients.operator;
    const sku = await ctx.createSku('SPLIT', 1300, { east: 2, west: 3 });
    const order = await ctx.placeOrder(ctx.clients.customer, [{ sku, quantity: 4 }]);
    expect((await ctx.confirmPayment(order.id)).body.status).toBe('processed');
    const ship = async (warehouseId: string) =>
      (await operator.data(ShipOrderDocument, { input: { orderId: order.id, warehouseId } })).shipOrder;

    const fromEast = expectTypename(await ship(east), 'ShipmentCreated');
    expect(fromEast.order.status).toBe('PARTIALLY_SHIPPED');
    expect((await ship(east)).__typename).toBe('NothingToShip');
    const fromWest = expectTypename(await ship(west), 'ShipmentCreated');
    expect(fromWest.order.status).toBe('SHIPPED');
    const afterShipped = expectTypename(await ship(east), 'OrderNotShippable');
    expect(afterShipped.status).toBe('SHIPPED');

    expect(await ctx.db.countWhere('shipments', 'order_id', order.id)).toBe(2);
    const shipMovements = (await ctx.db.movements(sku.id)).filter((movement) => movement.kind === 'SHIP');
    expect(shipMovements.map(({ warehouseId, onHandDelta }) => ({ warehouseId, onHandDelta })).sort(byWarehouse)).toEqual(
      [
        { warehouseId: east, onHandDelta: -2 },
        { warehouseId: west, onHandDelta: -2 },
      ].sort(byWarehouse),
    );
    expect(await ctx.db.balance(sku.id, east)).toEqual({ onHand: 0, reserved: 0 });
    expect(await ctx.db.balance(sku.id, west)).toEqual({ onHand: 1, reserved: 0 });
  });
};

const byWarehouse = (a: { warehouseId: string }, b: { warehouseId: string }) => a.warehouseId.localeCompare(b.warehouseId);
