import 'server-only';
import {
  InventoryDocument,
  InventoryMovementsDocument,
  OperatorOrdersDocument,
  WarehousesDocument,
  type InventoryQuery,
  type InventoryMovementsQuery,
  type OperatorOrdersQuery,
  type WarehousesQuery,
} from '@ofl/graphql-types';
import { queryAsViewer } from './execute';

export const WAREHOUSE_PAGE_SIZE = 20;

export async function loadWarehouses(): Promise<WarehousesQuery['warehouses']> {
  return (await queryAsViewer(WarehousesDocument, {}, { returnTo: '/warehouse' })).warehouses;
}

export async function loadOrdersAwaitingShipment(
  warehouseId: string,
  after: string | null,
): Promise<OperatorOrdersQuery['orders']> {
  const result = await queryAsViewer(
    OperatorOrdersDocument,
    { first: WAREHOUSE_PAGE_SIZE, after, filter: { awaitingShipmentFromWarehouseId: warehouseId } },
    { returnTo: '/warehouse' },
  );
  return result.orders;
}

export async function loadOrdersWithReturnsAwaitingReceipt(): Promise<OperatorOrdersQuery['orders']> {
  const result = await queryAsViewer(
    OperatorOrdersDocument,
    { first: WAREHOUSE_PAGE_SIZE, filter: { withReturnsAwaitingReceipt: true } },
    { returnTo: '/warehouse/returns' },
  );
  return result.orders;
}

export async function loadInventory(options: {
  warehouseId: string | null;
  lowStockOnly: boolean;
  after: string | null;
}): Promise<InventoryQuery['inventory']> {
  const result = await queryAsViewer(
    InventoryDocument,
    { warehouseId: options.warehouseId, lowStockOnly: options.lowStockOnly, first: WAREHOUSE_PAGE_SIZE, after: options.after },
    { returnTo: '/warehouse/inventory' },
  );
  return result.inventory;
}

export async function loadMovements(options: {
  skuId: string;
  warehouseId: string | null;
  after: string | null;
}): Promise<InventoryMovementsQuery['inventoryMovements']> {
  const result = await queryAsViewer(
    InventoryMovementsDocument,
    { skuId: options.skuId, warehouseId: options.warehouseId, first: WAREHOUSE_PAGE_SIZE, after: options.after },
    { returnTo: '/warehouse/inventory' },
  );
  return result.inventoryMovements;
}
