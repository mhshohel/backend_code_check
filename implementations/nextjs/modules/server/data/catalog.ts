import 'server-only';
import { cache } from 'react';
import { unstable_cache } from 'next/cache';
import { correlationIdFrom } from '@ofl/server-core';
import {
  CategoriesDocument,
  ProductDetailDocument,
  SearchProductsDocument,
  type CategoriesQuery,
  type ProductDetailQuery,
  type SearchProductsQuery,
  type SearchProductsQueryVariables,
} from '@ofl/graphql-types';
import type { TypedDocumentNode } from '@graphql-typed-document-node/core';
import { getServices } from '../services';
import { getRequestMeta } from '../session';
import { appErrorCode } from '../app-error';
import { runOperation } from './run-operation';

// Caching rules for public catalog data (see README "Caching and invalidation"):
// - Search results come from Elasticsearch, which the worker updates after each
//   commit, so they are already eventually consistent. We add a short data
//   cache (15 s) keyed by the search variables and executed as an anonymous
//   viewer, so the cached value is identical for every user.
// - Categories change rarely: 5 minutes.
// - Product detail (per-warehouse stock) is NOT cached: it reads PostgreSQL on
//   every request, and checkout rechecks stock and price under row locks anyway.
// Cached functions never read cookies or headers; the viewer is always null.
export const CATALOG_SEARCH_TAG = 'catalog:search';
export const CATALOG_CATEGORIES_TAG = 'catalog:categories';

async function runAnonymous<TResult, TVariables>(
  document: TypedDocumentNode<TResult, TVariables>,
  variables: TVariables,
): Promise<TResult> {
  const services = await getServices();
  return runOperation(services, null, { correlationId: correlationIdFrom(null) }, document, variables);
}

// The data cache is persisted in .next/cache and survives restarts, so the
// key includes the environment (index prefix): a server pointed at another
// database/index never sees entries written for a different one.
const cachedSearch = unstable_cache(
  async (_environment: string, variables: SearchProductsQueryVariables): Promise<SearchProductsQuery> =>
    runAnonymous(SearchProductsDocument, variables),
  ['ofl-catalog-search-v1'],
  { tags: [CATALOG_SEARCH_TAG], revalidate: 15 },
);

const cachedCategories = unstable_cache(
  async (_environment: string): Promise<CategoriesQuery> => runAnonymous(CategoriesDocument, {}),
  ['ofl-catalog-categories-v1'],
  { tags: [CATALOG_CATEGORIES_TAG], revalidate: 300 },
);

/**
 * Tests reset the database underneath a running server, so the data cache is
 * bypassed when NODE_ENV=test (read from the validated config at runtime;
 * Next inlines process.env.NODE_ENV at build time).
 */
async function cacheEnvironment(): Promise<string | null> {
  const { config } = await getServices();
  return config.nodeEnv === 'test' ? null : config.esIndexPrefix;
}

export type SearchOutcome =
  | { kind: 'ok'; data: SearchProductsQuery['searchProducts'] }
  | { kind: 'unavailable' };

/** Search is optional infrastructure: when Elasticsearch is down the page still renders. */
export async function searchCatalog(variables: SearchProductsQueryVariables): Promise<SearchOutcome> {
  try {
    const environment = await cacheEnvironment();
    const result = environment === null
      ? await runAnonymous(SearchProductsDocument, variables)
      : await cachedSearch(environment, variables);
    return { kind: 'ok', data: result.searchProducts };
  } catch (error) {
    if (appErrorCode(error) === 'SEARCH_UNAVAILABLE') return { kind: 'unavailable' };
    throw error;
  }
}

export async function listCategories(): Promise<CategoriesQuery['categories']> {
  const environment = await cacheEnvironment();
  const result = environment === null ? await runAnonymous(CategoriesDocument, {}) : await cachedCategories(environment);
  return result.categories;
}

export type ProductDetail = NonNullable<ProductDetailQuery['product']>;

/**
 * Live PostgreSQL read, attributed to the current request's correlation ID.
 * React cache() shares one read between generateMetadata and the page within
 * a single request; nothing is kept across requests.
 */
export const loadProduct = cache(async (slug: string): Promise<ProductDetail | null> => {
  const [services, meta] = await Promise.all([getServices(), getRequestMeta()]);
  const result = await runOperation(services, null, meta, ProductDetailDocument, { slug });
  return result.product;
});
