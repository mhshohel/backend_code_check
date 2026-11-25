import { DEMO_ACCOUNTS, WAREHOUSES } from '../accounts';
import { emptyDataset, type Dataset } from '../dataset';
import { fixtureId, NS, seededRandom } from '../ids';
import { createLedger, type Ledger } from '../ledger';
import { addDemoAccounts, addWarehouses, daysAgo } from './common';
import { DEMO_CATALOG } from './demo-catalog';

type SkuInfo = { id: string; code: string; productName: string; priceMinor: number };
type HistoricalKind = 'SHIPPED' | 'SHIPPED_RETURNED' | 'PARTIALLY_SHIPPED' | 'CONFIRMED' | 'CANCELLED_DECLINED' | 'CANCELLED_BY_CUSTOMER';

const HISTORY: readonly HistoricalKind[] = [
  'SHIPPED', 'SHIPPED', 'SHIPPED', 'SHIPPED_RETURNED', 'CONFIRMED', 'CONFIRMED',
  'PARTIALLY_SHIPPED', 'CANCELLED_DECLINED', 'CANCELLED_BY_CUSTOMER', 'SHIPPED',
];
const HISTORICAL_ORDERS = 40;

function slugify(text: string): string {
  return text.toLowerCase().replace(/&/g, 'and').replace(/[^a-z0-9]+/g, '-').replace(/^-|-$/g, '');
}

/** Realistic demo data: 8 categories, 60 products, stock in both warehouses, 40 historical orders. */
export async function buildDemoDataset(now: Date): Promise<Dataset> {
  const dataset = emptyDataset();
  const random = seededRandom(20261125);
  await addDemoAccounts(dataset);
  addWarehouses(dataset);
  const ledger = createLedger(dataset);
  const skus = addCatalog(dataset, ledger, random, now);

  for (let index = 0; index < HISTORICAL_ORDERS; index += 1) {
    const kind = HISTORY[index % HISTORY.length] ?? 'SHIPPED';
    addHistoricalOrder(dataset, ledger, random, skus, index + 1, kind, daysAgo(now, 30 - Math.floor((index * 29) / HISTORICAL_ORDERS), 37 * index));
  }
  return dataset;
}

function addCatalog(dataset: Dataset, ledger: Ledger, random: () => number, now: Date): SkuInfo[] {
  const skus: SkuInfo[] = [];
  let productNumber = 0;
  let skuNumber = 0;
  DEMO_CATALOG.forEach((category, categoryIndex) => {
    const categoryId = fixtureId(NS.category, categoryIndex + 1);
    dataset.categories.push({ id: categoryId, slug: category.slug, name: category.name });
    category.products.forEach((product, productIndex) => {
      productNumber += 1;
      const productId = fixtureId(NS.product, productNumber);
      dataset.products.push({
        id: productId,
        slug: slugify(product.name),
        name: product.name,
        description: product.description,
        category_id: categoryId,
        // Spread creation dates so the NEWEST sort is meaningful.
        created_at: daysAgo(now, 90 - productNumber).toISOString(),
      });
      product.variants.forEach((variant, variantIndex) => {
        skuNumber += 1;
        const skuId = fixtureId(NS.sku, skuNumber);
        const code = `${category.code}-${String(productIndex + 1).padStart(2, '0')}${variant === 'Standard' ? '' : `-${slugify(variant).toUpperCase().slice(0, 6)}`}`;
        const priceMinor = product.basePriceMinor + variantIndex * 500;
        dataset.skus.push({ id: skuId, product_id: productId, code, label: variant, price_minor: priceMinor });
        skus.push({ id: skuId, code, productName: product.name, priceMinor });

        // Most SKUs are stocked in both warehouses; some are low or out of stock to make facets and alerts interesting.
        const roll = random();
        const east = roll < 0.08 ? 0 : roll < 0.2 ? 2 + Math.floor(random() * 3) : 20 + Math.floor(random() * 60);
        const west = roll < 0.12 ? 0 : 10 + Math.floor(random() * 40);
        const receivedAt = daysAgo(now, 60);
        if (east > 0) ledger.move({ skuId, warehouseId: WAREHOUSES.east.id, kind: 'RECEIPT', onHandDelta: east, reservedDelta: 0, reason: 'Opening stock', at: receivedAt });
        if (west > 0) ledger.move({ skuId, warehouseId: WAREHOUSES.west.id, kind: 'RECEIPT', onHandDelta: west, reservedDelta: 0, reason: 'Opening stock', at: receivedAt });
      });
    });
  });
  return skus;
}

type Allocation = { lineId: string; skuId: string; warehouseId: string; quantity: number };

