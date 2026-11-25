import { WAREHOUSES } from '../accounts';
import { emptyDataset, type Dataset } from '../dataset';
import { fixtureId, NS } from '../ids';
import { createLedger } from '../ledger';
import { addDemoAccounts, addWarehouses, daysAgo } from './common';

/** Stable ids of the contract fixture, for acceptance tests. */
export const CONTRACT_FIXTURE = {
  category: { id: fixtureId(NS.category, 1), slug: 'contract-goods', name: 'Contract Goods' },
  lastFive: {
    productId: fixtureId(NS.product, 1),
    productSlug: 'last-five-widget',
    skuId: fixtureId(NS.sku, 1),
    skuCode: 'LAST-5',
    priceMinor: 1500,
    /** 5 units in WH-EAST only. */
    stock: { east: 5, west: 0 },
  },
  ample: {
    productId: fixtureId(NS.product, 2),
    productSlug: 'ample-supply-kit',
    skuId: fixtureId(NS.sku, 2),
    skuCode: 'AMPLE-1',
    priceMinor: 2500,
    stock: { east: 500, west: 500 },
  },
} as const;

export async function buildContractDataset(now: Date): Promise<Dataset> {
  const dataset = emptyDataset();
  await addDemoAccounts(dataset);
  addWarehouses(dataset);
  const { category, lastFive, ample } = CONTRACT_FIXTURE;
  dataset.categories.push({ ...category });

  const ledger = createLedger(dataset);
  const receivedAt = daysAgo(now, 1);
  for (const item of [lastFive, ample]) {
    dataset.products.push({
      id: item.productId,
      slug: item.productSlug,
      name: item.skuCode === 'LAST-5' ? 'Last Five Widget' : 'Ample Supply Kit',
      description: 'Contract fixture product.',
      category_id: category.id,
      created_at: daysAgo(now, 2).toISOString(),
    });
    dataset.skus.push({ id: item.skuId, product_id: item.productId, code: item.skuCode, label: 'Standard', price_minor: item.priceMinor });
    if (item.stock.east > 0) {
      ledger.move({ skuId: item.skuId, warehouseId: WAREHOUSES.east.id, kind: 'RECEIPT', onHandDelta: item.stock.east, reservedDelta: 0, reason: 'Initial stock', at: receivedAt });
    }
    if (item.stock.west > 0) {
      ledger.move({ skuId: item.skuId, warehouseId: WAREHOUSES.west.id, kind: 'RECEIPT', onHandDelta: item.stock.west, reservedDelta: 0, reason: 'Initial stock', at: receivedAt });
    }
  }
  return dataset;
}
