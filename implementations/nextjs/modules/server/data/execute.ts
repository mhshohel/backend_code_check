import 'server-only';
import { forbidden, notFound, redirect } from 'next/navigation';
import type { SessionUser } from '@ofl/server-core';
import type { TypedDocumentNode } from '@graphql-typed-document-node/core';
import { getServices } from '../services';
import { getRequestMeta, getViewer } from '../session';
import { appErrorCode } from '../app-error';
import { runOperation } from './run-operation';


/**
 * Runs a GraphQL operation in-process as the current viewer: the same schema,
 * resolvers, authorization and DataLoaders as /api/graphql, without an HTTP
 * round trip back to this server.
 */
export async function queryAsViewer<TResult, TVariables>(
  document: TypedDocumentNode<TResult, TVariables>,
  variables: TVariables,
  options: { returnTo: string },
): Promise<TResult> {
  const [services, viewer, meta] = await Promise.all([getServices(), getViewer(), getRequestMeta()]);
  try {
    return await runOperation(services, viewer, meta, document, variables);
  } catch (error) {
    return handleAccessError(error, viewer, options.returnTo);
  }
}

function handleAccessError(error: unknown, viewer: SessionUser | null, returnTo: string): never {
  const code = appErrorCode(error);
  if (code === 'NOT_FOUND') notFound();
  if (code === 'UNAUTHENTICATED' && viewer === null) redirect(`/login?next=${encodeURIComponent(returnTo)}`);
  if (code === 'FORBIDDEN') forbidden();
  throw error;
}
