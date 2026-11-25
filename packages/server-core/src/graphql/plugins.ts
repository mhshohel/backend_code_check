import { GraphQLError, type ExecutionResult } from 'graphql';
import { handleStreamOrSingleExecutionResult, type Plugin } from 'graphql-yoga';
import type { Services } from '../services';
import { isGraphQLContext, type GraphQLContext } from './context';
import { errorCode, toClientError } from './errors';
import { checkQueryCost, depthLimitRule } from './limits';

export const QUERY_COUNT_HEADER = 'x-ofl-debug-query-count';

type RequestLike = { headers: { get(name: string): string | null } };

function hasRequest(value: object): value is { request: RequestLike } {
  if (!('request' in value)) return false;
  const request: unknown = value.request;
  return typeof request === 'object' && request !== null && 'headers' in request;
}

/** Query counts are reported only when enabled in config and asked for (option or header). */
function shouldReportQueryCount(services: Services, context: GraphQLContext): boolean {
  if (!services.config.enableQueryCount) return false;
  if (context.reportQueryCount) return true;
  return hasRequest(context) && context.request.headers.get(QUERY_COUNT_HEADER) === '1';
}

export function formatExecutionResult(
  services: Services,
  result: ExecutionResult,
  context: unknown,
  operationName: string | null | undefined,
): ExecutionResult {
  const correlationId = isGraphQLContext(context) ? context.meta.correlationId : undefined;
  const errors = result.errors?.map((error) => {
    const formatted = toClientError(error, services.logger, correlationId);
    services.metrics.graphqlError(operationName ?? 'anonymous', errorCode(formatted));
    return formatted;
  });
  const extensions =
    isGraphQLContext(context) && shouldReportQueryCount(services, context)
      ? { ...result.extensions, queryCount: context.queryCounter.count }
      : result.extensions;
  return {
    ...result,
    ...(errors ? { errors } : {}),
    ...(extensions ? { extensions } : {}),
  };
}

/**
 * Yoga plugins shared by every variant: depth limit (validation rule),
 * cost limit (needs variables, so it runs before execution), error
 * masking, error metrics, and the optional queryCount extension.
 */
export function graphqlYogaPlugins(services: Services): Plugin[] {
  const costGuard = (
    args: { schema: Parameters<typeof checkQueryCost>[0]; document: Parameters<typeof checkQueryCost>[1]; operationName?: string | null; variableValues?: Readonly<Record<string, unknown>> | null },
  ): GraphQLError | null => checkQueryCost(args.schema, args.document, args.operationName, args.variableValues);

  const plugin: Plugin = {
    onValidate({ addValidationRule }) {
      addValidationRule(depthLimitRule());
      return ({ result, setResult }) => {
        if (result.length === 0) return;
        setResult(result.map((error) => toClientError(error, services.logger)));
      };
    },
    onExecute({ args, setResultAndStopExecution }) {
      const tooComplex = costGuard(args);
      if (tooComplex) {
        services.metrics.graphqlError(args.operationName ?? 'anonymous', 'QUERY_TOO_COMPLEX');
        setResultAndStopExecution({ errors: [tooComplex] });
        return;
      }
      return {
        onExecuteDone(payload) {
          return handleStreamOrSingleExecutionResult(payload, ({ result, setResult }) => {
            setResult(formatExecutionResult(services, result, args.contextValue, args.operationName));
          });
        },
      };
    },
    onSubscribe({ args, setResultAndStopExecution }) {
      const tooComplex = costGuard(args);
      if (tooComplex) {
        setResultAndStopExecution({ errors: [tooComplex] });
        return;
      }
      return {
        onSubscribeResult(payload) {
          return handleStreamOrSingleExecutionResult(payload, ({ result, setResult }) => {
            setResult(formatExecutionResult(services, result, args.contextValue, args.operationName));
          });
        },
        onSubscribeError({ error, setError }) {
          if (error instanceof GraphQLError) setError(toClientError(error, services.logger));
        },
      };
    },
  };
  return [plugin];
}
