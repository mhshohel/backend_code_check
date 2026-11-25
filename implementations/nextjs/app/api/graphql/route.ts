import { observed } from '@/modules/server/http/observe';
import { crossOriginPreflight, withGuards } from '@/modules/server/http/guards';
import { GRAPHQL_ENDPOINT, handleGraphQLRequest } from '@/modules/server/graphql-handler';

// Only POST is exported: GET queries would bypass the CSRF header rule, and
// Next answers other methods with 405.
export const POST = observed(GRAPHQL_ENDPOINT, (request, meta) => withGuards(() => handleGraphQLRequest(request, meta)));

/** Same-origin requests never preflight, so any preflight is cross-origin and refused. */
export function OPTIONS(): Response {
  return crossOriginPreflight();
}
