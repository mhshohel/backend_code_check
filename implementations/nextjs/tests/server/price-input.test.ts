import { describe, expect, it } from '@jest/globals';
import { MAX_PRICE_MINOR, parsePriceToMinor } from '@/modules/admin/price-input';

describe('parsePriceToMinor', () => {
  it.each([
    ['12', 1200],
    ['12.5', 1250],
    ['12.50', 1250],
    [' 0.99 ', 99],
    ['0', 0],
    ['100000', MAX_PRICE_MINOR],
    ['0.07', 7],
    ['19.99', 1999],
  ])('parses %p to %p cents without floating point', (input, expected) => {
    expect(parsePriceToMinor(input)).toEqual({ ok: true, priceMinor: expected });
  });

  it.each(['', '   ', '0x10', '1e3', '-1', '+1', '12.345', '12.', '.5', '012', '1,000', 'NaN', 'Infinity', '12 50', '100000.01'])(
    'rejects %p',
    (input) => {
      expect(parsePriceToMinor(input).ok).toBe(false);
    },
  );
});
