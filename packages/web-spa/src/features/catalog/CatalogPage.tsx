import { SearchProductsDocument, type ProductSearchInput } from '@ofl/graphql-types';
import { useCallback, useMemo } from 'react';
import { useSearchParams } from 'react-router';
import { useQuery } from 'urql';
import { CursorPages, PageHeader, SelectField, StatusMessage } from '../../components';
import { updateParams, useUrlCursors } from '../../app/useUrlCursors';
import { FacetGroup } from './FacetGroup';
import { PAGE_SIZE, parseCatalogParams, SORT_OPTIONS, toSearchInput } from './catalogParams';
import { ProductCard } from './ProductCard';
import { SearchBox } from './SearchBox';

export function CatalogPage() {
  const [searchParams, setSearchParams] = useSearchParams();
  const filters = parseCatalogParams(searchParams);
  const inputKey = JSON.stringify(toSearchInput(filters));
  const input = useMemo<ProductSearchInput>(() => JSON.parse(inputKey) as ProductSearchInput, [inputKey]);
  const { cursors, loadMore } = useUrlCursors();
  const variablesFor = useCallback((after: string | null) => ({ input, first: PAGE_SIZE, after }), [input]);

  // Same variables as the first results page, so urql deduplicates the request.
  const [{ data }] = useQuery({ query: SearchProductsDocument, variables: variablesFor(null) });
  const connection = data?.searchProducts;

  const setFilter = (changes: Record<string, string | readonly string[] | null>) =>
    setSearchParams(updateParams(searchParams, changes));

  function toggleCategory(slug: string, checked: boolean) {
    const next = checked ? [...filters.categorySlugs, slug] : filters.categorySlugs.filter((s) => s !== slug);
    setFilter({ category: next });
  }

  return (
    <div>
      <PageHeader title="Catalog" />
      <SearchBox initialText={filters.text} onSearch={(text) => setFilter({ q: text.trim() })} />
      <div className="catalog-layout">
        <aside className="filters" aria-label="Filters">
          <SelectField
            label="Sort by"
            value={filters.sort}
            options={SORT_OPTIONS}
            onChange={(e) => setFilter({ sort: e.target.value === 'RELEVANCE' ? null : e.target.value })}
          />
          {connection ? (
            <>
              <FacetGroup legend="Category" type="checkbox" options={connection.facets.categories} onToggle={toggleCategory} />
              <FacetGroup
                legend="Price"
                type="radio"
                options={connection.facets.priceRanges}
                anyLabel="Any price"
                onClear={() => setFilter({ price: null })}
                onToggle={(value) => setFilter({ price: value })}
              />
              <FacetGroup
                legend="Availability"
                type="checkbox"
                options={connection.facets.availability.filter((bucket) => bucket.value === 'in_stock')}
                onToggle={(_value, checked) => setFilter({ availability: checked ? 'in_stock' : null })}
              />
            </>
          ) : null}
        </aside>
        <section className="results" aria-label="Search results">
          {connection ? (
            <StatusMessage>
              {connection.totalCount === 1 ? '1 product found' : `${connection.totalCount} products found`}
            </StatusMessage>
          ) : null}
          <CursorPages
              query={SearchProductsDocument}
              variablesFor={variablesFor}
              select={(result) => result.searchProducts}
              renderEdges={(edges) => (
                <ul className="product-grid">
                  {edges.map((edge) => (
                    <ProductCard key={edge.cursor} hit={edge.node} />
                  ))}
                </ul>
              )}
              cursors={cursors}
              onLoadMore={loadMore}
              loadMoreLabel="Load more products"
              empty={<p className="muted">No products match these filters.</p>}
            />
        </section>
      </div>
    </div>
  );
}
