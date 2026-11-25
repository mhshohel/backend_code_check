import pg from 'pg';
import { backoffDelayMs, isTransactionConflict } from '@ofl/domain';

export type SqlParams = readonly unknown[];
export type Row = pg.QueryResultRow;

/** Anything that runs one SQL statement: the pool or a transaction client. */
export type Queryable = {
  query<R extends Row = Row>(text: string, params?: SqlParams): Promise<pg.QueryResult<R>>;
};

/** A client inside an open transaction. */
export type Tx = Queryable;

export type QueryCounter = { count: number };

export type TransactionOptions = {
  /** Extra attempts after a serialization failure or deadlock. Default 3. */
  retries?: number;
};

export type Db = Queryable & {
  readonly pool: pg.Pool;
  transaction<T>(work: (tx: Tx) => Promise<T>, options?: TransactionOptions): Promise<T>;
  /** Same pool, but every statement also increments the counter. */
  withCounter(counter: QueryCounter): Db;
  close(): Promise<void>;
};

export type DbOptions = {
  connectionString: string;
  max: number;
  statementTimeoutMs: number;
  applicationName?: string;
};

const INT8_OID = 20;
const NUMERIC_OID = 1700;

/**
 * bigint columns hold money and counters. They are returned as JS numbers,
 * but only when exact; a larger value is a bug we want to see immediately.
 */
export function parseSafeInteger(value: string): number {
  const parsed = Number(value);
  if (!Number.isSafeInteger(parsed)) {
    throw new RangeError(`Integer ${value} is outside the safe JavaScript range.`);
  }
  return parsed;
}

function parseNumeric(value: string): number {
  const parsed = Number(value);
  if (!Number.isFinite(parsed)) throw new RangeError(`Numeric ${value} cannot be represented.`);
  if (Number.isInteger(parsed) && !Number.isSafeInteger(parsed)) {
    throw new RangeError(`Numeric ${value} is outside the safe JavaScript range.`);
  }
  return parsed;
}

const typeParsers: pg.CustomTypesConfig = {
  getTypeParser: ((oid: number, format?: string) => {
    if (format !== 'binary') {
      if (oid === INT8_OID) return parseSafeInteger;
      if (oid === NUMERIC_OID) return parseNumeric;
    }
    return pg.types.getTypeParser(oid, format === 'binary' ? 'binary' : 'text');
  }) as pg.CustomTypesConfig['getTypeParser'],
};

export function createDb(options: DbOptions): Db {
  const pool = new pg.Pool({
    connectionString: options.connectionString,
    max: options.max,
    // Every pooled connection gets a server-side statement timeout, so a
    // stuck query cannot hold a connection (and its locks) forever.
    statement_timeout: options.statementTimeoutMs,
    idle_in_transaction_session_timeout: Math.max(options.statementTimeoutMs * 2, 10_000),
    application_name: options.applicationName ?? 'ofl',
    connectionTimeoutMillis: 10_000,
    types: typeParsers,
  });
  // An idle client can lose its connection (server restart). Without a
  // listener the pool would emit an unhandled 'error' event and crash.
  pool.on('error', () => undefined);
  return buildDb(pool, null);
}

function buildDb(pool: pg.Pool, counter: QueryCounter | null): Db {
  const count = () => {
    if (counter) counter.count += 1;
  };
  return {
    pool,
    query: <R extends Row>(text: string, params?: SqlParams) => {
      count();
      return pool.query<R>(text, params ? [...params] : undefined);
    },
    transaction: (work, txOptions) => runTransaction(pool, work, txOptions?.retries ?? 3, count),
    withCounter: (nextCounter) => buildDb(pool, nextCounter),
    close: () => pool.end(),
  };
}

async function runTransaction<T>(
  pool: pg.Pool,
  work: (tx: Tx) => Promise<T>,
  retries: number,
  count: () => void,
): Promise<T> {
  for (let attempt = 0; ; attempt += 1) {
    try {
      return await runOnce(pool, work, count);
    } catch (error) {
      if (attempt >= retries || !isTransactionConflict(error)) throw error;
      await delay(backoffDelayMs(attempt, { baseMs: 20, maxMs: 250 }) + 5);
    }
  }
}

async function runOnce<T>(pool: pg.Pool, work: (tx: Tx) => Promise<T>, count: () => void): Promise<T> {
  const client = await pool.connect();
  const tx: Tx = {
    query: <R extends Row>(text: string, params?: SqlParams) => {
      count();
      return client.query<R>(text, params ? [...params] : undefined);
    },
  };
  let broken = false;
  try {
    await client.query('BEGIN ISOLATION LEVEL READ COMMITTED');
    const result = await work(tx);
    await client.query('COMMIT');
    return result;
  } catch (error) {
    try {
      await client.query('ROLLBACK');
    } catch {
      broken = true;
    }
    throw error;
  } finally {
    // A client whose rollback failed is in an unknown state: destroy it.
    client.release(broken ? true : undefined);
  }
}

function delay(ms: number): Promise<void> {
  return new Promise((resolve) => setTimeout(resolve, ms));
}

/** Returns the single row or null. Throws when the query returns more than one row. */
export async function queryOne<R extends Row>(db: Queryable, text: string, params?: SqlParams): Promise<R | null> {
  const result = await db.query<R>(text, params);
  if (result.rows.length > 1) throw new Error('Expected at most one row.');
  return result.rows[0] ?? null;
}

export async function queryRows<R extends Row>(db: Queryable, text: string, params?: SqlParams): Promise<R[]> {
  const result = await db.query<R>(text, params);
  return result.rows;
}