function addHistoricalOrder(
  dataset: Dataset,
  ledger: Ledger,
  random: () => number,
  skus: readonly SkuInfo[],
  n: number,
  kind: HistoricalKind,
  createdAt: Date,
): void {
  const orderId = fixtureId(NS.order, n);
  const customer = n % 3 === 0 ? DEMO_ACCOUNTS.customer2 : DEMO_ACCOUNTS.customer;
  const lineCount = 1 + Math.floor(random() * 3);
  const chosen = new Map<string, SkuInfo>();
  while (chosen.size < lineCount) {
    const sku = skus[Math.floor(random() * skus.length)];
    if (sku) chosen.set(sku.id, sku);
  }

  const lines: { id: string; sku: SkuInfo; quantity: number }[] = [];
  const allocations: Allocation[] = [];
  for (const sku of chosen.values()) {
    const quantity = 1 + Math.floor(random() * 2);
    const warehouseId = [WAREHOUSES.east.id, WAREHOUSES.west.id].find((id) => ledger.available(sku.id, id) >= quantity);
    if (!warehouseId) continue;
    const lineId = fixtureId(NS.orderLine, n * 10 + lines.length + 1);
    lines.push({ id: lineId, sku, quantity });
    allocations.push({ lineId, skuId: sku.id, warehouseId, quantity });
  }
  if (lines.length === 0) return;

  const subtotal = lines.reduce((sum, line) => sum + line.sku.priceMinor * line.quantity, 0);
  const at = (minutes: number) => new Date(createdAt.getTime() + minutes * 60_000);
  const paymentId = fixtureId(NS.payment, n);
  const cancelled = kind === 'CANCELLED_DECLINED' || kind === 'CANCELLED_BY_CUSTOMER';
  const status =
    kind === 'SHIPPED_RETURNED' ? 'SHIPPED' : cancelled ? 'CANCELLED' : kind === 'PARTIALLY_SHIPPED' && allocations.length < 2 ? 'SHIPPED' : kind;

  dataset.orders.push({
    id: orderId,
    customer_id: customer.id,
    status,
    cancellation_reason: kind === 'CANCELLED_DECLINED' ? 'PAYMENT_DECLINED' : kind === 'CANCELLED_BY_CUSTOMER' ? 'CUSTOMER_REQUEST' : null,
    subtotal_minor: subtotal,
    total_minor: subtotal,
    reservation_expires_at: at(15).toISOString(),
    created_at: createdAt.toISOString(),
    updated_at: at(60).toISOString(),
  });
  lines.forEach((line, index) =>
    dataset.order_lines.push({
      id: line.id,
      order_id: orderId,
      line_number: index + 1,
      sku_id: line.sku.id,
      product_name: line.sku.productName,
      sku_code: line.sku.code,
      quantity: line.quantity,
      unit_price_minor: line.sku.priceMinor,
      line_total_minor: line.sku.priceMinor * line.quantity,
    }),
  );
  for (const allocation of allocations) {
    ledger.move({ skuId: allocation.skuId, warehouseId: allocation.warehouseId, kind: 'RESERVE', onHandDelta: 0, reservedDelta: allocation.quantity, referenceType: 'order', referenceId: orderId, at: createdAt });
  }

  const reservationStatus = new Map<string, string>();
  if (cancelled) {
    for (const allocation of allocations) {
      ledger.move({ skuId: allocation.skuId, warehouseId: allocation.warehouseId, kind: 'RELEASE', onHandDelta: 0, reservedDelta: -allocation.quantity, referenceType: 'order', referenceId: orderId, at: at(5) });
      reservationStatus.set(allocation.lineId, 'RELEASED');
    }
  } else {
    // Ship everything, or (PARTIALLY_SHIPPED) only the first line's warehouse.
    const shipAll = status !== 'CONFIRMED' && status !== 'PARTIALLY_SHIPPED';
    const shipping = status === 'CONFIRMED' ? [] : shipAll ? allocations : allocations.slice(0, 1);
    const byWarehouse = new Map<string, Allocation[]>();
    for (const allocation of shipping) byWarehouse.set(allocation.warehouseId, [...(byWarehouse.get(allocation.warehouseId) ?? []), allocation]);
    let shipmentIndex = 0;
    for (const [warehouseId, shipped] of byWarehouse) {
      shipmentIndex += 1;
      const shipmentId = fixtureId(NS.shipment, n * 10 + shipmentIndex);
      dataset.shipments.push({
        id: shipmentId,
        order_id: orderId,
        warehouse_id: warehouseId,
        tracking_code: `TRK-DEMO${String(n).padStart(4, '0')}${shipmentIndex}`,
        shipped_by: DEMO_ACCOUNTS.operator.id,
        shipped_at: at(24 * 60).toISOString(),
      });
      for (const allocation of shipped) {
        dataset.shipment_lines.push({ shipment_id: shipmentId, order_line_id: allocation.lineId, quantity: allocation.quantity });
        ledger.move({ skuId: allocation.skuId, warehouseId, kind: 'SHIP', onHandDelta: -allocation.quantity, reservedDelta: -allocation.quantity, referenceType: 'shipment', referenceId: shipmentId, actorUserId: DEMO_ACCOUNTS.operator.id, at: at(24 * 60) });
        reservationStatus.set(allocation.lineId, 'SHIPPED');
      }
    }
    for (const allocation of allocations) if (!reservationStatus.has(allocation.lineId)) reservationStatus.set(allocation.lineId, 'CONFIRMED');
  }
  allocations.forEach((allocation, index) =>
    dataset.reservations.push({
      id: fixtureId(NS.reservation, n * 10 + index + 1),
      order_id: orderId,
      order_line_id: allocation.lineId,
      sku_id: allocation.skuId,
      warehouse_id: allocation.warehouseId,
      quantity: allocation.quantity,
      status: reservationStatus.get(allocation.lineId) ?? 'CONFIRMED',
      expires_at: at(15).toISOString(),
      release_reason: cancelled ? (kind === 'CANCELLED_DECLINED' ? 'PAYMENT_DECLINED' : 'CUSTOMER_REQUEST') : null,
      created_at: createdAt.toISOString(),
      updated_at: at(60).toISOString(),
    }),
  );

  addPayment(dataset, ledger, { n, kind, orderId, paymentId, subtotal, lines, allocations, at, customerId: customer.id });
}

