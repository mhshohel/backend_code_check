import type { ProductSearchInput, ProductSort } from '@ofl/graphql-types';

export const SORT_OPTIONS: ReadonlyArray<{ value: ProductSort; label: string }> = [
  { value: 'RELEVANCE', label: 'Relevance' },
  { value: 'PRICE_ASC', label: 'Price: low to high' },
  { value: 'PRICE_DESC', label: 'Price: high to low' },
  { value: 'NEWEST', label: 'Newest' },
];

export const PAGE_SIZE = 20;

/** Catalog filters as they appear in the URL: ?q=&category=&price=&availability=&sort=&after= */
export type CatalogFilters = {
  text: string;
  categorySlugs: string[];
  priceRange: string | null;
  inStockOnly: boolean;
  sort: ProductSort;
};

export function parseCatalogParams(params: URLSearchParams): CatalogFilters {
  const sortParam = params.get('sort');
  const sort = SORT_OPTIONS.find((option) => option.value === sortParam)?.value ?? 'RELEVANCE';
  return {
    text: params.get('q') ?? '',
    categorySlugs: params.getAll('category'),
    priceRange: params.get('price'),
    inStockOnly: params.get('availability') === 'in_stock',
    sort,
  };
}

/**
 * Parses a price facet value "<min>-<max>" (minor units, max exclusive and
 * optional), as documented on FacetBucket in the schema.
 */
export function parsePriceRange(value: string | null): { minPriceMinor?: number; maxPriceMinor?: number } {
  const match = value ? /^(\d+)-(\d*)$/.exec(value) : null;
  if (!match) return {};
  const range: { minPriceMinor?: number; maxPriceMinor?: number } = { minPriceMinor: Number(match[1]) };
  if (match[2]) range.maxPriceMinor = Number(match[2]);
  return range;
}

export function toSearchInput(filters: CatalogFilters): ProductSearchInput {
  const input: ProductSearchInput = { sort: filters.sort };
  if (filters.text.trim()) input.text = filters.text.trim();
  if (filters.categorySlugs.length > 0) input.categorySlugs = filters.categorySlugs;
  if (filters.inStockOnly) input.inStockOnly = true;
  return { ...input, ...parsePriceRange(filters.priceRange) };
}
