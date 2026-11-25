import type { Client, estypes } from '@elastic/elasticsearch';
import { z } from 'zod';
import { badInput } from '@ofl/domain';
import type { AppConfig } from '../config';
import type { Db, Queryable } from '../db/db';
import type { Logger } from '../observability/logger';
import { createSearchClient, isConnectivityError, isIndexMissing, searchUnavailable } from './client';
import { loadDocumentBatch, loadProductDocuments, type LoadedDocument } from './documents';
import { INDEX_MAPPINGS, INDEX_SETTINGS, PRICE_RANGES } from './index-definition';
import {
  buildSearchRequest,
  buildSuggestRequest,
  decodeSearchCursor,
  encodeSearchCursor,
  MAX_SEARCH_PAGE,
  normalizeSearchInput,
  type SearchInput,
} from './query-builder';

export type FacetBucket = { value: string; label: string; count: number; selected: boolean };

export type SearchHit = {
  productId: string;
  slug: string;
  name: string;
  categorySlug: string;
  categoryName: string;
  fromPriceMinor: number;
  inStock: boolean;
  score: number | null;
  cursor: string;
};

export type SearchResult = {
  totalCount: number;
  hits: SearchHit[];
  hasNextPage: boolean;
  facets: { categories: FacetBucket[]; priceRanges: FacetBucket[]; availability: FacetBucket[] };
};

export type Suggestion = { productId: string; slug: string; name: string };

export type SearchService = {
  readonly client: Client;
  readonly alias: string;
  search(input: SearchInput | null | undefined, first: number | null | undefined, after: string | null | undefined): Promise<SearchResult>;
  suggest(prefix: string, limit: number | null | undefined): Promise<Suggestion[]>;
  /** Re-reads the products from PostgreSQL and writes them to the active (and building) index. */
  indexProducts(db: Db, productIds: readonly string[]): Promise<{ indexed: number; skippedOlder: number }>;
  rebuild(db: Db): Promise<{ index: string; documents: number }>;
  ensureIndex(db: Db): Promise<string>;
  ping(): Promise<boolean>;
  close(): Promise<void>;
};

const hitSourceSchema = z.object({
  id: z.string(),
  slug: z.string(),
  name: z.string(),
  categorySlug: z.string(),
  categoryName: z.string(),
  minPriceMinor: z.number(),
  inStock: z.boolean(),
});
const bucketSchema = z.object({ key: z.union([z.string(), z.number()]), key_as_string: z.string().optional(), doc_count: z.number() });
const aggsSchema = z.object({
  categories: z.object({
    values: z.object({
      buckets: z.array(bucketSchema.extend({ label: z.object({ buckets: z.array(bucketSchema) }) })),
    }),
  }),
  prices: z.object({ values: z.object({ buckets: z.array(bucketSchema) }) }),
  availability: z.object({ values: z.object({ buckets: z.array(bucketSchema) }) }),
});

const SEARCH_TIMEOUT = { requestTimeout: 1500, maxRetries: 0 };

