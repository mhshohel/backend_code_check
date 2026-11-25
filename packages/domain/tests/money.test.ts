import { describe, expect, it } from '@jest/globals';
import { addMinor, formatMoney, multiplyMinor, sumMinor } from '../src/money';

describe('money', () => {
  it('adds and multiplies integer minor units exactly', () => {
    // 0.1 + 0.2 is not 0.3 in floating point; 10 + 20 cents is exactly 30.
    expect(addMinor(10, 20)).toBe(30);
    expect(multiplyMinor(1999, 3)).toBe(5997);
    expect(sumMinor([1999, 1, 5000])).toBe(7000);
  });

  it('rejects fractional quantities and unsafe results', () => {
    expect(() => multiplyMinor(100, 1.5)).toThrow(RangeError);
    expect(() => multiplyMinor(Number.MAX_SAFE_INTEGER, 2)).toThrow(RangeError);
  });

  it('formats minor units for display', () => {
    expect(formatMoney(123456)).toBe('$1,234.56');
    expect(formatMoney(5)).toBe('$0.05');
    expect(formatMoney(-250)).toBe('-$2.50');
  });
});
