import { isCancellable, isReturnableStatus, isStaff, returnableQuantity } from '@ofl/domain';
import { pageRequest } from '../../db/pagination';
import { checkout } from '../../features/checkout/operations';
import { shipOrder } from '../../features/fulfillment/operations';
import { cancelOrder, getOrderForViewer } from '../../features/orders/operations';
import { listAllOrders, listMyOrders } from '../../features/orders/queries';
import { findOrder, type OrderRecord } from '../../features/orders/records';
import { receiveReturn, requestReturn } from '../../features/returns/operations';
import type { GraphQLContext } from '../context';
import type { OrderActions, Resolvers, ResolversTypes } from '../generated/resolvers';
import type { OrderModel, WarehouseModel } from '../models';
import { loaders, money, required, typenameOf } from './common';
import { subscribeToOrder, type OrderUpdatedPayload } from './order-subscription';

async function loadOrder(ctx: GraphQLContext, orderId: string): Promise<OrderRecord> {
  return required(await findOrder(ctx.services.db, orderId), 'Order');
}

/** Same rules the workflows enforce, evaluated for display (requirements: allowedActions). */
async function allowedActions(order: OrderModel, ctx: GraphQLContext): Promise<Omit<OrderActions, 'shippableWarehouses'> & { shippableWarehouses: WarehouseModel[] }> {
  const viewer = ctx.viewer;
  if (!viewer) return { canCancel: false, canRequestReturn: false, shippableWarehouses: [], receivableReturnIds: [] };
  const staff = isStaff(viewer.role);
  const isOwner = order.customerId === viewer.id;
  const load = loaders(ctx);

  const [shipments, lines, reservations, returns] = await Promise.all([
    load.shipmentsByOrder.load(order.id),
    isOwner && isReturnableStatus(order.status) ? load.linesByOrder.load(order.id) : Promise.resolve([]),
    staff ? load.reservationsByOrder.load(order.id) : Promise.resolve([]),
    staff ? load.returnsByOrder.load(order.id) : Promise.resolve([]),
  ]);

  let canRequestReturn = false;
  if (isOwner && !staff && lines.length > 0) {
    const [shipped, returned] = await Promise.all([
      load.shippedQuantityByLine.loadMany(lines.map((l) => l.id)),
      load.returnedQuantityByLine.loadMany(lines.map((l) => l.id)),
    ]);
    canRequestReturn = lines.some((line, index) => {
      const shippedQuantity = shipped[index];
      const returnedQuantity = returned[index];
      if (typeof shippedQuantity !== 'number' || typeof returnedQuantity !== 'number') return false;
      return returnableQuantity({ orderLineId: line.id, shippedQuantity, returnedQuantity }) > 0;
    });
  }

  const shippableIds =
    order.status === 'CONFIRMED' || order.status === 'PARTIALLY_SHIPPED'
      ? [...new Set(reservations.filter((r) => r.status === 'CONFIRMED').map((r) => r.warehouseId))]
      : [];
  const warehouses = await load.allWarehouses();
  return {
    canCancel: (staff || isOwner) && isCancellable({ status: order.status, shipmentCount: shipments.length }),
    canRequestReturn,
    shippableWarehouses: warehouses.filter((w) => shippableIds.includes(w.id)),
    receivableReturnIds: returns.filter((r) => r.status === 'REQUESTED').map((r) => r.id),
  };
}

type OrderFilterArg = ResolversTypes['OrderFilter'] | null | undefined;

function toFilter(filter: OrderFilterArg) {
  return {
    status: filter?.status ?? null,
    awaitingShipmentFromWarehouseId: filter?.awaitingShipmentFromWarehouseId ?? null,
    withReturnsAwaitingReceipt: filter?.withReturnsAwaitingReceipt ?? null,
  };
}