export function createSearchService(config: AppConfig, logger: Logger): SearchService {
  const client = createSearchClient(config.elasticsearchUrl);
  const alias = `${config.esIndexPrefix}products`;
  const refresh = config.nodeEnv === 'test' ? ('wait_for' as const) : false;

  async function search(input: SearchInput | null | undefined, firstInput: number | null | undefined, after: string | null | undefined): Promise<SearchResult> {
    const first = firstInput ?? 20;
    if (!Number.isInteger(first) || first < 1 || first > MAX_SEARCH_PAGE) {
      throw badInput(`first must be between 1 and ${MAX_SEARCH_PAGE}.`, [{ path: 'first', message: `Must be between 1 and ${MAX_SEARCH_PAGE}.` }]);
    }
    const normalized = normalizeSearchInput(input);
    const request = buildSearchRequest(normalized, { first, after: decodeSearchCursor(after) });

    let response: estypes.SearchResponse<unknown>;
    try {
      response = await client.search<unknown>({ index: alias, ...request }, SEARCH_TIMEOUT);
    } catch (error) {
      throw toSearchError(error);
    }

    const rawHits = response.hits.hits;
    const visible = rawHits.slice(0, first);
    const hits = visible.map((hit) => {
      const source = hitSourceSchema.parse(hit._source);
      return {
        productId: source.id,
        slug: source.slug,
        name: source.name,
        categorySlug: source.categorySlug,
        categoryName: source.categoryName,
        fromPriceMinor: source.minPriceMinor,
        inStock: source.inStock,
        score: typeof hit._score === 'number' ? hit._score : null,
        cursor: encodeSearchCursor(hit.sort ?? []),
      };
    });
    const total = response.hits.total;
    return {
      totalCount: typeof total === 'number' ? total : (total?.value ?? hits.length),
      hits,
      hasNextPage: rawHits.length > first,
      facets: parseFacets(response.aggregations, normalized),
    };
  }

  async function suggest(prefixInput: string, limitInput: number | null | undefined): Promise<Suggestion[]> {
    const limit = limitInput ?? 5;
    const prefix = prefixInput.trim();
    if (!Number.isInteger(limit) || limit < 1 || limit > 10) {
      throw badInput('limit must be between 1 and 10.', [{ path: 'limit', message: 'Must be between 1 and 10.' }]);
    }
    if (prefix.length === 0) return [];
    if (prefix.length > 100) return [];
    try {
      const response = await client.search<unknown>({ index: alias, ...buildSuggestRequest(prefix, limit) }, SEARCH_TIMEOUT);
      return response.hits.hits.map((hit) => {
        const source = hitSourceSchema.pick({ id: true, slug: true, name: true }).parse(hit._source);
        return { productId: source.id, slug: source.slug, name: source.name };
      });
    } catch (error) {
      throw toSearchError(error);
    }
  }

  function toSearchError(error: unknown): Error {
    if (isConnectivityError(error) || isIndexMissing(error)) {
      logger.warn({ err: error }, 'search unavailable');
      return searchUnavailable(error);
    }
    return error instanceof Error ? error : new Error(String(error));
  }

  async function createIndex(): Promise<string> {
    const name = `${alias}_${Date.now()}_${Math.random().toString(36).slice(2, 6)}`;
    await client.indices.create({ index: name, settings: INDEX_SETTINGS, mappings: INDEX_MAPPINGS });
    return name;
  }

  async function ensureIndex(db: Db): Promise<string> {
    return db.transaction(async (tx) => {
      await tx.query(`INSERT INTO search_index_state (alias) VALUES ($1) ON CONFLICT DO NOTHING`, [alias]);
      const state = await readState(tx, alias, 'FOR UPDATE');
      if (state.activeIndex && (await client.indices.exists({ index: state.activeIndex }))) return state.activeIndex;

      // No usable index (fresh database, or the table was reset): start an
      // empty one and drop leftovers that no state row refers to.
      const index = await createIndex();
      await client.indices.updateAliases({
        actions: [{ remove: { index: `${alias}_*`, alias, must_exist: false } }, { add: { index, alias } }],
      });
      await tx.query('UPDATE search_index_state SET active_index = $2, building_index = NULL, updated_at = now() WHERE alias = $1', [
        alias,
        index,
      ]);
      await deleteIndicesExcept(index);
      logger.info({ index }, 'search index created');
      return index;
    });
  }

  async function deleteIndicesExcept(keep: string): Promise<void> {
    const existing = await client.indices.get({ index: `${alias}_*`, allow_no_indices: true, expand_wildcards: 'open' });
    const stale = Object.keys(existing).filter((name) => name !== keep);
    if (stale.length > 0) await client.indices.delete({ index: stale, ignore_unavailable: true });
  }

  async function writeDocuments(indices: readonly string[], loaded: readonly LoadedDocument[]): Promise<{ indexed: number; skippedOlder: number }> {
    const operations: unknown[] = [];
    for (const index of indices) {
      for (const item of loaded) {
        if (item.active) {
          operations.push(
            { index: { _index: index, _id: item.id, version: item.document.version, version_type: 'external_gte' } },
            item.document,
          );
        } else {
          operations.push({ delete: { _index: index, _id: item.id } });
        }
      }
    }
    if (operations.length === 0) return { indexed: 0, skippedOlder: 0 };
    const response = await client.bulk({ operations, refresh });
    let indexed = 0;
    let skippedOlder = 0;
    const failures: string[] = [];
    for (const entry of response.items) {
      const result = entry.index ?? entry.delete;
      if (!result) continue;
      const status = result.status;
      if (status === 409) {
        // external_gte refused an older version: a newer document is already stored.
        skippedOlder += 1;
      } else if (status === 404 && entry.delete) {
        indexed += 1;
      } else if (status >= 300 || result.error) {
        failures.push(`${result._index}/${result._id}: ${result.error?.type ?? status} ${result.error?.reason ?? ''}`);
      } else {
        indexed += 1;
      }
    }
    if (failures.length > 0) throw new Error(`Search indexing failed: ${failures.slice(0, 5).join('; ')}`);
    return { indexed, skippedOlder };
  }

  async function indexProducts(db: Db, productIds: readonly string[]): Promise<{ indexed: number; skippedOlder: number }> {
    if (productIds.length === 0) return { indexed: 0, skippedOlder: 0 };
    await ensureIndex(db);
    // FOR SHARE on the state row: the alias switch in rebuild() takes FOR
    // UPDATE, so it waits until in-flight writes to the old index finish,
    // and no writer can target an index that is about to be deleted.
    return db.transaction(async (tx) => {
      const state = await readState(tx, alias, 'FOR SHARE');
      const targets = [state.activeIndex, state.buildingIndex].filter((name): name is string => name !== null);
      const loaded = await loadProductDocuments(tx, productIds);
      const known = new Set(loaded.map((d) => d.id));
      // A product id with no row (never committed) has nothing to index.
      const missing = productIds.filter((id) => !known.has(id));
      if (missing.length > 0) logger.debug({ missing }, 'search event for unknown product ignored');
      return writeDocuments(targets, loaded);
    });
  }

  async function rebuild(db: Db): Promise<{ index: string; documents: number }> {
    await ensureIndex(db);
    const index = await createIndex();
    await db.query('UPDATE search_index_state SET building_index = $2, updated_at = now() WHERE alias = $1', [alias, index]);
    logger.info({ index }, 'search rebuild started');

    // From here on the indexer writes every change to both indexes, so
    // changes committed during the bulk load are not lost.
    let documents = 0;
    let afterId: string | null = null;
    for (;;) {
      const batch = await loadDocumentBatch(db, afterId, 500);
      if (batch.length === 0) break;
      const result = await writeDocuments([index], batch);
      documents += result.indexed + result.skippedOlder;
      afterId = batch.at(-1)?.id ?? null;
    }
    await client.indices.refresh({ index });

    const switched = await db.transaction(async (tx) => {
      const state = await readState(tx, alias, 'FOR UPDATE');
      if (state.buildingIndex !== index) return null;
      await client.indices.updateAliases({
        actions: [{ remove: { index: `${alias}_*`, alias, must_exist: false } }, { add: { index, alias } }],
      });
      await tx.query('UPDATE search_index_state SET active_index = $2, building_index = NULL, updated_at = now() WHERE alias = $1', [
        alias,
        index,
      ]);
      return state.activeIndex;
    });
    if (switched === null) {
      await client.indices.delete({ index, ignore_unavailable: true });
      throw new Error('Another rebuild replaced this one; its index was discarded.');
    }
    if (switched !== index) await client.indices.delete({ index: switched, ignore_unavailable: true });
    logger.info({ index, documents }, 'search rebuild finished');
    return { index, documents };
  }

  return {
    client,
    alias,
    search,
    suggest,
    indexProducts,
    rebuild,
    ensureIndex,
    ping: async () => {
      try {
        return await client.ping({}, { requestTimeout: 1000, maxRetries: 0 });
      } catch {
        return false;
      }
    },
    close: () => client.close(),
  };
}

