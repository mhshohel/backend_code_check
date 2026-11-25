import { describe, expect, it } from '@jest/globals';
import { PAGE_SIZE, parsePriceRange, parseSearchState, toQueryString, toSearchVariables } from '@/modules/catalog/search-params';

describe('catalog URL state', () => {
  it('parses filters and ignores invalid values', () => {
    const state = parseSearchState({ q: '  lamp ', category: ['a', 'a', 'b'], price: 'cheap', sort: 'DROP TABLE', stock: 'in_stock' });
    expect(state).toEqual({ text: 'lamp', categorySlugs: ['a', 'b'], priceRange: null, inStockOnly: true, sort: 'RELEVANCE', after: null });
  });

  it('maps price buckets to min inclusive / max exclusive bounds', () => {
    expect(parsePriceRange('2500-5000')).toEqual({ minPriceMinor: 2500, maxPriceMinor: 5000 });
    expect(parsePriceRange('25000-')).toEqual({ minPriceMinor: 25000, maxPriceMinor: null });
    expect(parsePriceRange(null)).toEqual({ minPriceMinor: null, maxPriceMinor: null });
  });

  it('builds GraphQL variables', () => {
    const variables = toSearchVariables(parseSearchState({ q: 'lamp', price: '0-2500', sort: 'PRICE_ASC', after: 'c1' }));
    expect(variables).toEqual({
      input: { text: 'lamp', categorySlugs: null, minPriceMinor: 0, maxPriceMinor: 2500, inStockOnly: false, sort: 'PRICE_ASC' },
      first: PAGE_SIZE,
      after: 'c1',
    });
  });

  it('round-trips through the query string', () => {
    const query = '?q=lamp&category=a&category=b&price=2500-5000&stock=in_stock&sort=NEWEST&after=x';
    const params = Object.fromEntries(['q', 'price', 'stock', 'sort', 'after'].map((key) => [key, new URLSearchParams(query).get(key) ?? undefined]));
    const state = parseSearchState({ ...params, category: ['a', 'b'] });
    expect(toQueryString(state)).toBe(query);
  });
});
