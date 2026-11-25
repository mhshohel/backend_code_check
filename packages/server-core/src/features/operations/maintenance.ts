import { findLedgerDifferences, type LedgerDifference } from '../inventory/queries';
import type { Services } from '../../services';

export async function reconcileLedger(services: Services): Promise<{ differences: LedgerDifference[] }> {
  return { differences: await findLedgerDifferences(services.db) };
}

export function rebuildSearchIndex(services: Services): Promise<{ index: string; documents: number }> {
  return services.search.rebuild(services.db);
}
