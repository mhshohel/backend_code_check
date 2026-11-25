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
