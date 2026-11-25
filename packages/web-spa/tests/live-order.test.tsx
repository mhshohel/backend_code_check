import { describe, expect, it } from '@jest/globals';
import type { OrderUpdatedSubscription } from '@ofl/graphql-types';
import { screen, waitFor } from '@testing-library/react';
import userEvent from '@testing-library/user-event';
import { act } from 'react';
import { makeSubject } from 'wonka';
import { ids, orderDetail } from './fixtures';
import { renderApp, viewers } from './test-utils';

type Event = { data: OrderUpdatedSubscription };

function event(overrides: Parameters<typeof orderDetail>[0], occurredAt: string): Event {
  return { data: { orderUpdated: { occurredAt, order: orderDetail(overrides) } } };
}

describe('order detail live status', () => {
  it('updates the status from OrderUpdated events', async () => {
    const subject = makeSubject<Event>();
    const app = renderApp({
      path: `/orders/${ids.order}`,
      viewer: viewers.customer,
      handlers: { OrderDetail: () => ({ data: { order: orderDetail() } }), OrderUpdated: () => subject.source },
    });

    expect(await screen.findByText(/Payment pending\. Stock is reserved/)).toBeInTheDocument();
    await waitFor(() => expect(app.mock.calls('OrderUpdated')).toEqual([{ orderId: ids.order }]));

    act(() =>
      subject.next(
        event(
          { status: 'CONFIRMED', updatedAt: '2026-11-25T10:01:00.000Z', allowedActions: { canCancel: true, canRequestReturn: false, shippableWarehouses: [], receivableReturnIds: [] } },
          '2026-11-25T10:01:00.000Z',
        ),
      ),
    );
    expect(await screen.findByText('Order status: Confirmed.')).toBeInTheDocument();

    // A stale event (older updatedAt) never overrides newer state.
    act(() => subject.next(event({}, '2026-11-25T10:00:00.000Z')));
    expect(screen.getByText('Order status: Confirmed.')).toBeInTheDocument();

    act(() =>
      subject.next(
        event(
          { status: 'CANCELLED', cancellationReason: 'PAYMENT_DECLINED', updatedAt: '2026-11-25T10:02:00.000Z', allowedActions: { canCancel: false, canRequestReturn: false, shippableWarehouses: [], receivableReturnIds: [] } },
          '2026-11-25T10:02:00.000Z',
        ),
      ),
    );
    expect(await screen.findByText('Order status: Cancelled (Payment declined).')).toBeInTheDocument();
    expect(screen.queryByRole('button', { name: 'Cancel order' })).not.toBeInTheDocument();
  });

  it('cancels after confirmation and reports the result', async () => {
    const user = userEvent.setup();
    const cancelled = orderDetail({ status: 'CANCELLED', cancellationReason: 'CUSTOMER_REQUEST', updatedAt: '2026-11-25T10:05:00.000Z' });
    const app = renderApp({
      path: `/orders/${ids.order}`,
      viewer: viewers.customer,
      handlers: {
        OrderDetail: () => ({ data: { order: orderDetail() } }),
        CancelOrder: () => ({ data: { cancelOrder: { __typename: 'OrderCancelled', order: cancelled } } }),
      },
    });
    await user.click(await screen.findByRole('button', { name: 'Cancel order' }));
    await user.click(screen.getByRole('button', { name: 'Yes, cancel order' }));
    expect(await screen.findByText('Order ORD-100042 was cancelled.')).toBeInTheDocument();
    expect(app.mock.calls('CancelOrder')).toEqual([{ orderId: ids.order }]);
  });

  it('limits return quantities to returnableQuantity', async () => {
    const user = userEvent.setup();
    const shipped = orderDetail({
      status: 'SHIPPED',
      allowedActions: { canCancel: false, canRequestReturn: true, shippableWarehouses: [], receivableReturnIds: [] },
    });
    const line = shipped.lines[0];
    if (!line) throw new Error('fixture has a line');
    shipped.lines = [{ ...line, shippedQuantity: 2, returnableQuantity: 2 }];
    const app = renderApp({
      path: `/orders/${ids.order}`,
      viewer: viewers.customer,
      handlers: {
        OrderDetail: () => ({ data: { order: shipped } }),
        RequestReturn: () => ({ data: { requestReturn: { __typename: 'ReturnRequested', return: { id: ids.ret, status: 'REQUESTED' }, order: shipped } } }),
      },
    });
    const quantity = await screen.findByLabelText(/Trail Mug \(MUG-BLUE\), up to 2/);
    await user.type(quantity, '3', { initialSelectionStart: 0, initialSelectionEnd: 1 });
    await user.type(screen.getByLabelText('Reason'), 'Too small');
    await user.click(screen.getByRole('button', { name: 'Request return' }));
    expect(await screen.findByText('MUG-BLUE: at most 2 can be returned.')).toBeInTheDocument();
    expect(app.mock.calls('RequestReturn')).toEqual([]);

    await user.type(quantity, '2', { initialSelectionStart: 0, initialSelectionEnd: 1 });
    await user.click(screen.getByRole('button', { name: 'Request return' }));
    expect(await screen.findByText(/Return requested/)).toBeInTheDocument();
    expect(app.mock.calls('RequestReturn')).toEqual([
      { input: { orderId: ids.order, reason: 'Too small', lines: [{ orderLineId: ids.line1, quantity: 2 }] } },
    ]);
  });
});
