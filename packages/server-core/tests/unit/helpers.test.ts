import { Writable } from 'node:stream';
import { describe, expect, it } from '@jest/globals';
import { buildSchema, GraphQLError, parse, validate, type DocumentNode } from 'graphql';
import * as operationDocuments from '@ofl/graphql-types';
import { loadSchemaSDL } from '@ofl/graphql-types/schema';
import { AppError } from '@ofl/domain';
import { loadConfig } from '../../src/config';
import { parseSafeInteger } from '../../src/db/db';
import { checkoutRequestHash } from '../../src/features/checkout/request-hash';
import { compareBalanceKey, sumByBalanceKey } from '../../src/features/inventory/ledger';
import { splitByShippingWarehouse } from '../../src/features/returns/operations';
import { toClientError } from '../../src/graphql/errors';
import { checkQueryCost, countRootFields, depthLimitRule, estimateCost } from '../../src/graphql/limits';
import { correlationIdFrom } from '../../src/observability/correlation';
import { createLogger } from '../../src/observability/logger';
import { createSignalChannel } from '../../src/realtime/signal-channel';
import { buildSearchRequest, decodeSearchCursor, encodeSearchCursor, normalizeSearchInput } from '../../src/search/query-builder';

describe('config', () => {
  it('parses the environment with defaults and booleans', () => {
    const config = loadConfig({ DATABASE_URL: 'postgresql://x@localhost/ofl_x', ENABLE_QUERY_COUNT: 'true', DB_POOL_MAX: '' });
    expect(config).toMatchObject({ dbPoolMax: 10, enableQueryCount: true, reservationTtlSeconds: 900, sessionTtlSeconds: 28800, esIndexPrefix: 'ofl_dev_' });
  });
  it('lists every problem in one error', () => {
    expect(() => loadConfig({ DB_POOL_MAX: '0', ES_INDEX_PREFIX: 'Bad-Prefix' })).toThrow(/DATABASE_URL[\s\S]*DB_POOL_MAX[\s\S]*ES_INDEX_PREFIX/);
    expect(() => loadConfig({ DATABASE_URL: 'postgresql://x/y', NODE_ENV: 'production' })).toThrow(/PAYMENT_WEBHOOK_SECRET/);
  });
});

describe('checkoutRequestHash', () => {
  const a = { skuId: '00000000-0000-4000-8000-00000000000a', quantity: 1, expectedUnitPriceMinor: 100 };
  const b = { skuId: '00000000-0000-4000-8000-00000000000b', quantity: 2, expectedUnitPriceMinor: 200 };
  it('ignores line order and changes with any field', () => {
    const hash = checkoutRequestHash({ lines: [a, b], paymentToken: 'tok_approve' });
    expect(hash).toMatch(/^[0-9a-f]{64}$/);
    expect(checkoutRequestHash({ lines: [b, a], paymentToken: 'tok_approve' })).toBe(hash);
    expect(checkoutRequestHash({ lines: [a, { ...b, quantity: 3 }], paymentToken: 'tok_approve' })).not.toBe(hash);
    expect(checkoutRequestHash({ lines: [a, b], paymentToken: 'tok_decline' })).not.toBe(hash);
  });
});

describe('ledger helpers', () => {
  it('sums deltas per balance key in lock order', () => {
    const totals = sumByBalanceKey([
      { skuId: 'b', warehouseId: 'w1', onHandDelta: 1, reservedDelta: 0 },
      { skuId: 'a', warehouseId: 'w2', onHandDelta: 0, reservedDelta: 2 },
      { skuId: 'a', warehouseId: 'w2', onHandDelta: 0, reservedDelta: 3 },
      { skuId: 'a', warehouseId: 'w1', onHandDelta: 4, reservedDelta: 0 },
    ]);
    expect(totals).toEqual([
      { skuId: 'a', warehouseId: 'w1', onHandDelta: 4, reservedDelta: 0 },
      { skuId: 'a', warehouseId: 'w2', onHandDelta: 0, reservedDelta: 5 },
      { skuId: 'b', warehouseId: 'w1', onHandDelta: 1, reservedDelta: 0 },
    ]);
    expect(compareBalanceKey({ skuId: 'a', warehouseId: 'x' }, { skuId: 'a', warehouseId: 'x' })).toBe(0);
  });
  it('accepts only safe integers from bigint columns', () => {
    expect(parseSafeInteger('42')).toBe(42);
    expect(() => parseSafeInteger('9007199254740993')).toThrow(RangeError);
  });
});

