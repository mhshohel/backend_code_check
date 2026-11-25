// Money is always an integer number of minor units (cents). JavaScript
// numbers are exact for integers up to 2^53, so every operation checks that
// the result is still a safe integer instead of silently losing precision.

export const CURRENCY = 'USD';

export type Money = {
  readonly amountMinor: number;
  readonly currency: typeof CURRENCY;
};

export function money(amountMinor: number): Money {
  assertSafeMinor(amountMinor);
  return { amountMinor, currency: CURRENCY };
}

export function addMinor(a: number, b: number): number {
  const sum = a + b;
  assertSafeMinor(sum);
  return sum;
}

export function multiplyMinor(unitMinor: number, quantity: number): number {
  if (!Number.isSafeInteger(quantity)) {
    throw new RangeError(`Quantity must be an integer, got ${quantity}`);
  }
  const product = unitMinor * quantity;
  assertSafeMinor(product);
  return product;
}

export function sumMinor(values: readonly number[]): number {
  return values.reduce(addMinor, 0);
}

export function formatMoney(amountMinor: number, currency: string = CURRENCY): string {
  const sign = amountMinor < 0 ? '-' : '';
  const absolute = Math.abs(amountMinor);
  const major = Math.trunc(absolute / 100);
  const minor = String(absolute % 100).padStart(2, '0');
  const symbol = currency === 'USD' ? '$' : `${currency} `;
  return `${sign}${symbol}${major.toLocaleString('en-US')}.${minor}`;
}

function assertSafeMinor(value: number): void {
  if (!Number.isSafeInteger(value)) {
    throw new RangeError(`Money must be a safe integer of minor units, got ${value}`);
  }
}
