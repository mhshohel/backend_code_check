import { expect, it } from '@jest/globals';
import { ProductDetailDocument, SearchProductsDocument } from '@ofl/graphql-types';
import { closeServices, createServices } from '@ofl/server-core';
import { DEMO_ACCOUNTS } from '../support/context';
import { errorCodes, expectTypename } from '../support/graphql-http';
import type { Scenario } from './types';

/** Port 9 (discard) is closed on a developer machine, so connections are refused. */
export const UNREACHABLE_ELASTICSEARCH_URL = 'http://127.0.0.1:9';

export const s13SearchDown: Scenario = (context) => {
  it('S13 Elasticsearch failure does not affect product detail or checkout', async () => {
    const ctx = context();
    const { east } = ctx.warehouses;
    const sku = await ctx.createSku('SEARCH-DOWN', 1400, { east: 6 });
    const instance = await ctx.target.startWithSearchDown();
    const workerServices = await createServices(
      { ...ctx.target.config, elasticsearchUrl: UNREACHABLE_ELASTICSEARCH_URL },
      { role: 'cli' },
    );
    try {
      const client = ctx.client(instance.baseUrl);
      await client.login(DEMO_ACCOUNTS.customer.email, DEMO_ACCOUNTS.customer.password);

      const search = await client.execute(SearchProductsDocument, { input: { text: sku.productName } });
      expect(errorCodes(search)).toEqual(['SEARCH_UNAVAILABLE']);
      const detail = await client.data(ProductDetailDocument, { slug: sku.productSlug });
      expect(detail.product?.skus.map((item) => item.id)).toEqual([sku.id]);
      const before = await ctx.db.lastJobId();
      const checkout = await ctx.checkout(client, [{ sku, quantity: 2 }]);
      const order = expectTypename(checkout, 'CheckoutSucceeded').order;

      const searchJobs = await ctx.db.jobs('search.product_changed', [sku.productId, sku.id], before);
      expect(searchJobs.length).toBeGreaterThan(0);
      await ctx.runJobs(searchJobs.map((job) => job.id), undefined, workerServices);
      for (const job of searchJobs) {
        const row = await ctx.db.job(job.id);
        expect(['PENDING', 'FAILED']).toContain(row.status);
        expect(row.attempts).toBeGreaterThanOrEqual(1);
        expect(row.lastError).not.toBeNull();
      }

      expect((await ctx.db.order(order.id)).status).toBe('PENDING_PAYMENT');
      expect(await ctx.db.balance(sku.id, east)).toEqual({ onHand: 6, reserved: 2 });
    } finally {
      await closeServices(workerServices);
      await instance.stop();
    }
  });
};
