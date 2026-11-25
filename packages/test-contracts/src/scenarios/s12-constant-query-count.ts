import { expect, it } from '@jest/globals';
import { CheckoutDocument, OperatorOrdersDocument } from '@ofl/graphql-types';
import { executeOperation } from '@ofl/server-core';
import { checkoutInput, DEMO_ACCOUNTS, requestMeta } from '../support/context';
import { expectTypename } from '../support/graphql-http';
import type { Scenario } from './types';

const PAGE_SIZES = [5, 20, 50] as const;
const MAX_QUERIES = 15;

export const s12ConstantQueryCount: Scenario = (context) => {
  it('S12 operator order list uses a constant number of SQL queries', async () => {
    const ctx = context();
    expect(ctx.target.config.enableQueryCount).toBe(true);
    const skuA = await ctx.createSku('N1-A', 500, { east: 100 });
    const skuB = await ctx.createSku('N1-B', 600, { west: 100 });
    const { user } = await ctx.sessionClient(DEMO_ACCOUNTS.customer2);
    for (let index = 0; index < Math.max(...PAGE_SIZES); index += 1) {
      const input = checkoutInput([{ sku: skuA, quantity: 1 }, { sku: skuB, quantity: 1 }], 'tok_approve');
      const data = await executeOperation(ctx.services, user, requestMeta(), CheckoutDocument, { input });
      expectTypename(data.checkout, 'CheckoutSucceeded');
    }

    const counts: number[] = [];
    for (const first of PAGE_SIZES) {
      const response = await ctx.clients.operator.execute(OperatorOrdersDocument, { first }, { 'x-ofl-debug-query-count': '1' });
      expect(response.errors).toBeUndefined();
      expect(response.data?.orders.edges).toHaveLength(first);
      expect(response.data?.orders.edges.every((edge) => edge.node.lines.length === 2)).toBe(true);
      const queryCount = response.extensions?.['queryCount'];
      expect(typeof queryCount).toBe('number');
      counts.push(queryCount as number);
    }

    expect(new Set(counts).size).toBe(1);
    expect(counts[0]).toBeLessThanOrEqual(MAX_QUERIES);
  }, 60_000);
};
