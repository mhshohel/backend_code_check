import type { Metadata } from 'next';
import Link from 'next/link';
import { loadInventory, loadWarehouses } from '@/modules/server/data/warehouse';
import { STAFF_ROLES, requireRole } from '@/modules/server/session';
import { AdjustInventoryForm } from '@/modules/warehouse/AdjustInventoryForm';
import { Pagination } from '@/modules/ui/Pagination';
import { firstParam, type PageSearchParams } from '@/modules/ui/search-param';

export const metadata: Metadata = { title: 'Inventory' };

type Props = { searchParams: Promise<PageSearchParams> };

export default async function InventoryPage({ searchParams }: Props) {
  await requireRole(STAFF_ROLES, '/warehouse/inventory');
  const params = await searchParams;
  const warehouseId = firstParam(params, 'warehouse');
  const lowStockOnly = firstParam(params, 'low') === '1';
  const after = firstParam(params, 'after');
  const [warehouses, inventory] = await Promise.all([loadWarehouses(), loadInventory({ warehouseId, lowStockOnly, after })]);

  const keep = new URLSearchParams();
  if (warehouseId) keep.set('warehouse', warehouseId);
  if (lowStockOnly) keep.set('low', '1');

  return (
    <section>
      <h1>Inventory</h1>
      <form method="get" className="inline-form" aria-label="Filter inventory">
        <label htmlFor="inventory-warehouse">Warehouse</label>
        <select id="inventory-warehouse" name="warehouse" defaultValue={warehouseId ?? ''}>
          <option value="">All warehouses</option>
          {warehouses.map((warehouse) => (
            <option key={warehouse.id} value={warehouse.id}>
              {warehouse.code}
            </option>
          ))}
        </select>
        <label className="check">
          <input type="checkbox" name="low" value="1" defaultChecked={lowStockOnly} /> Low stock only
        </label>
        <button type="submit">Apply</button>
      </form>

      <ul className="card-list">
        {inventory.edges.map(({ node }) => (
          <li key={`${node.sku.id}:${node.warehouse.id}`} className="card">
            <h2>
              {node.sku.product.name} · {node.sku.label} <span className="muted">{node.sku.code}</span>
            </h2>
            <p>
              {node.warehouse.code}: on hand {node.onHand}, reserved {node.reserved}, <strong>available {node.available}</strong>
            </p>
            <p>
              <Link href={`/warehouse/movements?sku=${node.sku.id}&warehouse=${node.warehouse.id}`}>
                Movement history<span className="visually-hidden"> for {node.sku.code} in {node.warehouse.code}</span>
              </Link>
            </p>
            <details>
              <summary>
                Adjust stock<span className="visually-hidden"> for {node.sku.code} in {node.warehouse.code}</span>
              </summary>
              <AdjustInventoryForm skuId={node.sku.id} skuCode={node.sku.code} warehouseId={node.warehouse.id} warehouseCode={node.warehouse.code} />
            </details>
          </li>
        ))}
      </ul>
      {inventory.edges.length === 0 && <p>No inventory rows match.</p>}
      <Pagination
        basePath="/warehouse/inventory"
        params={keep}
        hasNextPage={inventory.pageInfo.hasNextPage}
        endCursor={inventory.pageInfo.endCursor}
        isFirstPage={after === null}
      />
    </section>
  );
}
