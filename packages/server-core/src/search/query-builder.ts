import type { estypes } from '@elastic/elasticsearch';
import { badInput } from '@ofl/domain';
import { PRICE_RANGES } from './index-definition';

export type ProductSort = 'RELEVANCE' | 'PRICE_ASC' | 'PRICE_DESC' | 'NEWEST';

export type SearchInput = {
  text?: string | null;
  categorySlugs?: readonly string[] | null;
  minPriceMinor?: number | null;
  /** Exclusive. */
  maxPriceMinor?: number | null;
  inStockOnly?: boolean | null;
  sort?: ProductSort | null;
};

export type SearchPage = { first: number; after: estypes.SortResults | null };

type Dimension = 'category' | 'price' | 'availability';

export const MAX_SEARCH_PAGE = 50;
export const MAX_TEXT_LENGTH = 200;

export function normalizeSearchInput(input: SearchInput | null | undefined): Required<{ [K in keyof SearchInput]: NonNullable<SearchInput[K]> | null }> {
  const text = input?.text?.trim() ?? '';
  if (text.length > MAX_TEXT_LENGTH) {
    throw badInput('Search text is too long.', [{ path: 'input.text', message: `Use at most ${MAX_TEXT_LENGTH} characters.` }]);
  }
  const min = input?.minPriceMinor ?? null;
  const max = input?.maxPriceMinor ?? null;
  if ((min !== null && min < 0) || (max !== null && max < 0) || (min !== null && max !== null && max <= min)) {
    throw badInput('The price range is not valid.', [{ path: 'input.maxPriceMinor', message: 'Must be greater than the minimum.' }]);
  }
  const categories = input?.categorySlugs ?? null;
  if (categories && categories.length > 50) {
    throw badInput('Too many categories.', [{ path: 'input.categorySlugs', message: 'Select at most 50.' }]);
  }
  return {
    text: text === '' ? null : text,
    categorySlugs: categories && categories.length > 0 ? [...new Set(categories)] : null,
    minPriceMinor: min,
    maxPriceMinor: max,
    inStockOnly: input?.inStockOnly === true ? true : null,
    sort: input?.sort ?? 'RELEVANCE',
  };
}

type Normalized = ReturnType<typeof normalizeSearchInput>;

function filterFor(dimension: Dimension, input: Normalized): estypes.QueryDslQueryContainer | null {
  switch (dimension) {
    case 'category':
      return input.categorySlugs ? { terms: { categorySlug: [...input.categorySlugs] } } : null;
    case 'price': {
      if (input.minPriceMinor === null && input.maxPriceMinor === null) return null;
      const range: estypes.QueryDslNumberRangeQuery = {};
      if (input.minPriceMinor !== null) range.gte = input.minPriceMinor;
      if (input.maxPriceMinor !== null) range.lt = input.maxPriceMinor;
      return { range: { minPriceMinor: range } };
    }
    case 'availability':
      return input.inStockOnly ? { term: { inStock: true } } : null;
  }
}

const DIMENSIONS: readonly Dimension[] = ['category', 'price', 'availability'];

/** All active filters, optionally leaving one dimension out (disjunctive facets). */
function filtersExcept(input: Normalized, excluded: Dimension | null): estypes.QueryDslQueryContainer[] {
  return DIMENSIONS.filter((d) => d !== excluded)
    .map((d) => filterFor(d, input))
    .filter((f): f is estypes.QueryDslQueryContainer => f !== null);
}

function textQuery(text: string | null): estypes.QueryDslQueryContainer {
  if (text === null) return { match_all: {} };
  return {
    bool: {
      should: [
        {
          multi_match: {
            query: text,
            fields: ['name^3', 'categoryName.text^1.5', 'description', 'skuCodes^2'],
            fuzziness: 'AUTO',
            prefix_length: 1,
            operator: 'and',
          },
        },
        { match: { 'name.autocomplete': { query: text, operator: 'and', boost: 2 } } },
        { match_phrase: { name: { query: text, boost: 4 } } },
      ],
      minimum_should_match: 1,
    },
  };
}

