import { describe, expect, it } from '@jest/globals';
import { screen, waitFor } from '@testing-library/react';
import { east, ids, orderDetail } from './fixtures';
import { renderApp, viewers } from './test-utils';

const navLinks = () => screen.getByRole('navigation', { name: 'Main' });

describe('role-dependent controls', () => {
  it('shows staff and admin navigation only to those roles', async () => {
    const { unmount } = renderApp({ path: '/cart', viewer: viewers.customer });
    expect(await screen.findByRole('link', { name: 'My orders' })).toBeInTheDocument();
    expect(navLinks()).not.toHaveTextContent('Warehouse');
    expect(navLinks()).not.toHaveTextContent('Operations');
    unmount();

    const operator = renderApp({ path: '/cart', viewer: viewers.operator });
    expect(await screen.findByRole('link', { name: 'Warehouse' })).toBeInTheDocument();
    expect(navLinks()).not.toHaveTextContent('Operations');
    operator.unmount();

    renderApp({ path: '/cart', viewer: viewers.admin });
    expect(await screen.findByRole('link', { name: 'Operations' })).toBeInTheDocument();
    expect(screen.getByRole('link', { name: 'Warehouse' })).toBeInTheDocument();
  });

  it('redirects anonymous visitors to sign in and blocks other roles', async () => {
    const anonymous = renderApp({ path: '/warehouse' });
    await waitFor(() => expect(anonymous.router.state.location.pathname).toBe('/login'));
    expect(anonymous.router.state.location.search).toBe('?next=%2Fwarehouse');
    anonymous.unmount();

    const customer = renderApp({ path: '/warehouse', viewer: viewers.customer });
    expect(await screen.findByRole('alert')).toHaveTextContent('does not have access');
    expect(customer.mock.calls('OperatorOrders')).toEqual([]);
    customer.unmount();

    const operator = renderApp({ path: '/admin', viewer: viewers.operator });
    expect(await screen.findByRole('alert')).toHaveTextContent('does not have access');
    expect(operator.mock.calls('OperationsSummary')).toEqual([]);
  });

  it('drives order buttons from allowedActions', async () => {
    const withActions = orderDetail({
      status: 'CONFIRMED',
      allowedActions: { canCancel: false, canRequestReturn: false, shippableWarehouses: [east], receivableReturnIds: [ids.ret] },
      returns: [
        {
          id: ids.ret,
          status: 'REQUESTED',
          reason: 'Too small',
          createdAt: '2026-11-25T11:00:00.000Z',
          receivedAt: null,
          refundedAt: null,
          refund: { amountMinor: 1250, currency: 'USD', formatted: '$12.50' },
          lines: [{ orderLineId: ids.line1, skuCode: 'MUG-BLUE', quantity: 1, warehouse: east }],
        },
      ],
    });
    renderApp({ path: `/orders/${ids.order}`, viewer: viewers.operator, handlers: { OrderDetail: () => ({ data: { order: withActions } }) } });
    expect(await screen.findByRole('button', { name: 'Ship from WH-EAST' })).toBeInTheDocument();
    expect(screen.getByRole('button', { name: 'Receive return' })).toBeInTheDocument();
    expect(screen.queryByRole('button', { name: 'Cancel order' })).not.toBeInTheDocument();
    expect(screen.queryByRole('form', { name: 'Request a return' })).not.toBeInTheDocument();
  });

  it('shows only customer actions to a customer', async () => {
    renderApp({ path: `/orders/${ids.order}`, viewer: viewers.customer, handlers: { OrderDetail: () => ({ data: { order: orderDetail() } }) } });
    expect(await screen.findByRole('button', { name: 'Cancel order' })).toBeInTheDocument();
    expect(screen.queryByRole('button', { name: /Ship from/ })).not.toBeInTheDocument();
    expect(screen.queryByRole('button', { name: 'Receive return' })).not.toBeInTheDocument();
  });
});
