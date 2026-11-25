import type { SearchProductsQuery } from '@ofl/graphql-types';
import { Link } from 'react-router';

export type SearchHit = SearchProductsQuery['searchProducts']['edges'][number]['node'];

export function ProductCard({ hit }: { hit: SearchHit }) {
  return (
    <li className="product-card">
      <h3>
        <Link to={`/products/${encodeURIComponent(hit.slug)}`}>{hit.name}</Link>
      </h3>
      <p className="muted">{hit.categoryName}</p>
      <p className="price">From {hit.fromPrice.formatted}</p>
      <p className={hit.inStock ? 'stock-in' : 'stock-out'}>{hit.inStock ? 'In stock' : 'Out of stock'}</p>
    </li>
  );
}
