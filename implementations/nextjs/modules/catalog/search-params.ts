import type { ProductSort, SearchProductsQueryVariables } from '@ofl/graphql-types';

// URL state for the catalog. The URL is the single source of truth for
// filters, so results are shareable, bookmarkable, and server-rendered.
//   q=lamp&category=lighting&category=desk&price=2500-5000&stock=in_stock&sort=PRICE_ASC&after=<cursor>

export type CatalogSearchState = {
  readonly text: string;
  readonly categorySlugs: readonly string[];
  /** Facet bucket value such as "2500-5000" or "25000-" (min inclusive, max exclusive). */
  readonly priceRange: string | null;
  readonly inStockOnly: boolean;
  readonly sort: ProductSort;
  readonly after: string | null;
};

export type RawSearchParams = Record<string, string | string[] | undefined>;

export const PAGE_SIZE = 12;
export const IN_STOCK_VALUE = 'in_stock';

export const SORT_OPTIONS: ReadonlyArray<{ value: ProductSort; label: string }> = [
  { value: 'RELEVANCE', label: 'Relevance' },
  { value: 'PRICE_ASC', label: 'Price: low to high' },
  { value: 'PRICE_DESC', label: 'Price: high to low' },
  { value: 'NEWEST', label: 'Newest' },
];

const SORT_VALUES = new Set<string>(SORT_OPTIONS.map((option) => option.value));
const PRICE_RANGE_PATTERN = /^(\d{1,9})-(\d{1,9})?$/;
const MAX_TEXT_LENGTH = 200;
const MAX_CATEGORIES = 20;

function all(value: string | string[] | undefined): string[] {
  if (value === undefined) return [];
  return Array.isArray(value) ? value : [value];
}

function first(value: string | string[] | undefined): string | undefined {
  return all(value)[0];
}

export function parseSearchState(params: RawSearchParams): CatalogSearchState {
  const sort = first(params.sort);
  const price = first(params.price);
  return {
    text: (first(params.q) ?? '').trim().slice(0, MAX_TEXT_LENGTH),
    categorySlugs: [...new Set(all(params.category).filter((slug) => slug.length > 0))].slice(0, MAX_CATEGORIES),
    priceRange: price !== undefined && PRICE_RANGE_PATTERN.test(price) ? price : null,
    inStockOnly: first(params.stock) === IN_STOCK_VALUE,
    sort: sort !== undefined && SORT_VALUES.has(sort) ? (sort as ProductSort) : 'RELEVANCE',
    after: first(params.after) || null,
  };
}

export function parsePriceRange(value: string | null): { minPriceMinor: number | null; maxPriceMinor: number | null } {
  const match = value === null ? null : PRICE_RANGE_PATTERN.exec(value);
  if (!match) return { minPriceMinor: null, maxPriceMinor: null };
  return { minPriceMinor: Number(match[1]), maxPriceMinor: match[2] === undefined ? null : Number(match[2]) };
}

export function toSearchVariables(state: CatalogSearchState): SearchProductsQueryVariables {
  const { minPriceMinor, maxPriceMinor } = parsePriceRange(state.priceRange);
  return {
    input: {
      text: state.text || null,
      categorySlugs: state.categorySlugs.length > 0 ? [...state.categorySlugs] : null,
      minPriceMinor,
      maxPriceMinor,
      inStockOnly: state.inStockOnly,
      sort: state.sort,
    },
    first: PAGE_SIZE,
    after: state.after,
  };
}

export function toQueryString(state: CatalogSearchState): string {
  const params = new URLSearchParams();
  if (state.text) params.set('q', state.text);
  for (const slug of state.categorySlugs) params.append('category', slug);
  if (state.priceRange) params.set('price', state.priceRange);
  if (state.inStockOnly) params.set('stock', IN_STOCK_VALUE);
  if (state.sort !== 'RELEVANCE') params.set('sort', state.sort);
  if (state.after) params.set('after', state.after);
  const query = params.toString();
  return query ? `?${query}` : '';
}

/** Any filter change returns to the first page: a cursor is only valid for the filters that produced it. */
export function withFilterChange(state: CatalogSearchState, change: Partial<Omit<CatalogSearchState, 'after'>>): CatalogSearchState {
  return { ...state, ...change, after: null };
}

export function toggleCategory(state: CatalogSearchState, slug: string): CatalogSearchState {
  const selected = state.categorySlugs.includes(slug)
    ? state.categorySlugs.filter((existing) => existing !== slug)
    : [...state.categorySlugs, slug];
  return withFilterChange(state, { categorySlugs: selected });
}
