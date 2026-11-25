// Creates every lab database on the local PostgreSQL server if it is missing.
// Usage: pnpm db:create
import pg from 'pg';
import { ALL_DATABASES } from './resources';

const client = new pg.Client({
  host: process.env.PGHOST ?? 'localhost',
  port: Number(process.env.PGPORT ?? 5432),
  user: process.env.PGUSER ?? 'shohelshamim',
  database: 'postgres',
});

await client.connect();
try {
  for (const name of ALL_DATABASES) {
    const existing = await client.query('SELECT 1 FROM pg_database WHERE datname = $1', [name]);
    if (existing.rowCount === 0) {
      // Identifiers cannot be parameters. The names come from a fixed list.
      await client.query(`CREATE DATABASE "${name}"`);
      console.warn(`created ${name}`);
    } else {
      console.warn(`exists  ${name}`);
    }
  }
} finally {
  await client.end();
}
