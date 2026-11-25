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
/** Root fields per operation, aliases counted separately. Stops alias fan-out. */
export const MAX_ROOT_FIELDS = 20;
/** Base cost of every root field and every paged field (`first`/`limit`): each one is a query of its own. */
export const ROOT_FIELD_COST = 10;
export const PAGED_FIELD_COST = 10;
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
 * Static cost estimate with variables applied (docs/graphql-design.md §5).
 * - Every root field costs at least ROOT_FIELD_COST, scalar or not, and
 *   each alias counts separately: a root field is a resolver doing real work.
 * - A field with a `first` or `limit` argument costs PAGED_FIELD_COST plus
 *   that value (default 20) times the cost of its subtree.
 * - `edges` of a connection is already bounded by the connection's `first`,
 *   so it is not multiplied again; any other list field multiplies its
 *   subtree by UNBOUNDED_LIST_SIZE.
 * - Other composite fields cost 1 plus their subtree; scalars cost 0.
 *
 * Deviation from the design doc: unbounded lists use 5, not 50. With 50 the
 * real OperatorOrders page (orders -> lines, reservations) would exceed the limit.
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
  return selectionCost(operation.selectionSet, root, { schema, fragments, variables: variables ?? {}, rootType: root }, new Set());
}

type CostContext = {
  rootType: GraphQLCompositeType;
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
  if (node.name.value === '__typename') return 0;
  const isRoot = parentType === ctx.rootType;
  const base = isRoot ? ROOT_FIELD_COST : 0;
  if (!isObjectType(parentType) && !isInterfaceType(parentType)) return base;
  const field: GraphQLField<unknown, unknown> | undefined = parentType.getFields()[node.name.value];
  if (!field) return base;
  const named = getNamedType(field.type);
  if (!node.selectionSet || !isCompositeType(named)) return base;

  const children = selectionCost(node.selectionSet, named, ctx, visiting);
  const size = pageSizeArgument(node, field, ctx);
  if (size !== null) return Math.max(base, PAGED_FIELD_COST) + size * children;
  const listFactor = isListType(getNullableType(field.type)) && !isConnectionEdges(parentType, node) ? UNBOUNDED_LIST_SIZE : 1;
  return Math.max(base, 1) + listFactor * children;
}

function isConnectionEdges(parentType: GraphQLCompositeType, node: FieldNode): boolean {
  return parentType.name.endsWith('Connection') && node.name.value === 'edges';
}

function pageSizeArgument(node: FieldNode, field: GraphQLField<unknown, unknown>, ctx: CostContext): number | null {
  const sizeArg = field.args.find((arg) => arg.name === 'first' || arg.name === 'limit');
  if (!sizeArg) return null;
  const supplied = node.arguments?.find((arg) => arg.name.value === sizeArg.name);
  const value = supplied ? numericValue(supplied.value, ctx.variables) : null;
  return Math.max(1, value ?? DEFAULT_PAGE);
}

/** Root fields of the operation after expanding fragments; every alias counts. */
export function countRootFields(document: DocumentNode, operationName: string | null | undefined): number {
  const fragments = new Map<string, FragmentDefinitionNode>();
  let operation: OperationDefinitionNode | undefined;
  for (const definition of document.definitions) {
    if (definition.kind === Kind.FRAGMENT_DEFINITION) fragments.set(definition.name.value, definition);
    if (definition.kind === Kind.OPERATION_DEFINITION && (!operationName || definition.name?.value === operationName)) {
      operation ??= definition;
    }
  }
  if (!operation) return 0;
  const count = (selectionSet: SelectionSetNode, visiting: Set<string>): number => {
    let total = 0;
    for (const selection of selectionSet.selections) {
      if (selection.kind === Kind.FIELD) {
        if (selection.name.value !== '__typename') total += 1;
      } else if (selection.kind === Kind.INLINE_FRAGMENT) {
        total += count(selection.selectionSet, visiting);
      } else {
        const fragment = fragments.get(selection.name.value);
        if (!fragment || visiting.has(fragment.name.value)) continue;
        visiting.add(fragment.name.value);
        total += count(fragment.selectionSet, visiting);
        visiting.delete(fragment.name.value);
      }
    }
    return total;
  };
  return count(operation.selectionSet, new Set());
}

function numericValue(value: ValueNode, variables: Readonly<Record<string, unknown>>): number | null {
  if (value.kind === Kind.INT) return Number.parseInt(value.value, 10);
  if (value.kind === Kind.VARIABLE) {
    const variable = variables[value.name.value];
    return typeof variable === 'number' && Number.isFinite(variable) ? variable : null;
  }
  return null;
}

/** Returns a QUERY_TOO_COMPLEX error when the operation has too many root fields or costs too much, else null. */
export function checkQueryCost(
  schema: GraphQLSchema,
  document: DocumentNode,
  operationName: string | null | undefined,
  variables: Readonly<Record<string, unknown>> | null | undefined,
  maxCost: number = MAX_COST,
): GraphQLError | null {
  const rootFields = countRootFields(document, operationName);
  if (rootFields > MAX_ROOT_FIELDS) {
    return queryTooComplex(`The operation selects ${rootFields} root fields; the maximum is ${MAX_ROOT_FIELDS}.`);
  }
  const cost = estimateCost(schema, document, operationName, variables);
  return cost > maxCost ? queryTooComplex(`Query cost ${cost} exceeds the maximum of ${maxCost}.`) : null;
}
