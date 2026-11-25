import { expect, it } from '@jest/globals';
import type { Scenario } from './types';

export const s01LastFiveUnits: Scenario = (context) => {
  it('S1 last five units, twenty concurrent customers: exactly 5 succeed', async () => {
    const ctx = context();
    const { east } = ctx.warehouses;
    const sku = await ctx.createSku('LAST-5', 1999, { east: 5 });
    const accounts = await ctx.db.createCustomers(20, 's1-customer');
    const clients = await Promise.all(accounts.map(async (account) => (await ctx.sessionClient(account)).client));

    const results = await Promise.all(clients.map((client) => ctx.checkout(client, [{ sku, quantity: 1 }])));

    const typenames = results.map((result) => result.__typename);
    expect(typenames.filter((name) => name === 'CheckoutSucceeded')).toHaveLength(5);
    expect(typenames.filter((name) => name === 'InsufficientStock')).toHaveLength(15);
    expect(await ctx.db.balance(sku.id, east)).toEqual({ onHand: 5, reserved: 5 });
    expect(await ctx.db.movementCount(sku.id, 'RESERVE')).toBe(5);
    expect(await ctx.db.countWhere('order_lines', 'sku_id', sku.id)).toBe(5);
  }, 60_000);
};