type IndexState = { activeIndex: string | null; buildingIndex: string | null };

async function readState(db: Queryable, alias: string, lock: 'FOR UPDATE' | 'FOR SHARE'): Promise<IndexState> {
  const result = await db.query<IndexState>(
    `SELECT active_index AS "activeIndex", building_index AS "buildingIndex" FROM search_index_state WHERE alias = $1 ${lock}`,
    [alias],
  );
  return result.rows[0] ?? { activeIndex: null, buildingIndex: null };
}

function parseFacets(aggregations: unknown, input: ReturnType<typeof normalizeSearchInput>): SearchResult['facets'] {
  const parsed = aggsSchema.safeParse(aggregations);
  if (!parsed.success) return { categories: [], priceRanges: [], availability: [] };
  const aggs = parsed.data;

  const selectedCategories = new Set(input.categorySlugs ?? []);
  const categories: FacetBucket[] = aggs.categories.values.buckets.map((bucket) => ({
    value: String(bucket.key),
    label: String(bucket.label.buckets[0]?.key ?? bucket.key),
    count: bucket.doc_count,
    selected: selectedCategories.has(String(bucket.key)),
  }));
  for (const slug of selectedCategories) {
    if (!categories.some((c) => c.value === slug)) categories.push({ value: slug, label: slug, count: 0, selected: true });
  }

  const priceCounts = new Map(aggs.prices.values.buckets.map((b) => [String(b.key), b.doc_count]));
  const priceRanges = PRICE_RANGES.map((range) => ({
    value: range.key,
    label: range.label,
    count: priceCounts.get(range.key) ?? 0,
    selected: input.minPriceMinor === range.from && input.maxPriceMinor === range.to,
  }));

  const stock = new Map(aggs.availability.values.buckets.map((b) => [b.key_as_string ?? String(b.key), b.doc_count]));
  const availability: FacetBucket[] = [
    { value: 'in_stock', label: 'In stock', count: stock.get('true') ?? stock.get('1') ?? 0, selected: input.inStockOnly === true },
    { value: 'out_of_stock', label: 'Out of stock', count: stock.get('false') ?? stock.get('0') ?? 0, selected: false },
  ];
  return { categories, priceRanges, availability };
}
