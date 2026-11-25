import { createHash } from 'node:crypto';
import { readdir, readFile } from 'node:fs/promises';
import { fileURLToPath } from 'node:url';
import path from 'node:path';
import pg from 'pg';
import type { AppConfig } from '../config';
import type { Queryable } from './db';

const here = path.dirname(fileURLToPath(import.meta.url));

/** Computed lazily (no `new URL(literal, import.meta.url)`), so bundlers do not treat it as an asset. */
export function migrationsDir(): string {
  return process.env.OFL_MIGRATIONS_DIR ?? path.resolve(here, '../../../../infrastructure/postgres/migrations');
}

// Arbitrary constant. Every process that migrates the same database takes
// this advisory lock, so two concurrent `migrate` runs apply each file once.
const MIGRATION_LOCK_KEY = 4_100_100;

export type MigrationFile = { version: string; fileName: string; sql: string; checksum: string };

export async function readMigrationFiles(directory: string = migrationsDir()): Promise<MigrationFile[]> {
  const names = (await readdir(directory)).filter((name) => /^\d{4}_[\w-]+\.sql$/.test(name)).sort();
  return Promise.all(
    names.map(async (fileName) => {
      const sql = await readFile(path.join(directory, fileName), 'utf8');
      return {
        version: fileName.slice(0, 4),
        fileName,
        sql,
        checksum: createHash('sha256').update(sql).digest('hex'),
      };
    }),
  );
}

export type MigrationReport = { applied: string[]; skipped: string[] };

/** Applies pending migrations in file-name order, each in its own transaction. */
export async function migrate(config: AppConfig): Promise<MigrationReport> {
  const client = new pg.Client({ connectionString: config.databaseUrl, application_name: 'ofl-migrate' });
  await client.connect();
  try {
    return await migrateWithClient(client);
  } finally {
    await client.end();
  }
}

export async function migrateWithClient(client: pg.Client): Promise<MigrationReport> {
  await client.query('SELECT pg_advisory_lock($1)', [MIGRATION_LOCK_KEY]);
  try {
    await client.query(`
      CREATE TABLE IF NOT EXISTS schema_migrations (
        version     text PRIMARY KEY,
        file_name   text NOT NULL,
        checksum    text NOT NULL,
        applied_at  timestamptz NOT NULL DEFAULT now()
      )`);
    const existing = await client.query<{ version: string; checksum: string; file_name: string }>(
      'SELECT version, checksum, file_name FROM schema_migrations',
    );
    const appliedByVersion = new Map(existing.rows.map((row) => [row.version, row]));
    const report: MigrationReport = { applied: [], skipped: [] };

    for (const file of await readMigrationFiles()) {
      const previous = appliedByVersion.get(file.version);
      if (previous) {
        if (previous.checksum !== file.checksum) {
          throw new Error(`Migration ${file.fileName} changed after it was applied. Add a new migration instead.`);
        }
        report.skipped.push(file.fileName);
        continue;
      }
      await client.query('BEGIN');
      try {
        await client.query(file.sql);
        await client.query('INSERT INTO schema_migrations (version, file_name, checksum) VALUES ($1, $2, $3)', [
          file.version,
          file.fileName,
          file.checksum,
        ]);
        await client.query('COMMIT');
        report.applied.push(file.fileName);
      } catch (error) {
        await client.query('ROLLBACK');
        throw new Error(`Migration ${file.fileName} failed: ${(error as Error).message}`, { cause: error });
      }
    }
    return report;
  } finally {
    await client.query('SELECT pg_advisory_unlock($1)', [MIGRATION_LOCK_KEY]);
  }
}

/** Drops every object in the public schema, then migrates from scratch. Development and tests only. */
export async function resetDatabase(config: AppConfig): Promise<void> {
  assertResettable(config);
  const client = new pg.Client({ connectionString: config.databaseUrl, application_name: 'ofl-reset' });
  await client.connect();
  try {
    await client.query('SELECT pg_advisory_lock($1)', [MIGRATION_LOCK_KEY]);
    try {
      await client.query('DROP SCHEMA IF EXISTS public CASCADE');
      await client.query('CREATE SCHEMA public');
    } finally {
      await client.query('SELECT pg_advisory_unlock($1)', [MIGRATION_LOCK_KEY]);
    }
    await migrateWithClient(client);
  } finally {
    await client.end();
  }
}

/** Every table that holds data. schema_migrations is deliberately absent. */
export const DATA_TABLES = [
  'audit_log',
  'search_index_state',
  'outbox_events',
  'return_lines',
  'returns',
  'shipment_lines',
  'shipments',
  'simulated_gateway_operations',
  'refunds',
  'payment_events',
  'payments',
  'checkout_requests',
  'reservations',
  'order_lines',
  'orders',
  'inventory_movements',
  'inventory_balances',
  'warehouses',
  'skus',
  'products',
  'categories',
  'sessions',
  'users',
] as const;

/** Empties every data table and restarts identity sequences. Keeps the schema. */
export async function truncateAllData(client: Queryable): Promise<void> {
  // Table names come from the fixed list above, never from input.
  await client.query(`TRUNCATE ${DATA_TABLES.join(', ')} RESTART IDENTITY CASCADE`);
}

export function assertResettable(config: AppConfig): void {
  if (config.nodeEnv === 'production') {
    throw new Error('Refusing to reset a database when NODE_ENV=production.');
  }
  const databaseName = new URL(config.databaseUrl).pathname.replace(/^\//, '');
  if (!databaseName.startsWith('ofl_')) {
    throw new Error(`Refusing to reset database "${databaseName}": only databases named ofl_* can be reset.`);
  }
}