function sortFor(sort: ProductSort): estypes.SortCombinations[] {
  // The id tie-breaker makes the order total, which search_after needs.
  switch (sort) {
    case 'RELEVANCE':
      return [{ _score: { order: 'desc' } }, { id: { order: 'asc' } }];
    case 'PRICE_ASC':
      return [{ minPriceMinor: { order: 'asc' } }, { id: { order: 'asc' } }];
    case 'PRICE_DESC':
      return [{ minPriceMinor: { order: 'desc' } }, { id: { order: 'asc' } }];
    case 'NEWEST':
      return [{ createdAt: { order: 'desc' } }, { id: { order: 'asc' } }];
  }
}

function filtered(filters: estypes.QueryDslQueryContainer[]): estypes.QueryDslQueryContainer {
  return filters.length === 0 ? { match_all: {} } : { bool: { filter: filters } };
}

/**
 * Builds the search body. The main query holds only the text; all filters go
 * to post_filter, so the facet aggregations see the text matches and each
 * applies every filter except its own dimension.
 */
export function buildSearchRequest(input: Normalized, page: SearchPage): Omit<estypes.SearchRequest, 'index'> {
  const all = filtersExcept(input, null);
  return {
    query: textQuery(input.text),
    post_filter: filtered(all),
    sort: sortFor(input.sort ?? 'RELEVANCE'),
    size: page.first + 1,
    ...(page.after ? { search_after: page.after } : {}),
    track_total_hits: 10_000,
    track_scores: true,
    _source: ['id', 'slug', 'name', 'categorySlug', 'categoryName', 'minPriceMinor', 'inStock'],
    aggs: {
      categories: {
        filter: filtered(filtersExcept(input, 'category')),
        aggs: {
          values: {
            terms: { field: 'categorySlug', size: 100, order: { _key: 'asc' } },
            aggs: { label: { terms: { field: 'categoryName', size: 1 } } },
          },
        },
      },
      prices: {
        filter: filtered(filtersExcept(input, 'price')),
        aggs: {
          values: {
            range: {
              field: 'minPriceMinor',
              keyed: false,
              ranges: PRICE_RANGES.map((r) => (r.to === null ? { key: r.key, from: r.from } : { key: r.key, from: r.from, to: r.to })),
            },
          },
        },
      },
      availability: {
        filter: filtered(filtersExcept(input, 'availability')),
        aggs: { values: { terms: { field: 'inStock', size: 2 } } },
      },
    },
  };
}

export function buildSuggestRequest(prefix: string, limit: number): Omit<estypes.SearchRequest, 'index'> {
  return {
    query: {
      bool: {
        must: [{ match: { 'name.autocomplete': { query: prefix, operator: 'and' } } }],
        should: [{ prefix: { 'name.keyword': { value: prefix.toLowerCase(), boost: 2 } } }],
      },
    },
    size: limit,
    sort: [{ _score: { order: 'desc' } }, { 'name.keyword': { order: 'asc' } }],
    _source: ['id', 'slug', 'name'],
  };
}

/** search_after cursors carry the sort values of the last hit. */
export function encodeSearchCursor(sortValues: estypes.SortResults): string {
  return Buffer.from(JSON.stringify(sortValues), 'utf8').toString('base64url');
}

export function decodeSearchCursor(cursor: string | null | undefined): estypes.SortResults | null {
  if (!cursor) return null;
  try {
    const parsed: unknown = JSON.parse(Buffer.from(cursor, 'base64url').toString('utf8'));
    if (
      Array.isArray(parsed) &&
      parsed.length === 2 &&
      parsed.every((v) => typeof v === 'string' || typeof v === 'number' || v === null)
    ) {
      return parsed as estypes.SortResults;
    }
  } catch {
    // Fall through.
  }
  throw badInput('The cursor is not valid.', [{ path: 'after', message: 'Invalid cursor.' }]);
}
