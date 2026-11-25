import type { QueryCounter } from '../db/db';
import type { RequestMeta, SessionUser } from '../features/auth/sessions';
import type { Services } from '../services';
import { createLoaders, type Loaders } from './loaders';

export type LoaderHolder = { current: Loaders; reset(): void };

export type GraphQLContext = {
  /** Request view of the services: same resources, but db counts statements. */
  services: Services;
  viewer: SessionUser | null;
  meta: RequestMeta;
  /** A holder (not the loaders themselves) so a subscription can swap in fresh loaders per event. */
  dataloaders: LoaderHolder;
  queryCounter: QueryCounter;
  /** True when the response should carry extensions.queryCount. */
  reportQueryCount: boolean;
  /**
   * Long-lived operations (subscriptions) call this before each event. It
   * returns false once the viewer's session was revoked or expired.
   */
  sessionStillValid: (() => Promise<boolean>) | null;
};

export type CreateContextOptions = { countQueries?: boolean; sessionStillValid?: () => Promise<boolean> };

/** Fresh DataLoaders for every request: nothing is cached across requests. */
export function createGraphQLContext(
  services: Services,
  viewer: SessionUser | null,
  meta: RequestMeta,
  options: CreateContextOptions = {},
): GraphQLContext {
  const queryCounter: QueryCounter = { count: 0 };
  const requestServices: Services = { ...services, db: services.db.withCounter(queryCounter) };
  const holder: LoaderHolder = {
    current: createLoaders(requestServices.db),
    reset() {
      holder.current = createLoaders(requestServices.db);
    },
  };
  return {
    services: requestServices,
    viewer,
    meta,
    dataloaders: holder,
    queryCounter,
    reportQueryCount: services.config.enableQueryCount && options.countQueries === true,
    sessionStillValid: options.sessionStillValid ?? null,
  };
}

export function isGraphQLContext(value: unknown): value is GraphQLContext {
  return (
    typeof value === 'object' &&
    value !== null &&
    'queryCounter' in value &&
    'dataloaders' in value &&
    'services' in value
  );
}