export const orderResolvers: Resolvers = {
  Query: {
    order: (_parent, args, ctx) => getOrderForViewer(ctx.services, ctx.viewer, args.id),
    myOrders: (_parent, args, ctx) =>
      listMyOrders(ctx.services.db, ctx.viewer, toFilter(args.filter), pageRequest(args.first, args.after)),
    orders: (_parent, args, ctx) =>
      listAllOrders(ctx.services.db, ctx.viewer, toFilter(args.filter), pageRequest(args.first, args.after)),
  },
  Mutation: {
    checkout: async (_parent, args, ctx) => {
      const outcome = await checkout(ctx.services, ctx.viewer, args.input, ctx.meta);
      switch (outcome.kind) {
        case 'succeeded':
          return { __typename: 'CheckoutSucceeded', replayed: outcome.replayed, order: await loadOrder(ctx, outcome.orderId) };
        case 'insufficient_stock':
          return {
            __typename: 'InsufficientStock',
            code: 'INSUFFICIENT_STOCK',
            message: 'Some items are not available in the requested quantity.',
            lines: outcome.lines,
          };
        case 'price_changed':
          return {
            __typename: 'PriceChanged',
            code: 'PRICE_CHANGED',
            message: 'Some prices changed. Review the cart and try again.',
            lines: outcome.lines.map((line) => ({
              skuId: line.skuId,
              expectedUnitPriceMinor: line.expectedUnitPriceMinor,
              currentUnitPrice: money(line.currentUnitPriceMinor),
            })),
          };
        case 'idempotency_key_reused':
          return {
            __typename: 'IdempotencyKeyReused',
            code: 'IDEMPOTENCY_KEY_REUSED',
            message: 'This idempotency key was already used for a different request.',
          };
      }
    },
    cancelOrder: async (_parent, args, ctx) => {
      const outcome = await cancelOrder(ctx.services, ctx.viewer, args.orderId, ctx.meta);
      if (outcome.kind === 'cancelled') return { __typename: 'OrderCancelled', order: await loadOrder(ctx, outcome.orderId) };
      return {
        __typename: 'OrderNotCancellable',
        code: 'ORDER_NOT_CANCELLABLE',
        message: 'This order can no longer be cancelled.',
        status: outcome.status,
      };
    },
    shipOrder: async (_parent, args, ctx) => {
      const outcome = await shipOrder(ctx.services, ctx.viewer, args.input, ctx.meta);
      switch (outcome.kind) {
        case 'shipped': {
          const order = await loadOrder(ctx, outcome.orderId);
          const shipments = await loaders(ctx).shipmentsByOrder.load(order.id);
          return { __typename: 'ShipmentCreated', order, shipment: required(shipments.find((s) => s.id === outcome.shipmentId), 'Shipment') };
        }
        case 'nothing_to_ship':
          return { __typename: 'NothingToShip', code: 'NOTHING_TO_SHIP', message: 'Nothing is waiting to ship from this warehouse.' };
        case 'not_shippable':
          return {
            __typename: 'OrderNotShippable',
            code: 'ORDER_NOT_SHIPPABLE',
            message: 'Only confirmed orders can ship.',
            status: outcome.status,
          };
      }
    },
    requestReturn: async (_parent, args, ctx) => {
      const outcome = await requestReturn(ctx.services, ctx.viewer, args.input, ctx.meta);
      switch (outcome.kind) {
        case 'requested': {
          const order = await loadOrder(ctx, outcome.orderId);
          const returns = await loaders(ctx).returnsByOrder.load(order.id);
          return { __typename: 'ReturnRequested', order, return: required(returns.find((r) => r.id === outcome.returnId), 'Return') };
        }
        case 'quantity_exceeded':
          return {
            __typename: 'ReturnQuantityExceeded',
            code: 'RETURN_QUANTITY_EXCEEDED',
            message: 'You cannot return more units than were shipped and not yet returned.',
            lines: outcome.lines,
          };
        case 'not_returnable':
          return {
            __typename: 'OrderNotReturnable',
            code: 'ORDER_NOT_RETURNABLE',
            message: 'Only shipped orders can be returned.',
            status: outcome.status,
          };
      }
    },
    receiveReturn: async (_parent, args, ctx) => {
      const outcome = await receiveReturn(ctx.services, ctx.viewer, args.returnId, ctx.meta);
      if (outcome.kind === 'not_receivable') {
        return {
          __typename: 'ReturnNotReceivable',
          code: 'RETURN_NOT_RECEIVABLE',
          message: 'This return was already received.',
          status: outcome.status,
        };
      }
      const order = await loadOrder(ctx, outcome.orderId);
      const returns = await loaders(ctx).returnsByOrder.load(order.id);
      return { __typename: 'ReturnReceived', order, return: required(returns.find((r) => r.id === outcome.returnId), 'Return') };
    },
  },
  Subscription: {
    orderUpdated: {
      subscribe: (_parent, args, ctx) => subscribeToOrder(ctx, args.orderId),
      resolve: (payload: OrderUpdatedPayload) => payload,
    },
  },
  CheckoutResult: { __resolveType: (parent) => typenameOf(parent) },
  CancelOrderResult: { __resolveType: (parent) => typenameOf(parent) },
  ShipOrderResult: { __resolveType: (parent) => typenameOf(parent) },
  RequestReturnResult: { __resolveType: (parent) => typenameOf(parent) },
  ReceiveReturnResult: { __resolveType: (parent) => typenameOf(parent) },
  Order: {
    number: (order) => `ORD-${order.number}`,
    customer: async (order, _args, ctx) => required(await loaders(ctx).user.load(order.customerId), 'Customer'),
    lines: (order, _args, ctx) => loaders(ctx).linesByOrder.load(order.id),
    subtotal: (order) => money(order.subtotalMinor),
    total: (order) => money(order.totalMinor),
    reservations: (order, _args, ctx) => loaders(ctx).reservationsByOrder.load(order.id),
    payment: (order, _args, ctx) => loaders(ctx).paymentByOrder.load(order.id),
    shipments: (order, _args, ctx) => loaders(ctx).shipmentsByOrder.load(order.id),
    returns: (order, _args, ctx) => loaders(ctx).returnsByOrder.load(order.id),
    allowedActions: (order, _args, ctx) => allowedActions(order, ctx),
  },
  OrderLine: {
    sku: async (line, _args, ctx) => required(await loaders(ctx).sku.load(line.skuId), 'SKU'),
    unitPrice: (line) => money(line.unitPriceMinor),
    lineTotal: (line) => money(line.lineTotalMinor),
    shippedQuantity: (line, _args, ctx) => loaders(ctx).shippedQuantityByLine.load(line.id),
    returnedQuantity: (line, _args, ctx) => loaders(ctx).returnedQuantityByLine.load(line.id),
    returnableQuantity: async (line, _args, ctx) => {
      const [shippedQuantity, returnedQuantity] = await Promise.all([
        loaders(ctx).shippedQuantityByLine.load(line.id),
        loaders(ctx).returnedQuantityByLine.load(line.id),
      ]);
      return returnableQuantity({ orderLineId: line.id, shippedQuantity, returnedQuantity });
    },
  },
  Reservation: {
    sku: async (reservation, _args, ctx) => required(await loaders(ctx).sku.load(reservation.skuId), 'SKU'),
    warehouse: async (reservation, _args, ctx) => required(await loaders(ctx).warehouse.load(reservation.warehouseId), 'Warehouse'),
  },
  Payment: {
    amount: (payment) => money(payment.amountMinor),
    refunded: (payment) => money(payment.refundedMinor),
  },
  Shipment: {
    warehouse: async (shipment, _args, ctx) => required(await loaders(ctx).warehouse.load(shipment.warehouseId), 'Warehouse'),
    lines: (shipment, _args, ctx) => loaders(ctx).shipmentLines.load(shipment.id),
  },
  Return: {
    refund: (record) => money(record.refundMinor),
    lines: (record, _args, ctx) => loaders(ctx).returnLines.load(record.id),
  },
  ReturnLine: {
    warehouse: async (line, _args, ctx) => required(await loaders(ctx).warehouse.load(line.warehouseId), 'Warehouse'),
  },
};
