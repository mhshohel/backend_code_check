import { parseArgs } from 'node:util';
import { loadConfig } from './config';
import { migrate, resetDatabase } from './db/migrate';
import { rebuildSearchIndex, reconcileLedger } from './features/operations/maintenance';
import { retryAllFailedJobs, retryJobAs } from './features/operations/jobs';
import { listJobs } from './features/operations/queries';
import { correlationIdFrom } from './observability/correlation';
import { createLogger } from './observability/logger';
import { closeServices, createServices, type Services } from './services';

const USAGE = `Usage: ofl <command> [options]

Commands:
  migrate                      Apply pending database migrations.
  reset                        Drop and re-create the database schema, delete this prefix's search indexes.
  reindex                      Rebuild the search index and switch the alias.
  retry-jobs --id <id>         Move one FAILED job back to PENDING.
  retry-jobs --all-failed      Move every FAILED job back to PENDING.
  reconcile                    Compare balances with the movement ledger (exit 1 on differences).
  jobs                         List FAILED jobs.

Seed data lives in @ofl/test-fixtures: ofl-seed --profile demo|contract|bench.
Environment: DATABASE_URL, ELASTICSEARCH_URL, ES_INDEX_PREFIX, ... (read from ./.env when present).`;

// The CLI talks to people: stdout is its user interface.
function print(line: string): void {
  process.stdout.write(`${line}\n`);
}

async function withServices<T>(work: (services: Services) => Promise<T>): Promise<T> {
  const config = loadConfig();
  const services = await createServices(config, { role: 'cli', logger: createLogger({ level: process.env.LOG_LEVEL ?? 'warn', name: 'ofl-cli' }) });
  try {
    return await work(services);
  } finally {
    await closeServices(services);
  }
}

const meta = () => ({ correlationId: correlationIdFrom(`cli-${Date.now()}`) });

export async function runCli(argv: readonly string[]): Promise<number> {
  const [command, ...rest] = argv;
  try {
    switch (command) {
      case 'migrate': {
        const report = await migrate(loadConfig());
        print(`applied ${report.applied.length} migration(s)${report.applied.length ? `: ${report.applied.join(', ')}` : ''}`);
        return 0;
      }
      case 'reset': {
        const config = loadConfig();
        await resetDatabase(config);
        await withServices(async (services) => {
          await services.search.client.indices.delete({ index: `${services.search.alias}_*`, ignore_unavailable: true, allow_no_indices: true }).catch(() => undefined);
        });
        print('database reset and migrated; search indexes deleted');
        return 0;
      }
      case 'reindex': {
        const result = await withServices((services) => rebuildSearchIndex(services));
        print(`indexed ${result.documents} product(s) into ${result.index}`);
        return 0;
      }
      case 'retry-jobs': {
        const { values } = parseArgs({ args: [...rest], options: { id: { type: 'string' }, 'all-failed': { type: 'boolean' } } });
        if (values.id) {
          const outcome = await withServices((services) => retryJobAs(services, null, values.id ?? '', meta()));
          print(outcome.kind === 'retried' ? `job ${values.id} moved to PENDING` : `job ${values.id} is ${outcome.status}; only FAILED jobs can be retried`);
          return outcome.kind === 'retried' ? 0 : 1;
        }
        if (values['all-failed']) {
          const count = await withServices((services) => retryAllFailedJobs(services, meta()));
          print(`moved ${count} failed job(s) to PENDING`);
          return 0;
        }
        print('retry-jobs needs --id <id> or --all-failed');
        return 2;
      }
      case 'reconcile': {
        const { differences } = await withServices((services) => reconcileLedger(services));
        if (differences.length === 0) {
          print('ledger reconciles: no differences');
          return 0;
        }
        for (const d of differences) print(`${d.skuId} ${d.warehouseId} ${d.field}: balance ${d.balance}, ledger ${d.ledger}`);
        return 1;
      }
      case 'jobs': {
        const page = await withServices((services) => listJobs(services.db, 'FAILED', { limit: 50, after: null }));
        if (page.edges.length === 0) print('no failed jobs');
        for (const { node } of page.edges) {
          print(`${node.id}\t${node.topic}\t${node.aggregate_id}\tattempts=${node.attempts}\t${node.last_error ?? ''}`);
        }
        return 0;
      }
      case undefined:
      case 'help':
      case '--help':
        print(USAGE);
        return command === undefined ? 2 : 0;
      default:
        print(`Unknown command: ${command}\n\n${USAGE}`);
        return 2;
    }
  } catch (error) {
    console.error(error instanceof Error ? error.message : error);
    return 1;
  }
}
