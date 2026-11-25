import { ProductDetailDocument, type ProductDetailQuery } from '@ofl/graphql-types';
import { useState } from 'react';
import { Link, useParams } from 'react-router';
import { useQuery } from 'urql';
import { Button, ErrorAlert, PageHeader, QueryState } from '../../components';
import { useAppDispatch } from '../../app/store';
import { itemAdded, MAX_QUANTITY_INPUT } from '../cart/cartSlice';
import { toastShown } from '../ui/uiSlice';

type Product = NonNullable<ProductDetailQuery['product']>;
type Sku = Product['skus'][number];

export function ProductDetailPage() {
  const { slug = '' } = useParams();
  const [result] = useQuery({ query: ProductDetailDocument, variables: { slug } });
  return (
    <QueryState {...result} loadingLabel="Loading product…">
      {(data) =>
        data.product ? (
          <ProductDetail product={data.product} />
        ) : (
          <ErrorAlert title="Product not found">
            This product does not exist. <Link to="/">Back to the catalog</Link>.
          </ErrorAlert>
        )
      }
    </QueryState>
  );
}

function ProductDetail({ product }: { product: Product }) {
  return (
    <article>
      <p className="breadcrumbs">
        <Link to="/">Catalog</Link> / <Link to={`/?category=${encodeURIComponent(product.category.slug)}`}>{product.category.name}</Link>
      </p>
      <PageHeader title={product.name}>
        <p className="price">From {product.fromPrice.formatted}</p>
      </PageHeader>
      <p>{product.description}</p>
      <h2>Options</h2>
      <ul className="sku-list">
        {product.skus.map((sku) => (
          <SkuRow key={sku.id} product={product} sku={sku} />
        ))}
      </ul>
    </article>
  );
}

function SkuRow({ product, sku }: { product: Product; sku: Sku }) {
  const dispatch = useAppDispatch();
  const [quantity, setQuantity] = useState(1);
  const inputId = `qty-${sku.id}`;
  const soldOut = sku.availableQuantity <= 0;

  function addToCart() {
    dispatch(
      itemAdded({
        skuId: sku.id,
        productSlug: product.slug,
        productName: product.name,
        skuCode: sku.code,
        skuLabel: sku.label,
        unitPriceMinor: sku.price.amountMinor,
        quantity,
      }),
    );
    dispatch(toastShown('success', `Added ${quantity} × ${product.name} (${sku.label}) to your cart.`));
  }

  return (
    <li className="card sku">
      <div className="sku-heading">
        <h3>{sku.label}</h3>
        <span className="muted">{sku.code}</span>
        <span className="price">{sku.price.formatted}</span>
      </div>
      <table className="table compact">
        <caption>Availability for {sku.label}</caption>
        <thead>
          <tr>
            <th scope="col">Warehouse</th>
            <th scope="col">Available</th>
          </tr>
        </thead>
        <tbody>
          {sku.stock.map((level) => (
            <tr key={level.warehouse.id}>
              <td>{level.warehouse.name}</td>
              <td>{level.available}</td>
            </tr>
          ))}
        </tbody>
      </table>
      <div className="inline-form">
        <label htmlFor={inputId}>Quantity</label>
        <input
          id={inputId}
          type="number"
          min={1}
          max={MAX_QUANTITY_INPUT}
          value={quantity}
          onChange={(e) => setQuantity(Math.max(1, Math.min(MAX_QUANTITY_INPUT, Number(e.target.value) || 1)))}
        />
        <Button variant="primary" onClick={addToCart} disabled={soldOut} aria-label={`Add ${sku.label} to cart`}>
          {soldOut ? 'Out of stock' : 'Add to cart'}
        </Button>
      </div>
    </li>
  );
}
