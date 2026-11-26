import { SetMetadata } from '@nestjs/common';

export type RateLimitBucket = 'login' | 'graphql' | 'webhook';

export const RATE_LIMIT_KEY = 'ofl:rate-limit';
export const GRAPHQL_ERRORS_KEY = 'ofl:graphql-errors';

/** Which per-IP limiter RateLimitGuard applies to this handler or controller. */
export const RateLimit = (bucket: RateLimitBucket) => SetMetadata(RATE_LIMIT_KEY, bucket);

/** Guards on this controller answer with GraphQL-shaped errors ({ errors: [...] }). */
export const GraphQLErrors = () => SetMetadata(GRAPHQL_ERRORS_KEY, true);
