import { afterAll, afterEach, beforeAll, describe, expect } from '@jest/globals';
import { s01LastFiveUnits } from './scenarios/s01-last-five-units';
import { s02IdempotentRetries } from './scenarios/s02-idempotent-retries';
import { s03DeclinedPayment } from './scenarios/s03-declined-payment';
import { s04DuplicateNotifications } from './scenarios/s04-duplicate-notifications';
import { s05PaymentVersusExpiry } from './scenarios/s05-payment-vs-expiry';
import { s06AtomicMultiItem } from './scenarios/s06-atomic-multi-item';
import { s07WorkerCrash } from './scenarios/s07-worker-crash';
import { s08ReorderedSearchEvents } from './scenarios/s08-reordered-search-events';
import { s09SplitShipment } from './scenarios/s09-split-shipment';
import { s10PartialReturn } from './scenarios/s10-partial-return';
import { s11CustomerIsolation } from './scenarios/s11-customer-isolation';
import { s12ConstantQueryCount } from './scenarios/s12-constant-query-count';
import { s13SearchDown } from './scenarios/s13-search-down';
import { s14LiveUpdates } from './scenarios/s14-live-updates';
import type { Scenario } from './scenarios/types';
import { SuiteContext } from './support/context';
import type { AcceptanceTarget } from './target';

export const SCENARIOS: readonly Scenario[] = [
  s01LastFiveUnits,
  s02IdempotentRetries,
  s03DeclinedPayment,
  s04DuplicateNotifications,
  s05PaymentVersusExpiry,
  s06AtomicMultiItem,
  s07WorkerCrash,
  s08ReorderedSearchEvents,
  s09SplitShipment,
  s10PartialReturn,
  s11CustomerIsolation,
  s12ConstantQueryCount,
  s13SearchDown,
  s14LiveUpdates,
];

/**
 * Registers the 14 acceptance scenarios. Call it at the top level of a Jest
 * test file. `getTarget` is called in beforeAll, after the variant's own
 * beforeAll has started its server.
 */
export function defineAcceptanceSuite(getTarget: () => AcceptanceTarget): void {
  let context: SuiteContext | undefined;
  const current = (): SuiteContext => {
    if (!context) throw new Error('acceptance suite context is not ready (did beforeAll fail?)');
    return context;
  };

  describe('acceptance scenarios', () => {
    beforeAll(async () => {
      context = await SuiteContext.start(getTarget());
    }, 120_000);

    afterEach(async () => {
      if (context) expect(await context.ledgerDifferences()).toBe(0);
    });

    afterAll(async () => {
      await context?.stop();
    });

    for (const scenario of SCENARIOS) scenario(current);
  });
}
