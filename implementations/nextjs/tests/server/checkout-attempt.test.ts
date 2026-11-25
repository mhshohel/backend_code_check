import { describe, expect, it } from '@jest/globals';
import { attemptFailedInTransit, attemptReset, attemptStarted, checkoutSignature, checkoutSlice } from '@/modules/checkout/checkout-slice';

const reduce = checkoutSlice.reducer;

describe('checkout attempt key', () => {
  const signature = checkoutSignature({ lines: [{ skuId: 'b', quantity: 1, expectedUnitPriceMinor: 5 }, { skuId: 'a', quantity: 2, expectedUnitPriceMinor: 7 }], paymentToken: 'tok_approve' });

  it('is independent of line order', () => {
    const reordered = checkoutSignature({ lines: [{ skuId: 'a', quantity: 2, expectedUnitPriceMinor: 7 }, { skuId: 'b', quantity: 1, expectedUnitPriceMinor: 5 }], paymentToken: 'tok_approve' });
    expect(reordered).toBe(signature);
  });

  it('reuses the key for the same cart after a network failure, and replaces it when the cart changes', () => {
    let state = reduce(undefined, attemptStarted({ signature, newKey: 'key-1' }));
    state = reduce(state, attemptFailedInTransit());
    state = reduce(state, attemptStarted({ signature, newKey: 'key-2' }));
    expect(state.idempotencyKey).toBe('key-1');

    state = reduce(state, attemptStarted({ signature: `${signature}-changed`, newKey: 'key-3' }));
    expect(state.idempotencyKey).toBe('key-3');

    state = reduce(state, attemptReset());
    state = reduce(state, attemptStarted({ signature: `${signature}-changed`, newKey: 'key-4' }));
    expect(state.idempotencyKey).toBe('key-4');
  });
});
