'use client';

import { useId, useTransition } from 'react';
import { useRouter } from 'next/navigation';
import type { ProductSort, SearchProductsQuery } from '@ofl/graphql-types';
import {
  IN_STOCK_VALUE,
  SORT_OPTIONS,
  toQueryString,
  toggleCategory,
  withFilterChange,
  type CatalogSearchState,
} from './search-params';

export type SearchFacetsData = SearchProductsQuery['searchProducts']['facets'];

type Props = {
  readonly state: CatalogSearchState;
  /** Null when search is unavailable; the controls still let the user change the URL. */
  readonly facets: SearchFacetsData | null;
  readonly basePath?: string;
};

/**
 * Filter controls write to the URL; the Server Component re-renders the
 * results for the new search params. No filter state is kept on the client.
 */
export function SearchFilters({ state, facets, basePath = '/' }: Props) {
  const router = useRouter();
  const [isPending, startTransition] = useTransition();
  const sortId = useId();

  function navigate(next: CatalogSearchState): void {
    startTransition(() => router.push(`${basePath}${toQueryString(next)}`, { scroll: false }));
  }

  const inStockCount = facets?.availability.find((bucket) => bucket.value === IN_STOCK_VALUE)?.count;

  return (
    <form className="filters" aria-label="Filter products" aria-busy={isPending} onSubmit={(event) => event.preventDefault()}>
      <div className="field">
        <label htmlFor={sortId}>Sort by</label>
        <select
          id={sortId}
          value={state.sort}
          onChange={(event) => navigate(withFilterChange(state, { sort: event.target.value as ProductSort }))}
        >
          {SORT_OPTIONS.map((option) => (
            <option key={option.value} value={option.value}>
              {option.label}
            </option>
          ))}
        </select>
      </div>

      <fieldset>
        <legend>Category</legend>
        {(facets?.categories ?? []).map((bucket) => (
          <label key={bucket.value} className="check">
            <input
              type="checkbox"
              name="category"
              value={bucket.value}
              checked={state.categorySlugs.includes(bucket.value)}
              onChange={() => navigate(toggleCategory(state, bucket.value))}
            />
            {bucket.label} <span className="count">({bucket.count})</span>
          </label>
        ))}
      </fieldset>

      <fieldset>
        <legend>Price</legend>
        <label className="check">
          <input
            type="radio"
            name="price"
            value=""
            checked={state.priceRange === null}
            onChange={() => navigate(withFilterChange(state, { priceRange: null }))}
          />
          Any price
        </label>
        {(facets?.priceRanges ?? []).map((bucket) => (
          <label key={bucket.value} className="check">
            <input
              type="radio"
              name="price"
              value={bucket.value}
              checked={state.priceRange === bucket.value}
              onChange={() => navigate(withFilterChange(state, { priceRange: bucket.value }))}
            />
            {bucket.label} <span className="count">({bucket.count})</span>
          </label>
        ))}
      </fieldset>

      <fieldset>
        <legend>Availability</legend>
        <label className="check">
          <input
            type="checkbox"
            name="stock"
            checked={state.inStockOnly}
            onChange={(event) => navigate(withFilterChange(state, { inStockOnly: event.target.checked }))}
          />
          In stock only{inStockCount !== undefined && <span className="count"> ({inStockCount})</span>}
        </label>
      </fieldset>

      <p className="pending-note" aria-live="polite">
        {isPending ? 'Updating results…' : ''}
      </p>
    </form>
  );
}
