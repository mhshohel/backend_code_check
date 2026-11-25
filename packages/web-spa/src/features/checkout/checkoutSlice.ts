import { createSlice, isAnyOf, type PayloadAction } from '@reduxjs/toolkit';
import { cartSlice } from '../cart/cartSlice';

export type PaymentToken = 'tok_approve' | 'tok_decline' | 'tok_slow_approve';

/**
 * The current checkout attempt. The idempotency key is created once per
 * attempt and kept until the server gives a definitive answer, so a retry
 * after a network failure replays the first request instead of creating a
 * second order. Any change to the request (cart or payment token) starts a
 * new attempt: the old key would be reported as IdempotencyKeyReused.
 */
export type CheckoutState = {
  idempotencyKey: string | null;
  paymentToken: PaymentToken;
};

const initialState: CheckoutState = { idempotencyKey: null, paymentToken: 'tok_approve' };

export function generateIdempotencyKey(): string {
  if (typeof crypto.randomUUID === 'function') return crypto.randomUUID();
  const bytes = crypto.getRandomValues(new Uint8Array(16));
  return Array.from(bytes, (b) => b.toString(16).padStart(2, '0')).join('');
}

export const checkoutSlice = createSlice({
  name: 'checkout',
  initialState,
  reducers: {
    attemptStarted: {
      reducer(state, action: PayloadAction<string>) {
        state.idempotencyKey ??= action.payload;
      },
      prepare() {
        return { payload: generateIdempotencyKey() };
      },
    },
    attemptFinished(state) {
      state.idempotencyKey = null;
    },
    paymentTokenChosen(state, action: PayloadAction<PaymentToken>) {
      if (state.paymentToken !== action.payload) state.idempotencyKey = null;
      state.paymentToken = action.payload;
    },
  },
  extraReducers: (builder) => {
    const { itemAdded, quantityChanged, itemRemoved, pricesUpdated, quantitiesLimited, cartCleared } = cartSlice.actions;
    builder.addMatcher(
      isAnyOf(itemAdded, quantityChanged, itemRemoved, pricesUpdated, quantitiesLimited, cartCleared),
      (state) => {
        state.idempotencyKey = null;
      },
    );
  },
});

export const { attemptStarted, attemptFinished, paymentTokenChosen } = checkoutSlice.actions;
