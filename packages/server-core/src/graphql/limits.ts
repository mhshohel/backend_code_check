import {
  getNamedType,
  getNullableType,
  GraphQLError,
  isCompositeType,
  isInterfaceType,
  isListType,
  isObjectType,
  Kind,
  type ASTVisitor,
  type DocumentNode,
  type FieldNode,
  type FragmentDefinitionNode,
  type GraphQLCompositeType,
  type GraphQLField,
  type GraphQLSchema,
  type OperationDefinitionNode,
  type SelectionSetNode,
  type ValidationContext,
  type ValidationRule,
  type ValueNode,
} from 'graphql';

export const MAX_DEPTH = 10;
export const MAX_COST = 5000;
/** Assumed size of a list field without a `first`/`limit` argument (order lines, SKUs, ...). */
export const UNBOUNDED_LIST_SIZE = 5;
const DEFAULT_PAGE = 20;

export function queryTooComplex(message: string): GraphQLError {
  return new GraphQLError(message, { extensions: { code: 'QUERY_TOO_COMPLEX' } });
}

/**
 * Validation rule: rejects operations nested deeper than MAX_DEPTH fields.
 * Fragments are followed; a fragment cycle is reported by the standard rules.
 */
export function depthLimitRule(maxDepth: number = MAX_DEPTH): ValidationRule {
  return (context: ValidationContext): ASTVisitor => {
    const fragments = new Map<string, FragmentDefinitionNode>();
    for (const definition of context.getDocument().definitions) {
      if (definition.kind === Kind.FRAGMENT_DEFINITION) fragments.set(definition.name.value, definition);
    }
    return {
      OperationDefinition(node) {
        const depth = selectionDepth(node.selectionSet, fragments, new Set());
        if (depth > maxDepth) {
          context.reportError(
            new GraphQLError(`Query depth ${depth} exceeds the maximum of ${maxDepth}.`, {
              nodes: [node],
              extensions: { code: 'QUERY_TOO_COMPLEX' },
            }),
          );
        }
      },
    };
  };
}

function selectionDepth(selectionSet: SelectionSetNode, fragments: ReadonlyMap<string, FragmentDefinitionNode>, visiting: Set<string>): number {
  let max = 0;
  for (const selection of selectionSet.selections) {
    if (selection.kind === Kind.FIELD) {
      const child = selection.selectionSet ? selectionDepth(selection.selectionSet, fragments, visiting) : 0;
      max = Math.max(max, 1 + child);
    } else if (selection.kind === Kind.INLINE_FRAGMENT) {
      max = Math.max(max, selectionDepth(selection.selectionSet, fragments, visiting));
    } else {
      const name = selection.name.value;
      const fragment = fragments.get(name);
      if (!fragment || visiting.has(name)) continue;
      visiting.add(name);
      max = Math.max(max, selectionDepth(fragment.selectionSet, fragments, visiting));
      visiting.delete(name);
    }
  }
  return max;
}

/**
 * Static cost estimate with variables applied. Each composite field costs 1;
 * scalars cost 0. A field with a `first` or `limit` argument multiplies the
 * cost of its subtree by that value (default 20); any other list field
 * multiplies by UNBOUNDED_LIST_SIZE. So `orders(first: 50) { lines { sku } }`
 * costs 1 + 50 * (1 + 1 + 5 * (1 + 1)).
 */
export function estimateCost(
  schema: GraphQLSchema,
  document: DocumentNode,
  operationName: string | null | undefined,
  variables: Readonly<Record<string, unknown>> | null | undefined,
): number {
  const fragments = new Map<string, FragmentDefinitionNode>();
  let operation: OperationDefinitionNode | undefined;
  for (const definition of document.definitions) {
    if (definition.kind === Kind.FRAGMENT_DEFINITION) fragments.set(definition.name.value, definition);
    if (definition.kind === Kind.OPERATION_DEFINITION && (!operationName || definition.name?.value === operationName)) {
      operation ??= definition;
    }
  }
  if (!operation) return 0;
  const root =
    operation.operation === 'query'
      ? schema.getQueryType()
      : operation.operation === 'mutation'
        ? schema.getMutationType()
        : schema.getSubscriptionType();
  if (!root) return 0;
  return selectionCost(operation.selectionSet, root, { schema, fragments, variables: variables ?? {} }, new Set());
}

type CostContext = {
  schema: GraphQLSchema;
  fragments: ReadonlyMap<string, FragmentDefinitionNode>;
  variables: Readonly<Record<string, unknown>>;
};

function selectionCost(selectionSet: SelectionSetNode, parentType: GraphQLCompositeType, ctx: CostContext, visiting: Set<string>): number {
  let total = 0;
  for (const selection of selectionSet.selections) {
    if (selection.kind === Kind.FIELD) {
      total += fieldCost(selection, parentType, ctx, visiting);
    } else if (selection.kind === Kind.INLINE_FRAGMENT) {
      const typeName = selection.typeCondition?.name.value;
      const type = typeName ? ctx.schema.getType(typeName) : parentType;
      if (isCompositeType(type)) total += selectionCost(selection.selectionSet, type, ctx, visiting);
    } else {
      const name = selection.name.value;
      const fragment = ctx.fragments.get(name);
      if (!fragment || visiting.has(name)) continue;
      const type = ctx.schema.getType(fragment.typeCondition.name.value);
      if (!isCompositeType(type)) continue;
      visiting.add(name);
      total += selectionCost(fragment.selectionSet, type, ctx, visiting);
      visiting.delete(name);
    }
  }
  return total;
}

function fieldCost(node: FieldNode, parentType: GraphQLCompositeType, ctx: CostContext, visiting: Set<string>): number {
  if (!node.selectionSet) return 0;
  if (!isObjectType(parentType) && !isInterfaceType(parentType)) return 0;
  const field: GraphQLField<unknown, unknown> | undefined = parentType.getFields()[node.name.value];
  if (!field) return 0;
  const named = getNamedType(field.type);
  if (!isCompositeType(named)) return 0;

  const children = selectionCost(node.selectionSet, named, ctx, visiting);
  return 1 + multiplier(node, field, ctx) * children;
}

function multiplier(node: FieldNode, field: GraphQLField<unknown, unknown>, ctx: CostContext): number {
  const sizeArg = field.args.find((arg) => arg.name === 'first' || arg.name === 'limit');
  if (sizeArg) {
    const supplied = node.arguments?.find((arg) => arg.name.value === sizeArg.name);
    const value = supplied ? numericValue(supplied.value, ctx.variables) : null;
    return Math.max(1, value ?? DEFAULT_PAGE);
  }
  return isListType(getNullableType(field.type)) ? UNBOUNDED_LIST_SIZE : 1;
}

function numericValue(value: ValueNode, variables: Readonly<Record<string, unknown>>): number | null {
  if (value.kind === Kind.INT) return Number.parseInt(value.value, 10);
  if (value.kind === Kind.VARIABLE) {
    const variable = variables[value.name.value];
    return typeof variable === 'number' && Number.isFinite(variable) ? variable : null;
  }
  return null;
}

/** Returns a QUERY_TOO_COMPLEX error when the estimate exceeds the limit, else null. */
export function checkQueryCost(
  schema: GraphQLSchema,
  document: DocumentNode,
  operationName: string | null | undefined,
  variables: Readonly<Record<string, unknown>> | null | undefined,
  maxCost: number = MAX_COST,
): GraphQLError | null {
  const cost = estimateCost(schema, document, operationName, variables);
  return cost > maxCost ? queryTooComplex(`Query cost ${cost} exceeds the maximum of ${maxCost}.`) : null;
}
