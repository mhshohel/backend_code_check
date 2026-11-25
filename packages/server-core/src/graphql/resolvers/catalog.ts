import { notFound } from '@ofl/domain';
import { findProductBySlug, listCategories } from '../../features/catalog/records';
import type { Resolvers } from '../generated/resolvers';
import type { BalanceModel } from '../models';
import { loaders, money, required } from './common';

function available(balance: BalanceModel): number {
  return Math.max(0, balance.onHand - balance.reserved);
}

export const catalogResolvers: Resolvers = {
  Query: {
    viewer: (_parent, _args, ctx) => ctx.viewer,
    categories: (_parent, _args, ctx) => listCategories(ctx.services.db),
    warehouses: (_parent, _args, ctx) => loaders(ctx).allWarehouses(),
    product: (_parent, args, ctx) => findProductBySlug(ctx.services.db, args.slug),
    searchProducts: async (_parent, args, ctx) => {
      const result = await ctx.services.search.search(args.input, args.first, args.after);
      return {
        totalCount: result.totalCount,
        facets: result.facets,
        edges: result.hits.map((hit) => ({
          cursor: hit.cursor,
          node: {
            productId: hit.productId,
            slug: hit.slug,
            name: hit.name,
            categorySlug: hit.categorySlug,
            categoryName: hit.categoryName,
            fromPrice: money(hit.fromPriceMinor),
            inStock: hit.inStock,
            score: hit.score,
          },
        })),
        pageInfo: { hasNextPage: result.hasNextPage, endCursor: result.hits.at(-1)?.cursor ?? null },
      };
    },
    productSuggestions: (_parent, args, ctx) => ctx.services.search.suggest(args.prefix, args.limit),
  },
  Product: {
    category: async (product, _args, ctx) => required(await loaders(ctx).category.load(product.categoryId), 'Category'),
    skus: (product, _args, ctx) => loaders(ctx).skusByProduct.load(product.id),
    fromPrice: async (product, _args, ctx) => {
      const skus = await loaders(ctx).skusByProduct.load(product.id);
      return money(skus.length === 0 ? 0 : Math.min(...skus.map((s) => s.priceMinor)));
    },
    availableQuantity: async (product, _args, ctx) => {
      const skus = await loaders(ctx).skusByProduct.load(product.id);
      const balances = await loaders(ctx).balancesBySku.loadMany(skus.map((s) => s.id));
      let total = 0;
      for (const list of balances) {
        if (list instanceof Error) throw list;
        for (const balance of list) total += available(balance);
      }
      return total;
    },
  },
  Sku: {
    price: (sku) => money(sku.priceMinor),
    product: async (sku, _args, ctx) => {
      const product = await loaders(ctx).product.load(sku.productId);
      if (!product) throw notFound('Product');
      return product;
    },
    stock: (sku, _args, ctx) => loaders(ctx).balancesBySku.load(sku.id),
    availableQuantity: async (sku, _args, ctx) => {
      const balances = await loaders(ctx).balancesBySku.load(sku.id);
      return balances.reduce((sum, balance) => sum + available(balance), 0);
    },
  },
  StockLevel: {
    warehouse: async (balance, _args, ctx) => required(await loaders(ctx).warehouse.load(balance.warehouseId), 'Warehouse'),
    available: (balance) => available(balance),
  },
  InventoryBalance: {
    sku: async (balance, _args, ctx) => required(await loaders(ctx).sku.load(balance.skuId), 'SKU'),
    warehouse: async (balance, _args, ctx) => required(await loaders(ctx).warehouse.load(balance.warehouseId), 'Warehouse'),
    available: (balance) => available(balance),
  },
};
