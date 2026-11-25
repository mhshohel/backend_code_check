import { createSlice, type PayloadAction } from '@reduxjs/toolkit';

/**
 * One cart line. The unit price is the price the customer saw when adding
 * the item; checkout sends it as expectedUnitPriceMinor so the server can
 * report PriceChanged instead of silently charging a different amount.
 */
export type CartLine = {
  skuId: string;
  productSlug: string;
  productName: string;
  skuCode: string;
  skuLabel: string;
  unitPriceMinor: number;
  quantity: number;
};

export type CartState = { lines: CartLine[] };

export const MAX_QUANTITY_INPUT = 100;

const initialState: CartState = { lines: [] };

function clampQuantity(quantity: number): number {
  if (!Number.isFinite(quantity)) return 1;
  return Math.min(MAX_QUANTITY_INPUT, Math.max(1, Math.trunc(quantity)));
}

export const cartSlice = createSlice({
  name: 'cart',
  initialState,
  reducers: {
    itemAdded(state, action: PayloadAction<CartLine>) {
      const existing = state.lines.find((line) => line.skuId === action.payload.skuId);
      if (existing) {
        existing.quantity = clampQuantity(existing.quantity + action.payload.quantity);
        existing.unitPriceMinor = action.payload.unitPriceMinor;
        return;
      }
      state.lines.push({ ...action.payload, quantity: clampQuantity(action.payload.quantity) });
    },
    quantityChanged(state, action: PayloadAction<{ skuId: string; quantity: number }>) {
      const line = state.lines.find((l) => l.skuId === action.payload.skuId);
      if (line) line.quantity = clampQuantity(action.payload.quantity);
    },
    itemRemoved(state, action: PayloadAction<{ skuId: string }>) {
      state.lines = state.lines.filter((line) => line.skuId !== action.payload.skuId);
    },
    pricesUpdated(state, action: PayloadAction<Array<{ skuId: string; unitPriceMinor: number }>>) {
      for (const change of action.payload) {
        const line = state.lines.find((l) => l.skuId === change.skuId);
        if (line) line.unitPriceMinor = change.unitPriceMinor;
      }
    },
    quantitiesLimited(state, action: PayloadAction<Array<{ skuId: string; available: number }>>) {
      for (const limit of action.payload) {
        if (limit.available <= 0) {
          state.lines = state.lines.filter((l) => l.skuId !== limit.skuId);
          continue;
        }
        const line = state.lines.find((l) => l.skuId === limit.skuId);
        if (line) line.quantity = clampQuantity(Math.min(line.quantity, limit.available));
      }
    },
    cartCleared(state) {
      state.lines = [];
    },
  },
});

export const { itemAdded, quantityChanged, itemRemoved, pricesUpdated, quantitiesLimited, cartCleared } =
  cartSlice.actions;
