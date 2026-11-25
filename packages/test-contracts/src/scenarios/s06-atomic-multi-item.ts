import { expect, it } from '@jest/globals';
import { expectTypename } from '../support/graphql-http';
import type { Scenario } from './types';

export const s06AtomicMultiItem: Scenario = (context) => {
  it('S6 multi-item checkout fails atomically when one line is short', async () => {
    const ctx = context();
    const { east } = ctx.warehouses;
    const skuA = await ctx.createSku('ATOMIC-A', 800, { east: 10 });
    const skuB = await ctx.createSku('ATOMIC-B', 900, { east: 1 });

    const result = await ctx.checkout(ctx.clients.customer, [
      { sku: skuA, quantity: 2 },
      { sku: skuB, quantity: 2 },
    ]);

    const shortage = expectTypename(result, 'InsufficientStock');
    expect(shortage.lines).toEqual([{ skuId: skuB.id, requested: 2, available: 1 }]);
    for (const sku of [skuA, skuB]) {
      expect(await ctx.db.countWhere('order_lines', 'sku_id', sku.id)).toBe(0);
      expect(await ctx.db.countWhere('reservations', 'sku_id', sku.id)).toBe(0);
      expect((await ctx.db.movements(sku.id)).map((movement) => movement.kind)).toEqual(['RECEIPT']);
    }
    expect(await ctx.db.balance(skuA.id, east)).toEqual({ onHand: 10, reserved: 0 });
    expect(await ctx.db.balance(skuB.id, east)).toEqual({ onHand: 1, reserved: 0 });
  });
};