describe('splitByShippingWarehouse', () => {
  it('takes units from the earliest shipment first and skips returned units', () => {
    const splits = splitByShippingWarehouse(
      [{ orderLineId: 'l1', quantity: 3 }],
      [
        { orderLineId: 'l1', warehouseId: 'east', shipped: 2, returned: 1 },
        { orderLineId: 'l1', warehouseId: 'west', shipped: 3, returned: 0 },
      ],
    );
    expect(splits).toEqual([
      { orderLineId: 'l1', warehouseId: 'east', quantity: 1 },
      { orderLineId: 'l1', warehouseId: 'west', quantity: 2 },
    ]);
  });
});

describe('query cost', () => {
  const schema = buildSchema(`
    type Query { orders(first: Int): OrderConnection! viewer: User }
    type OrderConnection { edges: [Edge!]! }
    type Edge { node: Order! }
    type Order { id: ID! lines: [Line!]! }
    type Line { id: ID! sku: Sku! }
    type Sku { id: ID! }
    type User { id: ID! }
  `);
  it('charges root and paged fields a base cost and multiplies by first', () => {
    const query = parse('query($n: Int) { orders(first: $n) { edges { node { lines { sku { id } } } } } viewer { id } }');
    // orders: 10 + n * edges(1 + node(1 + lines(1 + 5 * sku(1)))); viewer: 10. edges is bounded by first.
    const perEdge = 1 + (1 + (1 + 5 * 1));
    expect(estimateCost(schema, query, null, { n: 10 })).toBe(10 + 10 * perEdge + 10);
    expect(estimateCost(schema, query, null, {})).toBe(10 + 20 * perEdge + 10);
    expect(estimateCost(schema, parse('fragment F on Order { lines { id } } { orders(first: 2) { edges { node { ...F } } } }'), null, {})).toBe(
      10 + 2 * (1 + (1 + 1)),
    );
  });

  it('counts every aliased root field, including scalar ones', () => {
    const aliases = Array.from({ length: 30 }, (_, i) => `a${i}: viewer { id }`).join(' ');
    const document = parse(`{ ${aliases} }`);
    expect(countRootFields(document, null)).toBe(30);
    expect(estimateCost(schema, document, null, {})).toBe(300);
    expect(countRootFields(parse('fragment R on Query { viewer { id } } { ...R __typename x: viewer { id } }'), null)).toBe(2);
  });
});

describe('cost of the contract operations', () => {
  const contractSchema = buildSchema(loadSchemaSDL());
  const operations = Object.entries(operationDocuments).filter((entry): entry is [string, DocumentNode] => entry[0].endsWith('Document'));

  it.each(operations.map(([name, document]) => [name, document] as const))('%s stays within the limits at the largest page size', (_name, document) => {
    const variables = { first: 50, limit: 10, days: 90, threshold: 5 };
    expect(checkQueryCost(contractSchema, document, null, variables)).toBeNull();
    expect(validate(contractSchema, document, [depthLimitRule()])).toEqual([]);
  });

  it('bounds alias fan-out: at most 20 root fields, and each paged root field is charged per item', () => {
    const aliased = (count: number, selection: string) => parse(`{ ${Array.from({ length: count }, (_, i) => `s${i}: ${selection}`).join(' ')} }`);
    expect(checkQueryCost(contractSchema, aliased(300, 'searchProducts(first: 1) { totalCount }'), null, {})?.extensions.code).toBe('QUERY_TOO_COMPLEX');
    expect(checkQueryCost(contractSchema, aliased(21, 'searchProducts(first: 1) { totalCount }'), null, {})?.extensions.code).toBe('QUERY_TOO_COMPLEX');
    const page = 'searchProducts(first: 50) { edges { node { name } } }';
    expect(estimateCost(contractSchema, aliased(1, page), null, {})).toBe(10 + 50 * (1 + 1));
    expect(checkQueryCost(contractSchema, aliased(20, page), null, {})).toBeNull();
    const nested = 'searchProducts(first: 50) { edges { node { fromPrice { amountMinor } } } facets { categories { value } priceRanges { value } } }';
    expect(checkQueryCost(contractSchema, aliased(20, nested), null, {})?.extensions.code).toBe('QUERY_TOO_COMPLEX');
  });
});

