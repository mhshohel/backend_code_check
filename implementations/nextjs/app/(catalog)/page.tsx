import type { Metadata } from 'next';
import Link from 'next/link';
import { SearchBox } from '@/modules/catalog/SearchBox';
import { SearchFilters } from '@/modules/catalog/SearchFilters';
import { parseSearchState, toQueryString, toSearchVariables, type RawSearchParams } from '@/modules/catalog/search-params';
import { searchCatalog } from '@/modules/server/data/catalog';
import { Pagination } from '@/modules/ui/Pagination';

export const metadata: Metadata = { title: 'Catalog' };

type Props = { searchParams: Promise<RawSearchParams> };

/** Server Component: search params are the filter state; results come from the in-process application layer. */
export default async function CatalogPage({ searchParams }: Props) {
  const state = parseSearchState(await searchParams);
  const outcome = await searchCatalog(toSearchVariables(state));
  const keepParams = new URLSearchParams(toQueryString({ ...state, after: null }).slice(1));

  return (
    <div className="catalog">
      <h1>Catalog</h1>
      <SearchBox key={state.text} state={state} />
      <div className="catalog-layout">
        <aside aria-label="Filters">
          <SearchFilters state={state} facets={outcome.kind === 'ok' ? outcome.data.facets : null} />
        </aside>
        <section aria-labelledby="results-heading" className="results">
          <h2 id="results-heading">Results</h2>
          {outcome.kind === 'unavailable' ? (
            <p role="alert">
              Search is temporarily unavailable. Product pages and checkout still work; try again in a moment.
            </p>
          ) : (
            <>
              <p aria-live="polite">
                {outcome.data.totalCount} {outcome.data.totalCount === 1 ? 'product' : 'products'}
                {state.text && <> matching “{state.text}”</>}
              </p>
              {outcome.data.edges.length === 0 ? (
                <p>No products match these filters.</p>
              ) : (
                <ul className="product-grid">
                  {outcome.data.edges.map(({ node }) => (
                    <li key={node.productId} className="product-card">
                      <h3>
                        <Link href={`/products/${encodeURIComponent(node.slug)}`}>{node.name}</Link>
                      </h3>
                      <p className="muted">{node.categoryName}</p>
                      <p>From {node.fromPrice.formatted}</p>
                      <p className={node.inStock ? 'stock-in' : 'stock-out'}>{node.inStock ? 'In stock' : 'Out of stock'}</p>
                    </li>
                  ))}
                </ul>
              )}
              <Pagination
                basePath="/"
                params={keepParams}
                hasNextPage={outcome.data.pageInfo.hasNextPage}
                endCursor={outcome.data.pageInfo.endCursor}
                isFirstPage={state.after === null}
              />
            </>
          )}
        </section>
      </div>
    </div>
  );
}
