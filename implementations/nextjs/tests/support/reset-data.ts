import { closeServices, createServices, loadConfig, rebuildSearchIndex } from '@ofl/server-core';
import { resetToFixture, type FixtureProfile } from '@ofl/test-fixtures';

/** Resets the test database to a fixture and rebuilds the test search index (resetToFixture leaves search alone). */
export async function resetTestData(env: Record<string, string>, profile: FixtureProfile = 'contract'): Promise<void> {
  const config = loadConfig(env);
  await resetToFixture(config, profile);
  const services = await createServices(config, { role: 'cli' });
  try {
    await rebuildSearchIndex(services);
  } finally {
    await closeServices(services);
  }
}
