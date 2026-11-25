import { expect, it } from '@jest/globals';
import { CheckoutDocument } from '@ofl/graphql-types';
import { checkoutInput } from '../support/context';
import { expectTypename } from '../support/graphql-http';
import type { Scenario } from './types';

export const s02IdempotentRetries: Scenario = (context) => {
  it('S2 concurrent retries with one idempotency key create one order', async () => {
    const ctx = context();
    const client = ctx.clients.customer;
    const sku = await ctx.createSku('IDEMPOTENT', 1500, { east: 50 });
    const input = checkoutInput([{ sku, quantity: 3 }], 'tok_approve');

    const results = await Promise.all(
      Array.from({ length: 10 }, () => client.data(CheckoutDocument, { input })),
    );

    const succeeded = results.map((result) => expectTypename(result.checkout, 'CheckoutSucceeded'));
    expect(new Set(succeeded.map((result) => result.order.id)).size).toBe(1);
    expect(succeeded.filter((result) => !result.replayed)).toHaveLength(1);
    expect(await ctx.db.countWhere('order_lines', 'sku_id', sku.id)).toBe(1);
    expect(await ctx.db.countWhere('reservations', 'sku_id', sku.id)).toBe(1);
    expect(await ctx.db.balance(sku.id, ctx.warehouses.east)).toEqual({ onHand: 50, reserved: 3 });

    const changed = { ...input, lines: input.lines.map((line) => ({ ...line, quantity: 4 })) };
    const reused = await client.data(CheckoutDocument, { input: changed });
    expect(reused.checkout.__typename).toBe('IdempotencyKeyReused');
  });
};
