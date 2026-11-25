import { describe, expect, it } from '@jest/globals';
import { screen } from '@testing-library/react';
import userEvent from '@testing-library/user-event';
import { OrderLiveView } from '@/modules/orders/OrderLiveView';
import { createFakeClient, renderWithProviders } from '../support/render';
import { makeOrder, LINE_ID, RETURN_ID, WH_EAST } from '../support/fixtures';

const confirmedForStaff = makeOrder({
  status: 'CONFIRMED',
  allowedActions: {
    canCancel: true,
    canRequestReturn: false,
    shippableWarehouses: [{ id: WH_EAST, code: 'WH-EAST', name: 'East' }],
    receivableReturnIds: [RETURN_ID],
  },
});

describe('role-dependent order controls', () => {
  it('shows the customer cancel control but no warehouse controls', () => {
    renderWithProviders(<OrderLiveView initialOrder={makeOrder()} isStaff={false} />);
    expect(screen.getByRole('button', { name: 'Cancel order' })).toBeInTheDocument();
    expect(screen.queryByRole('button', { name: /Ship from/ })).not.toBeInTheDocument();
    expect(screen.queryByRole('button', { name: /Receive/ })).not.toBeInTheDocument();
  });

  it('never shows ship or receive controls to customers even if the payload lists them', () => {
    renderWithProviders(<OrderLiveView initialOrder={confirmedForStaff} isStaff={false} />);
    expect(screen.queryByRole('button', { name: /Ship from/ })).not.toBeInTheDocument();
    expect(screen.queryByRole('button', { name: /Receive/ })).not.toBeInTheDocument();
  });

  it('shows ship and receive controls to staff', () => {
    renderWithProviders(<OrderLiveView initialOrder={confirmedForStaff} isStaff />);
    expect(screen.getByRole('button', { name: 'Ship from WH-EAST' })).toBeInTheDocument();
    expect(screen.getByRole('button', { name: 'Receive return 1' })).toBeInTheDocument();
  });

  it('hides cancel when the server says the order is not cancellable', () => {
    const shipped = makeOrder({
      status: 'SHIPPED',
      allowedActions: { canCancel: false, canRequestReturn: true, shippableWarehouses: [], receivableReturnIds: [] },
      lines: [{ ...makeOrder().lines[0]!, shippedQuantity: 2, returnableQuantity: 2, id: LINE_ID }],
    });
    renderWithProviders(<OrderLiveView initialOrder={shipped} isStaff={false} />);
    expect(screen.queryByRole('button', { name: 'Cancel order' })).not.toBeInTheDocument();
    expect(screen.getByRole('heading', { name: 'Request a return' })).toBeInTheDocument();
    expect(screen.getByLabelText(/Desk lamp \(LAMP-L\) — up to 2/)).toHaveAttribute('max', '2');
  });

  it('asks for confirmation before cancelling and shows the cancelled state', async () => {
    const user = userEvent.setup();
    const cancelled = makeOrder({
      status: 'CANCELLED',
      cancellationReason: 'CUSTOMER_REQUEST',
      updatedAt: '2026-11-25T10:05:00.000Z',
      allowedActions: { canCancel: false, canRequestReturn: false, shippableWarehouses: [], receivableReturnIds: [] },
    });
    const fake = createFakeClient((name) =>
      name === 'CancelOrder' ? { data: { cancelOrder: { __typename: 'OrderCancelled', order: cancelled } } } : null,
    );
    renderWithProviders(<OrderLiveView initialOrder={makeOrder()} isStaff={false} />, { client: fake.client });

    await user.click(screen.getByRole('button', { name: 'Cancel order' }));
    expect(fake.calls.some((call) => call.operationName === 'CancelOrder')).toBe(false);
    await user.click(screen.getByRole('button', { name: 'Yes, cancel order' }));

    expect(fake.calls.some((call) => call.operationName === 'CancelOrder')).toBe(true);
    expect(await screen.findByText('Cancelled')).toBeInTheDocument();
    expect(screen.getByText(/Customer request/)).toBeInTheDocument();
  });

  it('renders the newest order pushed by the subscription', async () => {
    const confirmed = makeOrder({ status: 'CONFIRMED', updatedAt: '2026-11-25T10:01:00.000Z' });
    const fake = createFakeClient((name) =>
      name === 'OrderUpdated' ? { data: { orderUpdated: { occurredAt: confirmed.updatedAt, order: confirmed } } } : null,
    );
    renderWithProviders(<OrderLiveView initialOrder={makeOrder()} isStaff={false} />, { client: fake.client });
    expect(await screen.findByText('Confirmed')).toBeInTheDocument();
    expect(fake.calls.find((call) => call.operationName === 'OrderUpdated')?.variables).toEqual({ orderId: makeOrder().id });
  });
});
