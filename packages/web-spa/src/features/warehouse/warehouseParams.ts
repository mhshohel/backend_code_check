// URL parameters of the warehouse dashboard. Every list has its own cursor
// parameter so "Load more" in one list does not reset another.
export const WAREHOUSE_PARAMS = {
  warehouse: 'warehouse',
  lowStock: 'lowStock',
  sku: 'sku',
  skuWarehouse: 'skuWarehouse',
} as const;

export const CURSOR_PARAMS = {
  shipments: 'shipAfter',
  returns: 'returnsAfter',
  inventory: 'inventoryAfter',
  movements: 'movementsAfter',
} as const;

export const ALL_CURSOR_PARAMS: readonly string[] = Object.values(CURSOR_PARAMS);
