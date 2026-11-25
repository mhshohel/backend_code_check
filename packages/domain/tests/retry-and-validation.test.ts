import { describe, expect, it } from '@jest/globals';
import { backoffDelayMs, classifyError, isTransactionConflict } from '../src/retry';
import { AppError } from '../src/errors';
import { checkoutInputSchema, pageSize, parseInput } from '../src/validation';
import { decodeCursor, encodeCursor } from '../src/cursor';

describe('classifyError', () => {
  it.each([
    [{ code: '40001' }, 'RETRYABLE'],
    [{ code: '40P01' }, 'RETRYABLE'],
    [{ code: 'ECONNRESET' }, 'RETRYABLE'],
    [{ statusCode: 503 }, 'RETRYABLE'],
    [{ meta: { statusCode: 429 } }, 'RETRYABLE'],
    [{ code: '57P01' }, 'RETRYABLE'],
    [{ code: '57P02' }, 'RETRYABLE'],
    [{ code: '57P03' }, 'RETRYABLE'],
    [{ code: '08003' }, 'RETRYABLE'],
    [{ code: '23505' }, 'PERMANENT'],
    [{ statusCode: 400 }, 'PERMANENT'],
    [{ retryable: false, code: '40001' }, 'PERMANENT'],
    ['boom', 'PERMANENT'],
  ] as const)('%j is %s', (error, expected) => {
    expect(classifyError(error)).toBe(expected);
  });

  it('treats node-postgres connection loss (no code) as retryable', () => {
    expect(classifyError(new Error('Connection terminated unexpectedly'))).toBe('RETRYABLE');
    expect(classifyError(new Error('Connection terminated due to connection timeout'))).toBe('RETRYABLE');
    expect(classifyError(new Error('timeout exceeded when trying to connect'))).toBe('RETRYABLE');
    expect(classifyError(new Error('relation "x" does not exist'))).toBe('PERMANENT');
  });

  it('detects transaction conflicts for in-request retries', () => {
    expect(isTransactionConflict({ code: '40P01' })).toBe(true);
    expect(isTransactionConflict({ code: '23505' })).toBe(false);
  });
});

describe('backoffDelayMs', () => {
  it('grows exponentially and stays under the cap', () => {
    const max = () => 0.999999;
    expect(backoffDelayMs(0, { baseMs: 100, maxMs: 10_000, random: max })).toBe(99);
    expect(backoffDelayMs(3, { baseMs: 100, maxMs: 10_000, random: max })).toBe(799);
    expect(backoffDelayMs(20, { baseMs: 100, maxMs: 10_000, random: max })).toBe(9999);
  });
});

describe('input validation', () => {
  const validLine = { skuId: '00000000-0000-4000-8000-000000000001', quantity: 1, expectedUnitPriceMinor: 100 };

  it('returns field errors for invalid checkout input', () => {
    try {
      parseInput(checkoutInputSchema, { idempotencyKey: 'short', lines: [], paymentToken: 'tok_approve' });
      throw new Error('expected failure');
    } catch (error) {
      expect(error).toBeInstanceOf(AppError);
      const appError = error as AppError;
      expect(appError.code).toBe('BAD_USER_INPUT');
      expect(appError.fieldErrors.map((e) => e.path)).toEqual(['idempotencyKey', 'lines']);
    }
  });

  it('rejects duplicate SKUs in one checkout', () => {
    const result = checkoutInputSchema.safeParse({
      idempotencyKey: 'abcdefgh',
      lines: [validLine, validLine],
      paymentToken: 'tok_approve',
    });
    expect(result.success).toBe(false);
  });

  it('clamps page sizes', () => {
    expect(pageSize(undefined)).toBe(20);
    expect(pageSize(50)).toBe(50);
    expect(() => pageSize(51)).toThrow(AppError);
    expect(() => pageSize(0)).toThrow(AppError);
  });

  it('round-trips cursors and rejects tampered values', () => {
    const cursor = { sortKey: '2026-01-01T00:00:00.000Z', id: 'abc' };
    expect(decodeCursor(encodeCursor(cursor))).toEqual(cursor);
    expect(() => decodeCursor('not-a-cursor')).toThrow(AppError);
  });
});

describe('isAppError', () => {
  it('recognizes an AppError from another module copy by its brand', async () => {
    const { isAppError } = await import('../src/errors');
    const foreign = Object.assign(new Error('x'), { code: 'NOT_FOUND', [Symbol.for('ofl.AppError')]: true });
    expect(isAppError(foreign)).toBe(true);
    expect(isAppError(new Error('plain'))).toBe(false);
  });
});
