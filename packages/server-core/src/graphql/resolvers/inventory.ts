import { pageRequest } from '../../db/pagination';
import { parseIdArgument, requireStaff } from '../../features/auth/guards';
import { adjustInventory } from '../../features/inventory/operations';
import { listBalances, listMovements } from '../../features/inventory/queries';
import type { Resolvers } from '../generated/resolvers';
import { loaders, required, typenameOf } from './common';

export const inventoryResolvers: Resolvers = {
  Query: {
    inventory: (_parent, args, ctx) => {
      requireStaff(ctx.viewer);
      return listBalances(
        ctx.services.db,
        { warehouseId: parseIdArgument(args.warehouseId, 'warehouseId'), lowStockOnly: args.lowStockOnly === true },
        pageRequest(args.first, args.after),
      );
    },
    inventoryMovements: (_parent, args, ctx) => {
      requireStaff(ctx.viewer);
      return listMovements(ctx.services.db, { skuId: parseIdArgument(args.skuId, 'skuId'), warehouseId: parseIdArgument(args.warehouseId, 'warehouseId') }, pageRequest(args.first, args.after));
    },
  },
  Mutation: {
    adjustInventory: async (_parent, args, ctx) => {
      const outcome = await adjustInventory(ctx.services, ctx.viewer, args.input, ctx.meta);
      if (outcome.kind === 'adjusted') return { __typename: 'InventoryAdjusted', balance: outcome.balance, movement: outcome.movement };
      return {
        __typename: 'AdjustmentRejected',
        code: 'ADJUSTMENT_REJECTED',
        message: 'On-hand stock cannot drop below the reserved units.',
        onHand: outcome.onHand,
        reserved: outcome.reserved,
      };
    },
  },
  AdjustInventoryResult: { __resolveType: (parent) => typenameOf(parent) },
  InventoryMovement: {
    sku: async (movement, _args, ctx) => required(await loaders(ctx).sku.load(movement.skuId), 'SKU'),
    warehouse: async (movement, _args, ctx) => required(await loaders(ctx).warehouse.load(movement.warehouseId), 'Warehouse'),
    actor: (movement, _args, ctx) => (movement.actorUserId ? loaders(ctx).user.load(movement.actorUserId) : null),
  },
};
