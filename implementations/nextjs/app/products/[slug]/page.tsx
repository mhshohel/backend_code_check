import type { Metadata } from 'next';
import Link from 'next/link';
import { notFound } from 'next/navigation';
import { AddToCartForm, type PurchasableSku } from '@/modules/catalog/AddToCartForm';
import { PriceEditor } from '@/modules/admin/PriceEditor';
import { loadProduct, type ProductDetail } from '@/modules/server/data/catalog';
import { ADMIN_ROLES, getViewer, hasRole } from '@/modules/server/session';

type Props = { params: Promise<{ slug: string }> };

export async function generateMetadata({ params }: Props): Promise<Metadata> {
  const product = await loadProduct((await params).slug);
  return { title: product?.name ?? 'Product not found' };
}

function purchasableSkus(product: ProductDetail): PurchasableSku[] {
  return product.skus.map((sku) => ({
    id: sku.id,
    code: sku.code,
    label: sku.label,
    priceMinor: sku.price.amountMinor,
    priceFormatted: sku.price.formatted,
    available: sku.availableQuantity,
  }));
}

/** Live stock from PostgreSQL on every request (not cached), so the per-warehouse table is authoritative. */
export default async function ProductPage({ params }: Props) {
  const { slug } = await params;
  const [product, viewer] = await Promise.all([loadProduct(slug), getViewer()]);
  if (!product) notFound();
  const isAdmin = hasRole(viewer, ADMIN_ROLES);

  return (
    <article className="product">
      <nav aria-label="Breadcrumb">
        <Link href="/">Catalog</Link> › <Link href={`/?category=${encodeURIComponent(product.category.slug)}`}>{product.category.name}</Link>
      </nav>
      <h1>{product.name}</h1>
      <p>{product.description}</p>
      <p>
        From {product.fromPrice.formatted} · {product.availableQuantity} available in total
      </p>

      <section aria-labelledby="buy-heading">
        <h2 id="buy-heading">Buy</h2>
        <AddToCartForm productName={product.name} productSlug={product.slug} skus={purchasableSkus(product)} />
      </section>

      <section aria-labelledby="stock-heading">
        <h2 id="stock-heading">Availability by warehouse</h2>
        <div className="table-wrap">
          <table>
            <thead>
              <tr>
                <th scope="col">Option</th>
                <th scope="col">Warehouse</th>
                <th scope="col">Available</th>
                <th scope="col">On hand</th>
                <th scope="col">Reserved</th>
              </tr>
            </thead>
            <tbody>
              {product.skus.flatMap((sku) =>
                sku.stock.map((level) => (
                  <tr key={`${sku.id}:${level.warehouse.id}`}>
                    <th scope="row">
                      {sku.label} <span className="muted">{sku.code}</span>
                    </th>
                    <td>{level.warehouse.name}</td>
                    <td>{level.available}</td>
                    <td>{level.onHand}</td>
                    <td>{level.reserved}</td>
                  </tr>
                )),
              )}
            </tbody>
          </table>
        </div>
      </section>

      {isAdmin && (
        <section aria-labelledby="price-heading">
          <h2 id="price-heading">Prices (administrator)</h2>
          {product.skus.map((sku) => (
            <PriceEditor key={sku.id} skuId={sku.id} skuCode={sku.code} currentPriceMinor={sku.price.amountMinor} />
          ))}
        </section>
      )}
    </article>
  );
}
