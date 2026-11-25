import type { SuiteContext } from '../support/context';

/** Each scenario module registers its test(s) against a lazily created context. */
export type Scenario = (context: () => SuiteContext) => void;
