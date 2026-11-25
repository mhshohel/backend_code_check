import { expect, it } from '@jest/globals';
import { SearchProductsDocument, UpdateSkuPriceDocument } from '@ofl/graphql-types';
import { rebuildSearchIndex } from '@ofl/server-core';
import { expectTypename } from '../support/graphql-http';
import type { Scenario } from './types';

type EsDocument = { found: boolean; _version?: number; _source?: Record<string, unknown> };

export const s08ReorderedSearchEvents: Scenario = (context) => {
  it('S8 duplicate or reordered search events never overwrite newer data', async () => {
    const ctx = context();
    const { elasticsearchUrl, esIndexPrefix } = ctx.target.config;
    const alias = `${esIndexPrefix}products`;
    const sku = await ctx.createSku('SEARCH', 1000, { east: 10 });
    await rebuildSearchIndex(ctx.services);
    const before = await ctx.db.lastJobId();

    for (const priceMinor of [1100, 1200]) {
      const data = await ctx.clients.admin.data(UpdateSkuPriceDocument, { input: { skuId: sku.id, priceMinor } });
      expectTypename(data.updateSkuPrice, 'SkuPriceUpdated');
    }
    const events = await ctx.db.jobs('search.product_changed', [sku.productId, sku.id], before);
    expect(events).toHaveLength(2);
    const [first, second] = events as [(typeof events)[0], (typeof events)[0]];

    await ctx.runJobs([second.id]);
    await ctx.runJobs([first.id]);
    await ctx.db.makeJobClaimableAgain(first.id);
    await ctx.runJobs([first.id]);

    await fetch(`${elasticsearchUrl}/${alias}/_refresh`, { method: 'POST' });
    const document = (await (await fetch(`${elasticsearchUrl}/${alias}/_doc/${sku.productId}`)).json()) as EsDocument;
    expect(document.found).toBe(true);
    expect(document._version).toBe(await ctx.db.productSearchVersion(sku.productId));

    const search = await ctx.clients.customer.data(SearchProductsDocument, {
      input: { text: sku.productName },
      first: 50,
    });
    const hit = search.searchProducts.edges.find((edge) => edge.node.productId === sku.productId);
    expect(hit?.node.fromPrice.amountMinor).toBe(1200);
  });
};
