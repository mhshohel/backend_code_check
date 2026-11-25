import pg from 'pg';
import { assertResettable, hashPassword, migrate, truncateAllData, type AppConfig, type Queryable } from '@ofl/server-core';
import { writeDataset } from './dataset';
import { fixtureId } from './ids';
import { benchOptions, loadBenchData, type BenchOptions } from './profiles/bench';
import { buildContractDataset } from './profiles/contract';
import { buildDemoDataset } from './profiles/demo';

export type FixtureProfile = 'contract' | 'demo' | 'bench';
export const FIXTURE_PROFILES: readonly FixtureProfile[] = ['contract', 'demo', 'bench'];

export type ResetOptions = { now?: Date; bench?: Partial<BenchOptions> };

/**
 * Migrates, empties every data table, and loads the profile, all in one
 * transaction for the data part. Safe to run while an API is up: the API
 * caches no rows across requests. Search indexes are not touched; run
 * `ofl reindex` (ofl-seed does it) to rebuild them.
 */
export async function resetToFixture(config: AppConfig, profile: FixtureProfile, options: ResetOptions = {}): Promise<void> {
  assertResettable(config);
  await migrate(config);
  const client = new pg.Client({ connectionString: config.databaseUrl, application_name: 'ofl-fixtures' });
  await client.connect();
  try {
    await client.query('BEGIN');
    await truncateAllData(client);
    await loadProfile(client, profile, options);
    await client.query('COMMIT');
  } catch (error) {
    await client.query('ROLLBACK').catch(() => undefined);
    throw error;
  } finally {
    await client.end();
  }
}

async function loadProfile(db: Queryable, profile: FixtureProfile, options: ResetOptions): Promise<void> {
  const now = options.now ?? new Date();
  switch (profile) {
    case 'contract':
      await writeDataset(db, await buildContractDataset(now));
      return;
    case 'demo':
      await writeDataset(db, await buildDemoDataset(now));
      return;
    case 'bench': {
      await writeDataset(db, await buildDemoDataset(now));
      const defaults = benchOptions(undefined);
      await loadBenchData(db, { ...defaults, ...options.bench });
      return;
    }
  }
}

export type CreatedCustomer = { id: string; email: string; password: string; displayName: string };

let sharedHash: { password: string; hash: Promise<string> } | null = null;

/**
 * Creates `count` customer accounts (for concurrency scenarios). All share
 * one password so only one Argon2 hash is computed. Emails are unique per
 * call through the prefix (default: a timestamp).
 */
export async function createCustomers(
  db: Queryable,
  count: number,
  options: { prefix?: string; password?: string } = {},
): Promise<CreatedCustomer[]> {
  const password = options.password ?? 'customer-pass-1';
  if (!sharedHash || sharedHash.password !== password) sharedHash = { password, hash: hashPassword(password) };
  const passwordHash = await sharedHash.hash;
  const prefix = options.prefix ?? `c${Date.now().toString(36)}`;
  const result = await db.query<{ id: string; email: string; displayName: string }>(
    `INSERT INTO users (email, display_name, password_hash, role)
     SELECT $1 || '-' || i || '@example.com', 'Test Customer ' || i, $2, 'CUSTOMER'
     FROM generate_series(1, $3::int) AS i
     RETURNING id, email, display_name AS "displayName"`,
    [prefix, passwordHash, count],
  );
  return result.rows.map((row) => ({ ...row, password }));
}

export { fixtureId };
