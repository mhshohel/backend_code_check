import { GraphQLScalarType, Kind } from 'graphql';
import { CURRENCY, formatMoney } from '@ofl/domain';
import type { GraphQLContext } from '../context';
import type { Loaders } from '../loaders';
import type { MoneyModel } from '../models';
import type { Resolvers } from '../generated/resolvers';

export function loaders(ctx: GraphQLContext): Loaders {
  return ctx.dataloaders.current;
}

export function money(amountMinor: number): MoneyModel {
  return { amountMinor };
}

/** Returns the loaded value or fails loudly: a dangling foreign key is a bug, not a user error. */
export function required<T>(value: T | null | undefined, what: string): T {
  if (value === null || value === undefined) throw new Error(`${what} is missing.`);
  return value;
}

/** Union members carry __typename; the union resolver reads it back. */
export function typenameOf<T extends string>(value: { __typename?: T }): T {
  if (!value.__typename) throw new Error('Union member without __typename.');
  return value.__typename;
}

const ISO_UTC = /^\d{4}-\d{2}-\d{2}T\d{2}:\d{2}:\d{2}(\.\d{1,6})?Z$/;

function serializeDateTime(value: unknown): string {
  if (value instanceof Date) {
    if (Number.isNaN(value.getTime())) throw new TypeError('Invalid Date.');
    return value.toISOString();
  }
  if (typeof value === 'string' && ISO_UTC.test(value)) return new Date(value).toISOString();
  throw new TypeError('DateTime must be a Date or an ISO-8601 UTC string.');
}

function parseDateTime(value: unknown): string {
  if (typeof value !== 'string' || !ISO_UTC.test(value) || Number.isNaN(Date.parse(value))) {
    throw new TypeError('DateTime must be an ISO-8601 UTC string, for example 2026-11-25T10:00:00.000Z.');
  }
  return new Date(value).toISOString();
}

export const DateTimeScalar = new GraphQLScalarType({
  name: 'DateTime',
  description: 'ISO-8601 timestamp in UTC.',
  serialize: serializeDateTime,
  parseValue: parseDateTime,
  parseLiteral: (ast) => {
    if (ast.kind !== Kind.STRING) throw new TypeError('DateTime must be a string.');
    return parseDateTime(ast.value);
  },
});

export const commonResolvers: Resolvers = {
  DateTime: DateTimeScalar,
  Money: {
    amountMinor: (parent) => parent.amountMinor,
    currency: () => CURRENCY,
    formatted: (parent) => formatMoney(parent.amountMinor),
  },
  DomainError: {
    __resolveType: (parent) => typenameOf(parent),
  },
};
