import { execute, specifiedRules, validate, type DocumentNode, type GraphQLError } from 'graphql';
import { AppError } from '@ofl/domain';
import type { RequestMeta, SessionUser } from '../features/auth/sessions';
import type { Services } from '../services';
import { createGraphQLContext } from './context';
import { errorCode, toClientError } from './errors';
import { checkQueryCost, depthLimitRule } from './limits';
import { formatExecutionResult } from './plugins';
import { buildGraphQLSchema } from './schema';

/** Structural twin of TypedDocumentNode from @graphql-typed-document-node/core. */
export type TypedDocument<TResult, TVariables> = DocumentNode & { __apiType?: (variables: TVariables) => TResult };

function toAppError(error: GraphQLError): AppError {
  const fieldErrors = Array.isArray(error.extensions.fieldErrors)
    ? error.extensions.fieldErrors.filter(
        (f): f is { path: string; message: string } =>
          typeof f === 'object' && f !== null && typeof f.path === 'string' && typeof f.message === 'string',
      )
    : [];
  return new AppError(errorCode(error), error.message, fieldErrors);
}

/**
 * Runs a query or mutation in-process (Next.js server components and
 * server actions) with the same limits, authorization, and error model as
 * HTTP. Throws AppError on the first error; returns data otherwise.
 */
export async function executeOperation<TResult, TVariables>(
  services: Services,
  viewer: SessionUser | null,
  meta: RequestMeta,
  document: TypedDocument<TResult, TVariables>,
  variables: TVariables,
): Promise<TResult> {
  const schema = buildGraphQLSchema(services);
  const validationErrors = validate(schema, document, [...specifiedRules, depthLimitRule()]);
  const [firstValidationError] = validationErrors;
  if (firstValidationError) throw toAppError(toClientError(firstValidationError, services.logger, meta.correlationId));

  const variableValues = (variables ?? {}) as Readonly<Record<string, unknown>>;
  const tooComplex = checkQueryCost(schema, document, null, variableValues);
  if (tooComplex) throw toAppError(tooComplex);

  const contextValue = createGraphQLContext(services, viewer, meta);
  const raw = await execute({ schema, document, contextValue, variableValues });
  const result = formatExecutionResult(services, raw, contextValue, null);
  const [firstError] = result.errors ?? [];
  if (firstError) throw toAppError(firstError);
  if (!result.data) throw new AppError('INTERNAL_SERVER_ERROR', 'The operation returned no data.');
  return result.data as TResult;
}
