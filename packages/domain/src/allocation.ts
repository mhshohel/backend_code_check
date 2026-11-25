// Stock allocation decides which warehouses serve each order line.
// Policy (documented in docs/workflows.md):
//   1. If one warehouse can serve the whole line, use the highest-priority
//      warehouse that can. This avoids split shipments.
//   2. Otherwise split the line across warehouses in priority order.
//   3. If total availability is lower than the request, the line is short.

export type WarehouseStock = {
  readonly warehouseId: string;
  readonly priority: number;
  readonly available: number;
};

export type LineRequest = {
  readonly skuId: string;
  readonly quantity: number;
};

export type Allocation = {
  readonly skuId: string;
  readonly warehouseId: string;
  readonly quantity: number;
};

export type Shortage = {
  readonly skuId: string;
  readonly requested: number;
  readonly available: number;
};

export type AllocationResult =
  | { readonly kind: 'allocated'; readonly allocations: readonly Allocation[] }
  | { readonly kind: 'short'; readonly shortages: readonly Shortage[] };

export function allocateLine(line: LineRequest, stock: readonly WarehouseStock[]): Allocation[] | Shortage {
  const candidates = [...stock]
    .filter((s) => s.available > 0)
    .sort((a, b) => a.priority - b.priority);

  const totalAvailable = candidates.reduce((sum, s) => sum + s.available, 0);
  if (totalAvailable < line.quantity) {
    return { skuId: line.skuId, requested: line.quantity, available: totalAvailable };
  }

  const singleSource = candidates.find((s) => s.available >= line.quantity);
  if (singleSource) {
    return [{ skuId: line.skuId, warehouseId: singleSource.warehouseId, quantity: line.quantity }];
  }

  const allocations: Allocation[] = [];
  let remaining = line.quantity;
  for (const source of candidates) {
    if (remaining === 0) break;
    const take = Math.min(source.available, remaining);
    allocations.push({ skuId: line.skuId, warehouseId: source.warehouseId, quantity: take });
    remaining -= take;
  }
  return allocations;
}

/** Allocates every line or reports every short line. Never partially succeeds. */
export function allocateOrder(
  lines: readonly LineRequest[],
  stockBySku: ReadonlyMap<string, readonly WarehouseStock[]>,
): AllocationResult {
  const allocations: Allocation[] = [];
  const shortages: Shortage[] = [];

  for (const line of lines) {
    const result = allocateLine(line, stockBySku.get(line.skuId) ?? []);
    if (Array.isArray(result)) {
      allocations.push(...result);
    } else {
      shortages.push(result);
    }
  }

  if (shortages.length > 0) {
    return { kind: 'short', shortages };
  }
  return { kind: 'allocated', allocations };
}
