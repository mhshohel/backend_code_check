import { afterAll, beforeAll, beforeEach, describe, expect, it } from '@jest/globals';
import { updateSkuPrice } from '../../src/features/catalog/operations';
import { loadProductDocuments } from '../../src/search/documents';
import { INDEX_MAPPINGS, INDEX_SETTINGS } from '../../src/search/index-definition';
import type { Services } from '../../src/services';
import { runWorkerUntilIdle } from '../../src/worker/worker';
import { closeServices, createSku, meta, resetData, startServices, type BaseData, type TestSku } from '../helpers/harness';
import { jobIdsFor } from '../helpers/orders';

let services: Services;
let base: BaseData;

beforeAll(async () => {
  services = await startServices();
});
afterAll(async () => {
  await closeServices(services);
});
beforeEach(async () => {
  base = await resetData(services);
});

async function storedDocument(productId: string, index: string = services.search.alias): Promise<{ version: number; price: number }> {
  const response = await services.search.client.get<{ minPriceMinor: number }>({ index, id: productId });
  return { version: response._version ?? -1, price: response._source?.minPriceMinor ?? -1 };
}

async function computedVersion(productId: string): Promise<number> {
  const [doc] = await loadProductDocuments(services.db, [productId]);
  if (!doc) throw new Error('product missing');
  return doc.document.version;
}

async function activeIndex(): Promise<string> {
  const result = await services.db.query<{ active: string }>('SELECT active_index AS active FROM search_index_state');
  return result.rows[0]?.active ?? '';
}

describe('search indexing', () => {
  it('S8: reordered and duplicate events never overwrite newer data', async () => {
    const sku = await createSku(services, base, { east: 5, priceMinor: 1000 });
    await services.search.indexProducts(services.db, [sku.productId]);
    await services.db.query(`DELETE FROM outbox_events`);

    await updateSkuPrice(services, base.admin, { skuId: sku.skuId, priceMinor: 1100 }, meta());
    await updateSkuPrice(services, base.admin, { skuId: sku.skuId, priceMinor: 1200 }, meta());
    const [first, second] = await jobIdsFor(services, 'search.product_changed', sku.productId);
    if (!first || !second) throw new Error('expected two search jobs');

    await runWorkerUntilIdle(services, { jobIds: [second] });
    await runWorkerUntilIdle(services, { jobIds: [first] });
    await services.db.query(`UPDATE outbox_events SET status = 'PENDING', available_at = now() WHERE id = $1`, [first]);
    await runWorkerUntilIdle(services, { jobIds: [first] });

    const stored = await storedDocument(sku.productId);
    expect(stored).toEqual({ version: await computedVersion(sku.productId), price: 1200 });
    const result = await services.search.search({ text: null }, 10, null);
    expect(result.hits.find((h) => h.productId === sku.productId)?.fromPriceMinor).toBe(1200);
  });

  it('external_gte refuses an older document version', async () => {
    const sku = await createSku(services, base, { east: 5 });
    await services.search.indexProducts(services.db, [sku.productId]);
    const current = await storedDocument(sku.productId);
    const index = await activeIndex();
    const [doc] = await loadProductDocuments(services.db, [sku.productId]);
    if (!doc) throw new Error('missing');
    await expect(
      services.search.client.index({
        index,
        id: sku.productId,
        document: { ...doc.document, minPriceMinor: 1 },
        version: current.version - 1,
        version_type: 'external_gte',
      }),
    ).rejects.toMatchObject({ statusCode: 409 });
    expect((await storedDocument(sku.productId)).price).toBe(doc.document.minPriceMinor);
  });

  it('writes to the building index too while a rebuild is running', async () => {
    const sku = await createSku(services, base, { east: 5, priceMinor: 700 });
    await services.search.ensureIndex(services.db);
    const building = `${services.search.alias}_manual_${Date.now()}`;
    await services.search.client.indices.create({ index: building, settings: INDEX_SETTINGS, mappings: INDEX_MAPPINGS });
    await services.db.query('UPDATE search_index_state SET building_index = $1', [building]);
    await services.search.indexProducts(services.db, [sku.productId]);
    expect((await storedDocument(sku.productId, building)).price).toBe(700);
    expect((await storedDocument(sku.productId, await activeIndex())).price).toBe(700);
    await services.db.query('UPDATE search_index_state SET building_index = NULL');
    await services.search.client.indices.delete({ index: building });
  });

  it('rebuild switches the alias atomically and keeps updates made during the rebuild', async () => {
    const skus: TestSku[] = [];
    for (let i = 0; i < 5; i += 1) skus.push(await createSku(services, base, { east: 5, priceMinor: 1000 + i }));
    await services.search.indexProducts(services.db, skus.map((s) => s.productId));
    const before = await activeIndex();
    const target = skus[0];
    if (!target) throw new Error('missing sku');

    const rebuild = services.search.rebuild(services.db);
    await updateSkuPrice(services, base.admin, { skuId: target.skuId, priceMinor: 4242 }, meta());
    await runWorkerUntilIdle(services, { jobIds: await jobIdsFor(services, 'search.product_changed', target.productId) });
    const result = await rebuild;

    expect(result.documents).toBe(5);
    expect(result.index).not.toBe(before);
    expect(await activeIndex()).toBe(result.index);
    const aliases = await services.search.client.indices.getAlias({ name: services.search.alias });
    expect(Object.keys(aliases)).toEqual([result.index]);
    expect(await services.search.client.indices.exists({ index: before })).toBe(false);
    expect(await storedDocument(target.productId)).toEqual({ version: await computedVersion(target.productId), price: 4242 });
  });
});

