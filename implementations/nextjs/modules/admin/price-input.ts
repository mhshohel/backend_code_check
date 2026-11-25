// Parses the admin price field ("12", "12.5", "12.50") into integer cents
// without floating point. Rejected: blank, signs, hex/exponent forms, more
// than two decimals, and leading zeros such as "012". The upper bound matches
// the server-side validation of updateSkuPrice (10,000,000 minor units).

export const MAX_PRICE_MINOR = 10_000_000;

const PRICE_PATTERN = /^(0|[1-9][0-9]{0,8})(?:\.([0-9]{1,2}))?$/;

export type PriceParseResult = { ok: true; priceMinor: number } | { ok: false; message: string };

export function parsePriceToMinor(input: string): PriceParseResult {
  const text = input.trim();
  if (text === '') return { ok: false, message: 'Enter a price.' };
  const match = PRICE_PATTERN.exec(text);
  if (!match) return { ok: false, message: 'Enter a price in dollars with at most two decimals, such as 12.50.' };
  const dollars = Number(match[1]);
  const cents = Number((match[2] ?? '').padEnd(2, '0'));
  const priceMinor = dollars * 100 + cents;
  if (priceMinor > MAX_PRICE_MINOR) return { ok: false, message: 'The price is too high.' };
  return { ok: true, priceMinor };
}
