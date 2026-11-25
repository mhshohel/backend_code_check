import type { GraphQLSchema } from 'graphql';
import { createSchema } from 'graphql-yoga';
import { loadSchemaSDL } from '@ofl/graphql-types/schema';
import type { Services } from '../services';
import type { Resolvers } from './generated/resolvers';
import { adminResolvers } from './resolvers/admin';
import { catalogResolvers } from './resolvers/catalog';
import { commonResolvers } from './resolvers/common';
import { inventoryResolvers } from './resolvers/inventory';
import { orderResolvers } from './resolvers/orders';

type ResolverMap = Record<string, unknown>;

/** Merges per-feature resolver maps type by type. A field defined twice is a programming error. */
export function mergeResolvers(parts: readonly Resolvers[]): Resolvers {
  const merged: Record<string, unknown> = {};
  for (const part of parts) {
    for (const [typeName, value] of Object.entries(part)) {
      const existing = merged[typeName];
      if (existing === undefined || !isPlainMap(value) || !isPlainMap(existing)) {
        if (existing !== undefined) throw new Error(`Resolver type ${typeName} is defined twice.`);
        merged[typeName] = value;
        continue;
      }
      for (const field of Object.keys(value)) {
        if (field in existing) throw new Error(`Resolver ${typeName}.${field} is defined twice.`);
      }
      merged[typeName] = { ...existing, ...value };
    }
  }
  return merged as Resolvers;
}

function isPlainMap(value: unknown): value is ResolverMap {
  return typeof value === 'object' && value !== null && Object.getPrototypeOf(value) === Object.prototype;
}

export const RESOLVERS: Resolvers = mergeResolvers([commonResolvers, catalogResolvers, orderResolvers, inventoryResolvers, adminResolvers]);

const schemas = new WeakMap<Services, GraphQLSchema>();

/** Executable schema from contracts/schema.graphql. Includes the subscription. */
export function buildGraphQLSchema(services?: Services): GraphQLSchema {
  const cached = services ? schemas.get(services) : undefined;
  if (cached) return cached;
  const schema = createSchema({ typeDefs: loadSchemaSDL(), resolvers: RESOLVERS });
  if (services) schemas.set(services, schema);
  return schema;
}