describe('search queries', () => {
  beforeEach(async () => {
    const other = await services.db.query<{ id: string }>(`INSERT INTO categories (slug, name) VALUES ('books', 'Books') RETURNING id`);
    const books = { categoryId: other.rows[0]?.id ?? '' };
    const created = [
      await createSku(services, base, { name: 'Wireless Headphones', priceMinor: 12900, east: 5 }),
      await createSku(services, base, { name: 'Studio Headphones', priceMinor: 9900, east: 0 }),
      await createSku(services, base, { name: 'Bluetooth Speaker', priceMinor: 4900, east: 3 }),
      await createSku(services, books, { name: 'Database Internals', priceMinor: 4900, east: 2 }),
      await createSku(services, books, { name: 'Headphone Repair Guide', priceMinor: 1500, west: 1 }),
    ];
    await services.search.indexProducts(services.db, created.map((s) => s.productId));
  });

  it('finds typos and prefixes', async () => {
    const typo = await services.search.search({ text: 'headphnoes' }, 10, null);
    expect(typo.hits.map((h) => h.name)).toEqual(expect.arrayContaining(['Wireless Headphones', 'Studio Headphones']));
    const suggestions = await services.search.suggest('head', 5);
    expect(suggestions.map((s) => s.name)).toEqual(expect.arrayContaining(['Wireless Headphones', 'Headphone Repair Guide']));
  });

  it('computes disjunctive facets', async () => {
    const result = await services.search.search({ categorySlugs: ['gear'], inStockOnly: true }, 10, null);
    expect(result.totalCount).toBe(2);
    // Category counts ignore the category filter but apply the stock filter.
    expect(result.facets.categories).toEqual([
      { value: 'books', label: 'Books', count: 2, selected: false },
      { value: 'gear', label: 'Gear', count: 2, selected: true },
    ]);
    // Availability counts ignore the stock filter but apply the category filter.
    expect(result.facets.availability).toEqual([
      { value: 'in_stock', label: 'In stock', count: 2, selected: true },
      { value: 'out_of_stock', label: 'Out of stock', count: 1, selected: false },
    ]);
    const prices = await services.search.search({ minPriceMinor: 2500, maxPriceMinor: 5000 }, 10, null);
    expect(prices.totalCount).toBe(2);
    expect(prices.facets.priceRanges.find((b) => b.value === '2500-5000')).toMatchObject({ count: 2, selected: true });
    expect(prices.facets.priceRanges.find((b) => b.value === '0-2500')).toMatchObject({ count: 1, selected: false });
  });

  it('sorts and pages with search_after without gaps or duplicates', async () => {
    const seen: string[] = [];
    let after: string | null = null;
    for (let page = 0; page < 5; page += 1) {
      const result = await services.search.search({ sort: 'PRICE_ASC' }, 2, after);
      seen.push(...result.hits.map((h) => h.name));
      if (!result.hasNextPage) break;
      after = result.hits.at(-1)?.cursor ?? null;
    }
    // Equal prices are ordered by the id tie-breaker, so compare the price sequence.
    expect(seen.map((name) => PRICES[name])).toEqual([1500, 4900, 4900, 9900, 12900]);
    expect(seen).toHaveLength(5);
    expect(new Set(seen).size).toBe(5);
    await expect(services.search.search({}, 51, null)).rejects.toMatchObject({ code: 'BAD_USER_INPUT' });
    await expect(services.search.search({}, 5, 'garbage')).rejects.toMatchObject({ code: 'BAD_USER_INPUT' });
  });
});

const PRICES: Record<string, number> = {
  'Headphone Repair Guide': 1500,
  'Bluetooth Speaker': 4900,
  'Database Internals': 4900,
  'Studio Headphones': 9900,
  'Wireless Headphones': 12900,
};
