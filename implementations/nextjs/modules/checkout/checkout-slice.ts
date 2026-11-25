import { createSlice, type PayloadAction } from '@reduxjs/toolkit';

// One checkout attempt = one idempotency key. The key is bound to a
// signature of what is being bought (lines, expected prices, payment token):
// - retrying the same cart after a network failure reuses the key, so the
//   server replays the first result instead of creating a second order;
// - any change to the cart produces a new signature and therefore a new key
//   (requirements §6.1: "The client must use a new key after it changes the cart").
// The server result itself is not stored here; it lives in the urql mutation state.

export type CheckoutPhase = 'idle' | 'submitting' | 'settled' | 'network-error';

export type CheckoutAttemptState = {
  readonly idempotencyKey: string | null;
  readonly signature: string | null;
  readonly phase: CheckoutPhase;
};

const initialState: CheckoutAttemptState = { idempotencyKey: null, signature: null, phase: 'idle' };

export const checkoutSlice = createSlice({
  name: 'checkout',
  initialState,
  reducers: {
    attemptStarted(state, action: PayloadAction<{ signature: string; newKey: string }>) {
      if (state.signature !== action.payload.signature || state.idempotencyKey === null) {
        state.idempotencyKey = action.payload.newKey;
        state.signature = action.payload.signature;
      }
      state.phase = 'submitting';
    },
    attemptSettled(state) {
      state.phase = 'settled';
    },
    attemptFailedInTransit(state) {
      state.phase = 'network-error';
    },
    /** After success or IdempotencyKeyReused the next submit must use a fresh key. */
    attemptReset() {
      return initialState;
    },
  },
});

export const { attemptStarted, attemptSettled, attemptFailedInTransit, attemptReset } = checkoutSlice.actions;

export type CheckoutSignatureInput = {
  lines: ReadonlyArray<{ skuId: string; quantity: number; expectedUnitPriceMinor: number }>;
  paymentToken: string;
};

export function checkoutSignature(input: CheckoutSignatureInput): string {
  const lines = [...input.lines]
    .sort((a, b) => a.skuId.localeCompare(b.skuId))
    .map((line) => `${line.skuId}:${line.quantity}:${line.expectedUnitPriceMinor}`);
  return `${input.paymentToken}|${lines.join(',')}`;
}
