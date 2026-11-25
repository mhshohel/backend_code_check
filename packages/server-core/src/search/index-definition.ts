import type { estypes } from '@elastic/elasticsearch';

/** The document stored per product. Derived data; PostgreSQL is the source of truth. */
export type ProductDocument = {
  id: string;
  slug: string;
  name: string;
  description: string;
  categorySlug: string;
  categoryName: string;
  minPriceMinor: number;
  skuCodes: string[];
  inStock: boolean;
  availableQuantity: number;
  createdAt: string;
  version: number;
};

export const INDEX_SETTINGS: estypes.IndicesIndexSettings = {
  number_of_shards: 1,
  number_of_replicas: 0,
  analysis: {
    tokenizer: {
      autocomplete_edge: { type: 'edge_ngram', min_gram: 1, max_gram: 20, token_chars: ['letter', 'digit'] },
    },
    analyzer: {
      // Index every prefix of every word ("hea", "head", ...), search with
      // whole words: "head" matches "Headphones" without wildcard queries.
      autocomplete: { type: 'custom', tokenizer: 'autocomplete_edge', filter: ['lowercase', 'asciifolding'] },
      autocomplete_search: { type: 'custom', tokenizer: 'standard', filter: ['lowercase', 'asciifolding'] },
      text_folded: { type: 'custom', tokenizer: 'standard', filter: ['lowercase', 'asciifolding'] },
    },
    normalizer: {
      lowercase_keyword: { type: 'custom', filter: ['lowercase'] },
    },
  },
};

// Explicit mapping with dynamic: strict, so a typo in the indexer fails
// loudly instead of creating a new field.
export const INDEX_MAPPINGS: estypes.MappingTypeMapping = {
  dynamic: 'strict',
  properties: {
    id: { type: 'keyword' },
    slug: { type: 'keyword' },
    name: {
      type: 'text',
      analyzer: 'text_folded',
      fields: {
        autocomplete: { type: 'text', analyzer: 'autocomplete', search_analyzer: 'autocomplete_search' },
        keyword: { type: 'keyword', normalizer: 'lowercase_keyword' },
      },
    },
    description: { type: 'text', analyzer: 'text_folded' },
    categorySlug: { type: 'keyword' },
    categoryName: { type: 'keyword', fields: { text: { type: 'text', analyzer: 'text_folded' } } },
    minPriceMinor: { type: 'long' },
    skuCodes: { type: 'keyword', normalizer: 'lowercase_keyword' },
    inStock: { type: 'boolean' },
    availableQuantity: { type: 'integer' },
    createdAt: { type: 'date' },
    version: { type: 'long' },
  },
};

/** Price facet buckets. The value format "<min>-<max>" is part of the GraphQL contract. */
export const PRICE_RANGES: readonly { key: string; from: number; to: number | null; label: string }[] = [
  { key: '0-2500', from: 0, to: 2500, label: 'Under $25' },
  { key: '2500-5000', from: 2500, to: 5000, label: '$25 to $50' },
  { key: '5000-10000', from: 5000, to: 10000, label: '$50 to $100' },
  { key: '10000-25000', from: 10000, to: 25000, label: '$100 to $250' },
  { key: '25000-', from: 25000, to: null, label: '$250 and up' },
];
