import { parseArgs } from 'node:util';
import { closeServices, createLogger, createServices, loadConfig, rebuildSearchIndex } from '@ofl/server-core';
import { FIXTURE_PROFILES, resetToFixture, type FixtureProfile } from './reset';

const USAGE = `Usage: ofl-seed [--profile demo|contract|bench] [--size N] [--no-reindex]

Resets the database (migrate + truncate) and loads a fixture profile, then
rebuilds the search index. bench: --size sets the product count (orders = 10 x size).`;

function print(line: string): void {
  process.stdout.write(`${line}\n`);
}

function isProfile(value: string): value is FixtureProfile {
  return (FIXTURE_PROFILES as readonly string[]).includes(value);
}

export async function runSeedCli(argv: readonly string[]): Promise<number> {
  const { values } = parseArgs({
    args: [...argv],
    options: {
      profile: { type: 'string', default: 'demo' },
      size: { type: 'string' },
      'no-reindex': { type: 'boolean', default: false },
      help: { type: 'boolean', default: false },
    },
  });
  if (values.help) {
    print(USAGE);
    return 0;
  }
  const profile = values.profile ?? 'demo';
  if (!isProfile(profile)) {
    print(`Unknown profile "${profile}".\n\n${USAGE}`);
    return 2;
  }
  const size = values.size === undefined ? undefined : Number(values.size);
  if (size !== undefined && (!Number.isInteger(size) || size < 1)) {
    print('--size must be a positive integer.');
    return 2;
  }

  try {
    const config = loadConfig();
    const started = Date.now();
    await resetToFixture(config, profile, size ? { bench: { products: size, orders: size * 10 } } : {});
    print(`loaded profile "${profile}" in ${((Date.now() - started) / 1000).toFixed(1)} s`);
    if (values['no-reindex']) return 0;

    const services = await createServices(config, { role: 'cli', logger: createLogger({ level: 'warn', name: 'ofl-seed' }) });
    try {
      const result = await rebuildSearchIndex(services);
      print(`indexed ${result.documents} product(s) into ${result.index}`);
    } catch (error) {
      console.warn(`search index not rebuilt (is Elasticsearch running?): ${error instanceof Error ? error.message : String(error)}`);
    } finally {
      await closeServices(services);
    }
    return 0;
  } catch (error) {
    console.error(error instanceof Error ? error.message : error);
    return 1;
  }
}
