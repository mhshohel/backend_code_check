import { describe, expect, it } from '@jest/globals';
import { screen, waitFor, within } from '@testing-library/react';
import userEvent from '@testing-library/user-event';
import { parseMoneyInput } from '../src/features/admin/parseMoneyInput';
import { east, ids, money, orderDetail, west } from './fixtures';
import { renderApp, viewers, type Handler } from './test-utils';

const emptyPage = { edges: [], pageInfo: { hasNextPage: false, endCursor: null } };

const operatorOrder = {
  id: ids.order,
  number: 'ORD-100042',
  status: 'CONFIRMED' as const,
  cancellationReason: null,
  createdAt: '2026-11-25T10:00:00.000Z',
  reservationExpiresAt: '2026-11-25T10:15:00.000Z',
  total: money(2500),
  payment: { id: 'pay-1', status: 'CAPTURED' as const },
  customer: { id: 'u-customer', email: 'customer@example.com', displayName: 'Casey Customer' },
  lines: [{ id: ids.line1, skuCode: 'MUG-BLUE', quantity: 2, shippedQuantity: 0 }],
  reservations: [{ id: 'r-1', quantity: 2, status: 'CONFIRMED' as const, warehouse: east, sku: { id: ids.sku1, code: 'MUG-BLUE' } }],
  allowedActions: { canCancel: true, shippableWarehouses: [east], receivableReturnIds: [] },
};

const warehouseHandlers: Record<string, Handler> = {
  Warehouses: () => ({ data: { warehouses: [east, west] } }),
  OperatorOrders: (variables) => {
    const filter = variables.filter as { awaitingShipmentFromWarehouseId?: string } | undefined;
    return { data: { orders: filter?.awaitingShipmentFromWarehouseId ? { edges: [{ cursor: 'o1', node: operatorOrder }], pageInfo: emptyPage.pageInfo } : emptyPage } };
  },
  Inventory: () => ({
    data: {
      inventory: {
        edges: [
          {
            cursor: 'i1',
            node: { onHand: 5, reserved: 2, available: 3, updatedAt: '2026-11-25T10:00:00.000Z', warehouse: east, sku: { id: ids.sku1, code: 'MUG-BLUE', label: 'Blue', product: { name: 'Trail Mug', slug: 'trail-mug' } } },
          },
        ],
        pageInfo: emptyPage.pageInfo,
      },
    },
  }),
  InventoryMovements: () => ({ data: { inventoryMovements: emptyPage } }),
  ShipOrder: () => ({
    data: { shipOrder: { __typename: 'ShipmentCreated', shipment: { id: 's-1', trackingCode: 'TRK-1', warehouse: east }, order: orderDetail({ status: 'SHIPPED' }) } },
  }),
};

describe('warehouse dashboard', () => {
  it('ships an order from the warehouse it is awaiting', async () => {
    const user = userEvent.setup();
    const app = renderApp({ path: '/warehouse', viewer: viewers.operator, handlers: warehouseHandlers });
    await user.click(await screen.findByRole('button', { name: 'Ship from WH-EAST' }));
    expect(await screen.findByText(/tracking TRK-1/)).toBeInTheDocument();
    expect(app.mock.calls('ShipOrder')).toEqual([{ input: { orderId: ids.order, warehouseId: ids.east } }]);
  });

  it('filters low stock through the URL and validates adjustments', async () => {
    const user = userEvent.setup();
    const app = renderApp({ path: '/warehouse', viewer: viewers.operator, handlers: warehouseHandlers });
    await user.click(await screen.findByRole('checkbox', { name: 'Low stock only' }));
    await waitFor(() => expect(app.mock.calls('Inventory').at(-1)).toMatchObject({ lowStockOnly: true, warehouseId: ids.east }));
    expect(new URLSearchParams(app.router.state.location.search).get('lowStock')).toBe('1');

    await user.click(screen.getByRole('button', { name: /Adjust \/ history for MUG-BLUE/ }));
    const form = (await screen.findByRole('heading', { name: 'Adjust stock' })).closest('section');
    if (!form) throw new Error('adjust form section missing');
    await user.click(within(form).getByRole('button', { name: 'Save change' }));
    expect(within(form).getByLabelText('Quantity change')).toHaveAccessibleDescription(/Enter a quantity\./);
    expect(app.mock.calls('AdjustInventory')).toEqual([]);
  });
});

describe('admin dashboard', () => {
  it('lists failed jobs and retries one', async () => {
    const user = userEvent.setup();
    const job = {
      id: 'job-1', topic: 'search.product_changed', aggregateType: 'product', aggregateId: 'p-1', status: 'FAILED' as const,
      attempts: 8, maxAttempts: 8, lastError: 'ES down', availableAt: '2026-11-25T10:00:00.000Z', createdAt: '2026-11-25T10:00:00.000Z',
    };
    const app = renderApp({
      path: '/admin',
      viewer: viewers.admin,
      handlers: {
        OperationsSummary: () => ({
          data: {
            operationsSummary: {
              pendingJobs: 3, failedJobs: 1, oldestPendingJobAgeSeconds: 12, expiredActiveReservations: 0,
              ordersByStatus: [{ status: 'CONFIRMED', count: 4 }],
              dailyRevenue: [{ day: '2026-11-25', orders: 4, revenue: money(10000), cumulativeRevenue: money(10000) }],
              lowStock: [],
            },
          },
        }),
        Jobs: () => ({ data: { jobs: { edges: [{ cursor: 'j1', node: job }], pageInfo: emptyPage.pageInfo } } }),
        AuditLog: () => ({ data: { auditLog: emptyPage } }),
        RetryJob: () => ({ data: { retryJob: { __typename: 'JobRetried', job: { id: 'job-1', status: 'PENDING', attempts: 8 } } } }),
      },
    });
    expect(await screen.findByText('Failed jobs')).toBeInTheDocument();
    expect(screen.getByRole('rowheader', { name: '2026-11-25' })).toBeInTheDocument();
    await user.click(await screen.findByRole('button', { name: 'Retry job search.product_changed' }));
    expect(await screen.findByText('Job search.product_changed queued again.')).toBeInTheDocument();
    expect(app.mock.calls('RetryJob')).toEqual([{ jobId: 'job-1' }]);
  });

  it('parses typed prices into cents without floating point', () => {
    expect(parseMoneyInput('12.5')).toBe(1250);
    expect(parseMoneyInput('$0.07')).toBe(7);
    expect(parseMoneyInput('19.999')).toBeNull();
    expect(parseMoneyInput('-1')).toBeNull();
  });
});
