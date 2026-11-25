import { describe, expect, it } from '@jest/globals';
import { allocateLine, allocateOrder, type WarehouseStock } from '../src/allocation';

const east = (available: number): WarehouseStock => ({ warehouseId: 'east', priority: 1, available });
const west = (available: number): WarehouseStock => ({ warehouseId: 'west', priority: 2, available });

describe('allocateLine', () => {
  it('prefers the highest-priority warehouse that can serve the whole line', () => {
    expect(allocateLine({ skuId: 's', quantity: 3 }, [west(10), east(5)])).toEqual([
      { skuId: 's', warehouseId: 'east', quantity: 3 },
    ]);
  });

  it('uses a lower-priority warehouse to avoid a split when possible', () => {
    expect(allocateLine({ skuId: 's', quantity: 6 }, [east(5), west(10)])).toEqual([
      { skuId: 's', warehouseId: 'west', quantity: 6 },
    ]);
  });

  it('splits across warehouses in priority order when no single warehouse is enough', () => {
    expect(allocateLine({ skuId: 's', quantity: 7 }, [west(4), east(5)])).toEqual([
      { skuId: 's', warehouseId: 'east', quantity: 5 },
      { skuId: 's', warehouseId: 'west', quantity: 2 },
    ]);
  });

  it('reports a shortage with total availability', () => {
    expect(allocateLine({ skuId: 's', quantity: 10 }, [east(3), west(0)])).toEqual({
      skuId: 's',
      requested: 10,
      available: 3,
    });
  });
});

describe('allocateOrder', () => {
  it('fails the whole order when any line is short', () => {
    const stock = new Map([
      ['a', [east(5)]],
      ['b', [east(1)]],
    ]);
    const result = allocateOrder(
      [
        { skuId: 'a', quantity: 2 },
        { skuId: 'b', quantity: 2 },
      ],
      stock,
    );
    expect(result).toEqual({ kind: 'short', shortages: [{ skuId: 'b', requested: 2, available: 1 }] });
  });

  it('treats an unknown SKU as zero availability', () => {
    expect(allocateOrder([{ skuId: 'x', quantity: 1 }], new Map())).toEqual({
      kind: 'short',
      shortages: [{ skuId: 'x', requested: 1, available: 0 }],
    });
  });
});
