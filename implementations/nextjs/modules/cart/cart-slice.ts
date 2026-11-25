import { createSlice, type PayloadAction } from '@reduxjs/toolkit';

// The cart is genuine client state: what the customer intends to buy and the
// unit price they saw (sent as expectedUnitPriceMinor so the server can detect
// a price change). Stock and current prices are server data and are never
// stored here.

export type CartLine = {
  readonly skuId: string;
  readonly skuCode: string;
  readonly skuLabel: string;
  readonly productName: string;
  readonly productSlug: string;
  readonly unitPriceMinor: number;
  readonly quantity: number;
};

export type CartState = { readonly lines: readonly CartLine[] };

export const MIN_LINE_QUANTITY = 1;
// Mirrors the input bounds of the checkout validation schema so the quantity
// field cannot hold values the server is guaranteed to reject.
export const MAX_LINE_QUANTITY = 100;

const initialState: CartState = { lines: [] };

function clampQuantity(quantity: number): number {
  if (!Number.isFinite(quantity)) return MIN_LINE_QUANTITY;
  return Math.min(MAX_LINE_QUANTITY, Math.max(MIN_LINE_QUANTITY, Math.trunc(quantity)));
}

export const cartSlice = createSlice({
  name: 'cart',
  initialState,
  reducers: {
    addLine(state, action: PayloadAction<CartLine>) {
      const existing = state.lines.find((line) => line.skuId === action.payload.skuId);
      if (existing) {
        existing.quantity = clampQuantity(existing.quantity + action.payload.quantity);
        existing.unitPriceMinor = action.payload.unitPriceMinor;
        return;
      }
      state.lines.push({ ...action.payload, quantity: clampQuantity(action.payload.quantity) });
    },
    setQuantity(state, action: PayloadAction<{ skuId: string; quantity: number }>) {
      const line = state.lines.find((candidate) => candidate.skuId === action.payload.skuId);
      if (line) line.quantity = clampQuantity(action.payload.quantity);
    },
    removeLine(state, action: PayloadAction<{ skuId: string }>) {
      state.lines = state.lines.filter((line) => line.skuId !== action.payload.skuId);
    },
    /** Applies the server's current prices after a PriceChanged result, once the customer accepts them. */
    acceptPrices(state, action: PayloadAction<ReadonlyArray<{ skuId: string; unitPriceMinor: number }>>) {
      for (const change of action.payload) {
        const line = state.lines.find((candidate) => candidate.skuId === change.skuId);
        if (line) line.unitPriceMinor = change.unitPriceMinor;
      }
    },
    clearCart(state) {
      state.lines = [];
    },
    hydrateCart(_state, action: PayloadAction<CartState>) {
      return action.payload;
    },
  },
});

export const { addLine, setQuantity, removeLine, acceptPrices, clearCart, hydrateCart } = cartSlice.actions;

export function cartItemCount(state: CartState): number {
  return state.lines.reduce((total, line) => total + line.quantity, 0);
}

/** Display-only estimate; the authoritative total comes back from checkout. */
export function cartEstimatedTotalMinor(state: CartState): number {
  return state.lines.reduce((total, line) => total + line.unitPriceMinor * line.quantity, 0);
}

/** Validates data read back from localStorage before trusting it. */
export function parseStoredCart(raw: unknown): CartState | null {
  if (typeof raw !== 'object' || raw === null || !Array.isArray((raw as { lines?: unknown }).lines)) return null;
  const lines = (raw as { lines: unknown[] }).lines.filter(isCartLine);
  return { lines };
}

function isCartLine(value: unknown): value is CartLine {
  if (typeof value !== 'object' || value === null) return false;
  const line = value as Record<string, unknown>;
  return (
    typeof line.skuId === 'string' &&
    typeof line.skuCode === 'string' &&
    typeof line.skuLabel === 'string' &&
    typeof line.productName === 'string' &&
    typeof line.productSlug === 'string' &&
    Number.isSafeInteger(line.unitPriceMinor) &&
    Number.isSafeInteger(line.quantity)
  );
}
