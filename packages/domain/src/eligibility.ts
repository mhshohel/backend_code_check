import type { OrderStatus } from './state-machines';

export type Role = 'CUSTOMER' | 'OPERATOR' | 'ADMIN';

export type CancellationCheck = {
  readonly status: OrderStatus;
  readonly shipmentCount: number;
};

/** An order can be cancelled until the first unit ships. */
export function isCancellable(order: CancellationCheck): boolean {
  if (order.shipmentCount > 0) return false;
  return order.status === 'PENDING_PAYMENT' || order.status === 'CONFIRMED';
}

export type ReturnableLine = {
  readonly orderLineId: string;
  readonly shippedQuantity: number;
  /** Units on any existing return for this line, whatever its status. */
  readonly returnedQuantity: number;
};

export function returnableQuantity(line: ReturnableLine): number {
  return Math.max(0, line.shippedQuantity - line.returnedQuantity);
}

export function isReturnableStatus(status: OrderStatus): boolean {
  return status === 'PARTIALLY_SHIPPED' || status === 'SHIPPED';
}

export type ReturnRequestLine = { readonly orderLineId: string; readonly quantity: number };

export type ReturnCheck =
  | { readonly kind: 'ok' }
  | { readonly kind: 'exceeded'; readonly lines: { orderLineId: string; requested: number; returnable: number }[] };

/** Checks requested quantities against what was shipped and not yet returned. */
export function checkReturnQuantities(
  requested: readonly ReturnRequestLine[],
  lines: readonly ReturnableLine[],
): ReturnCheck {
  const byId = new Map(lines.map((line) => [line.orderLineId, line]));
  const exceeded: { orderLineId: string; requested: number; returnable: number }[] = [];

  for (const request of requested) {
    const line = byId.get(request.orderLineId);
    const returnable = line ? returnableQuantity(line) : 0;
    if (request.quantity > returnable) {
      exceeded.push({ orderLineId: request.orderLineId, requested: request.quantity, returnable });
    }
  }

  return exceeded.length === 0 ? { kind: 'ok' } : { kind: 'exceeded', lines: exceeded };
}

export function isStaff(role: Role): boolean {
  return role === 'OPERATOR' || role === 'ADMIN';
}

export type AllowedActionsInput = {
  readonly status: OrderStatus;
  readonly shipmentCount: number;
  readonly role: Role;
  readonly isOwner: boolean;
  /** Units shipped and not yet on any return, summed over the order's lines. */
  readonly returnableUnits: number;
  /** Warehouses holding CONFIRMED (unshipped) reservations of the order. */
  readonly confirmedWarehouseIds: readonly string[];
  /** Returns of the order in REQUESTED status. */
  readonly requestedReturnIds: readonly string[];
};

export type AllowedActions = {
  readonly canCancel: boolean;
  readonly canRequestReturn: boolean;
  readonly shippableWarehouseIds: readonly string[];
  readonly receivableReturnIds: readonly string[];
};

/**
 * What the viewer may do with an order, for display. The workflows enforce
 * the same rules again under the order lock.
 * - cancel: owner or staff, until the first unit ships;
 * - request a return: the owning customer, shipped units not yet returned;
 * - ship / receive: staff only.
 */
export function orderAllowedActions(input: AllowedActionsInput): AllowedActions {
  const staff = isStaff(input.role);
  const shippable = input.status === 'CONFIRMED' || input.status === 'PARTIALLY_SHIPPED';
  return {
    canCancel: (staff || input.isOwner) && isCancellable({ status: input.status, shipmentCount: input.shipmentCount }),
    canRequestReturn: input.isOwner && !staff && isReturnableStatus(input.status) && input.returnableUnits > 0,
    shippableWarehouseIds: staff && shippable ? [...new Set(input.confirmedWarehouseIds)] : [],
    receivableReturnIds: staff ? [...input.requestedReturnIds] : [],
  };
}