describe('search query builder', () => {
  it('puts filters in post_filter and leaves each facet its own dimension', () => {
    const input = normalizeSearchInput({ text: ' lamp ', categorySlugs: ['a'], minPriceMinor: 100, maxPriceMinor: 500, inStockOnly: true, sort: 'PRICE_ASC' });
    const request = buildSearchRequest(input, { first: 10, after: null });
    expect(request.size).toBe(11);
    expect(JSON.stringify(request.post_filter)).toContain('"categorySlug"');
    const aggs = request.aggs ?? {};
    expect(JSON.stringify(aggs.categories?.filter)).not.toContain('categorySlug');
    expect(JSON.stringify(aggs.categories?.filter)).toContain('inStock');
    expect(JSON.stringify(aggs.prices?.filter)).not.toContain('minPriceMinor');
    expect(JSON.stringify(aggs.availability?.filter)).not.toContain('inStock');
    expect(request.sort).toEqual([{ minPriceMinor: { order: 'asc' } }, { id: { order: 'asc' } }]);
  });
  it('validates ranges and round-trips cursors', () => {
    expect(() => normalizeSearchInput({ minPriceMinor: 500, maxPriceMinor: 500 })).toThrow(AppError);
    const cursor = encodeSearchCursor('PRICE_ASC', [1500, 'abc']);
    expect(decodeSearchCursor(cursor, 'PRICE_ASC')).toEqual([1500, 'abc']);
    expect(() => decodeSearchCursor('not-a-cursor', 'PRICE_ASC')).toThrow(AppError);
    // A cursor from another sort, or with the wrong value types, is rejected (F6).
    expect(() => decodeSearchCursor(cursor, 'NEWEST')).toThrow(AppError);
    const forged = Buffer.from(JSON.stringify(['PRICE_ASC', 'not-a-number', 'x'])).toString('base64url');
    expect(() => decodeSearchCursor(forged, 'PRICE_ASC')).toThrow(AppError);
  });
});

describe('signal channel', () => {
  it('coalesces notifications and ends on close', async () => {
    const channel = createSignalChannel();
    channel.notify();
    channel.notify();
    expect(await channel.next()).toEqual({ value: undefined, done: false });
    const waiting = channel.next();
    channel.close();
    expect(await waiting).toEqual({ value: undefined, done: true });
  });
});

describe('error masking', () => {
  const silent = createLogger({ level: 'silent' });
  it('maps AppError to its code and field errors', () => {
    const error = new GraphQLError('wrapped', { path: ['x'], originalError: new AppError('BAD_USER_INPUT', 'Bad.', [{ path: 'a', message: 'b' }]) });
    expect(toClientError(error, silent).toJSON()).toMatchObject({ message: 'Bad.', extensions: { code: 'BAD_USER_INPUT', fieldErrors: [{ path: 'a', message: 'b' }] } });
  });
  it('hides unexpected resolver errors', () => {
    const error = new GraphQLError('relation "secret" does not exist', { path: ['x'], originalError: new Error('relation "secret" does not exist') });
    const masked = toClientError(error, silent, 'corr-12345678');
    expect(masked.message).toBe('Internal server error.');
    expect(masked.extensions).toEqual({ code: 'INTERNAL_SERVER_ERROR', correlationId: 'corr-12345678' });
  });
});

describe('observability', () => {
  it('validates or generates correlation ids', () => {
    expect(correlationIdFrom('abc-12345678')).toBe('abc-12345678');
    expect(correlationIdFrom('bad id with spaces')).toMatch(/^[0-9a-f-]{36}$/);
    expect(correlationIdFrom(undefined)).toMatch(/^[0-9a-f-]{36}$/);
  });
  it('redacts personal data and secrets in logs', () => {
    const lines: string[] = [];
    const destination = new Writable({
      write(chunk: Buffer, _encoding, callback) {
        lines.push(chunk.toString());
        callback();
      },
    });
    const logger = createLogger({ level: 'info', destination });
    logger.info({ email: 'a@b.c', user: { password: 'p', token: 't' }, req: { headers: { cookie: 'ofl_session=x' } } }, 'hello');
    const output = lines.join('');
    expect(output).not.toContain('a@b.c');
    expect(output).not.toContain('ofl_session=x');
    expect(output).toContain('[redacted]');
  });
});
