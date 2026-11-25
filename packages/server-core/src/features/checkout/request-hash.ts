import { createHash } from 'node:crypto';
import type { CheckoutInput } from '@ofl/domain';

/**
 * SHA-256 of the canonical request: lines sorted by skuId with a fixed key
 * order, plus the payment token. The idempotency key itself is not hashed;
 * it identifies the request, the hash identifies its content.
 */
export function checkoutRequestHash(input: Pick<CheckoutInput, 'lines' | 'paymentToken'>): string {
  const lines = [...input.lines]
    .sort((a, b) => (a.skuId < b.skuId ? -1 : a.skuId > b.skuId ? 1 : 0))
    .map((line) => ({ skuId: line.skuId, quantity: line.quantity, expectedUnitPriceMinor: line.expectedUnitPriceMinor }));
  const canonical = JSON.stringify({ lines, paymentToken: input.paymentToken });
  return createHash('sha256').update(canonical, 'utf8').digest('hex');
}