function addPayment(
  dataset: Dataset,
  ledger: Ledger,
  order: {
    n: number;
    kind: HistoricalKind;
    orderId: string;
    paymentId: string;
    subtotal: number;
    lines: readonly { id: string; sku: SkuInfo; quantity: number }[];
    allocations: readonly Allocation[];
    at: (minutes: number) => Date;
    customerId: string;
  },
): void {
  const { n, kind, orderId, paymentId, subtotal, at } = order;
  const declined = kind === 'CANCELLED_DECLINED';
  let refunded = 0;

  dataset.payment_events.push({
    payment_id: paymentId,
    provider_event_id: `evt_charge_${paymentId}`,
    kind: declined ? 'PAYMENT_DECLINED' : 'PAYMENT_SUCCEEDED',
    amount_minor: subtotal,
    outcome: declined ? 'declined' : 'captured',
    received_at: at(1).toISOString(),
  });

  if (kind === 'CANCELLED_BY_CUSTOMER') {
    refunded = subtotal;
    dataset.refunds.push({ id: fixtureId(NS.refund, n), payment_id: paymentId, return_id: null, reason: 'CANCELLATION', amount_minor: subtotal, status: 'SUCCEEDED', created_at: at(5).toISOString(), completed_at: at(6).toISOString() });
  }

  if (kind === 'SHIPPED_RETURNED') {
    const line = order.lines[0];
    const allocation = order.allocations.find((a) => a.lineId === line?.id);
    if (line && allocation) {
      const returnId = fixtureId(NS.return, n);
      const amount = line.sku.priceMinor;
      dataset.returns.push({ id: returnId, order_id: orderId, status: 'REFUNDED', reason: 'Did not fit my needs.', refund_minor: amount, requested_by: order.customerId, received_by: DEMO_ACCOUNTS.operator.id, created_at: at(3 * 24 * 60).toISOString(), received_at: at(5 * 24 * 60).toISOString(), refunded_at: at(5 * 24 * 60 + 5).toISOString() });
      dataset.return_lines.push({ return_id: returnId, order_line_id: line.id, warehouse_id: allocation.warehouseId, quantity: 1 });
      ledger.move({ skuId: line.sku.id, warehouseId: allocation.warehouseId, kind: 'RETURN_RESTOCK', onHandDelta: 1, reservedDelta: 0, referenceType: 'return', referenceId: returnId, actorUserId: DEMO_ACCOUNTS.operator.id, at: at(5 * 24 * 60) });
      dataset.refunds.push({ id: fixtureId(NS.refund, n), payment_id: paymentId, return_id: returnId, reason: 'RETURN', amount_minor: amount, status: 'SUCCEEDED', created_at: at(5 * 24 * 60).toISOString(), completed_at: at(5 * 24 * 60 + 5).toISOString() });
      refunded = amount;
    }
  }

  const status = declined ? 'DECLINED' : refunded === 0 ? 'CAPTURED' : refunded >= subtotal ? 'REFUNDED' : 'PARTIALLY_REFUNDED';
  dataset.payments.push({
    id: paymentId,
    order_id: orderId,
    status,
    amount_minor: subtotal,
    refunded_minor: refunded,
    payment_token: declined ? 'tok_decline' : 'tok_approve',
    decline_reason: declined ? 'card_declined' : null,
    created_at: order.at(0).toISOString(),
    updated_at: order.at(60).toISOString(),
  });
}
