import 'server-only';
import { executeOperation, type RequestMeta, type Services, type SessionUser } from '@ofl/server-core';
import type { TypedDocumentNode } from '@graphql-typed-document-node/core';

/**
 * executeOperation returns graphql-js execution data, whose objects have a
 * null prototype. React refuses to pass those from Server Components to
 * Client Components, so every result is copied into plain objects here, at
 * the single place where server data enters the React tree.
 */
export async function runOperation<TResult, TVariables>(
  services: Services,
  viewer: SessionUser | null,
  meta: RequestMeta,
  document: TypedDocumentNode<TResult, TVariables>,
  variables: TVariables,
): Promise<TResult> {
  return structuredClone(await executeOperation(services, viewer, meta, document, variables));
}
