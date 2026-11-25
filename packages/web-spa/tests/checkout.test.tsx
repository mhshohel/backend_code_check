import { describe, expect, it } from '@jest/globals';
import { screen, waitFor } from '@testing-library/react';
import userEvent from '@testing-library/user-event';
import { CombinedError } from 'urql';
import { never } from 'wonka';
import { createAppStore } from '../src/app/store';
import { itemAdded } from '../src/features/cart/cartSlice';
import { ids, money, orderDetail } from './fixtures';
import { memoryStorage, renderApp, viewers, type Handler } from './test-utils';

function storeWithCart() {
  const store = createAppStore({ storage: memoryStorage() });
  store.dispatch(
    itemAdded({ skuId: ids.sku1, productSlug: 'trail-mug', productName: 'Trail Mug', skuCode: 'MUG-BLUE', skuLabel: 'Blue', unitPriceMinor: 1250, quantity: 2 }),
  );
  return store;
}

function renderCheckout(checkout: Handler, extra: Record<string, Handler> = {}) {
  return renderApp({ path: '/cart', viewer: viewers.customer, store: storeWithCart(), handlers: { Checkout: checkout, ...extra } });
}

type CheckoutVariables = { input: { idempotencyKey: string; paymentToken: string; lines: unknown[] } };
const checkoutCalls = (app: ReturnType<typeof renderApp>) => app.mock.calls('Checkout') as CheckoutVariables[];

describe('checkout feedback', () => {
  it('shows "Reserving stock…" while the request is pending', async () => {
    const user = userEvent.setup();
    renderCheckout(() => never);
    await user.click(await screen.findByRole('button', { name: 'Place order' }));
    expect(await screen.findByText('Reserving stock…')).toBeInTheDocument();
  });

  it('sends the expected prices and payment token, then opens the order on success', async () => {
    const user = userEvent.setup();
    const app = renderCheckout(() => ({ data: { checkout: { __typename: 'CheckoutSucceeded', replayed: false, order: orderDetail() } } }), {
      OrderDetail: () => ({ data: { order: orderDetail() } }),
    });
    await user.click(await screen.findByRole('radio', { name: /decline/ }));
    await user.click(screen.getByRole('button', { name: 'Place order' }));

    await waitFor(() => expect(app.router.state.location.pathname).toBe(`/orders/${ids.order}`));
    const [call] = checkoutCalls(app);
    expect(call?.input).toEqual({
      idempotencyKey: expect.any(String),
      paymentToken: 'tok_decline',
      lines: [{ skuId: ids.sku1, quantity: 2, expectedUnitPriceMinor: 1250 }],
    });
    expect(app.store.getState().cart.lines).toEqual([]);
    expect(app.store.getState().checkout.idempotencyKey).toBeNull();
    expect(await screen.findByText(/Payment pending\. Stock is reserved until/)).toBeInTheDocument();
  });

  it('offers to update cart prices after PriceChanged', async () => {
    const user = userEvent.setup();
    const app = renderCheckout(() => ({
      data: {
        checkout: {
          __typename: 'PriceChanged',
          code: 'PRICE_CHANGED',
          message: 'Some prices changed.',
          lines: [{ skuId: ids.sku1, expectedUnitPriceMinor: 1250, currentUnitPrice: money(1500) }],
        },
      },
    }));
    await user.click(await screen.findByRole('button', { name: 'Place order' }));
    expect(await screen.findByText(/was \$12\.50, now \$15\.00/)).toBeInTheDocument();
    expect(app.store.getState().checkout.idempotencyKey).toBeNull();

    await user.click(screen.getByRole('button', { name: 'Update cart prices' }));
    expect(app.store.getState().cart.lines[0]?.unitPriceMinor).toBe(1500);
    expect(screen.queryByText('Prices changed')).not.toBeInTheDocument();
  });

  it('explains InsufficientStock and can reduce quantities', async () => {
    const user = userEvent.setup();
    const app = renderCheckout(() => ({
      data: {
        checkout: {
          __typename: 'InsufficientStock',
          code: 'INSUFFICIENT_STOCK',
          message: 'Not enough stock.',
          lines: [{ skuId: ids.sku1, requested: 2, available: 1 }],
        },
      },
    }));
    await user.click(await screen.findByRole('button', { name: 'Place order' }));
    expect(await screen.findByText(/you asked for 2, 1 available/)).toBeInTheDocument();
    await user.click(screen.getByRole('button', { name: 'Reduce to available quantities' }));
    expect(app.store.getState().cart.lines[0]?.quantity).toBe(1);
  });

  it('explains IdempotencyKeyReused and starts a new attempt', async () => {
    const user = userEvent.setup();
    const app = renderCheckout(() => ({
      data: { checkout: { __typename: 'IdempotencyKeyReused', code: 'IDEMPOTENCY_KEY_REUSED', message: 'This key was used for a different request.' } },
    }));
    await user.click(await screen.findByRole('button', { name: 'Place order' }));
    expect(await screen.findByText('Checkout already submitted')).toBeInTheDocument();
    expect(app.store.getState().checkout.idempotencyKey).toBeNull();
  });

  it('keeps the idempotency key after a network failure so the retry replays', async () => {
    const user = userEvent.setup();
    let attempt = 0;
    const app = renderCheckout(
      () => {
        attempt += 1;
        if (attempt === 1) return { error: new CombinedError({ networkError: new Error('offline') }) };
        return { data: { checkout: { __typename: 'CheckoutSucceeded', replayed: true, order: orderDetail() } } };
      },
      { OrderDetail: () => ({ data: { order: orderDetail() } }) },
    );
    await user.click(await screen.findByRole('button', { name: 'Place order' }));
    expect(await screen.findByText('Checkout did not complete')).toBeInTheDocument();
    expect(screen.getByRole('alert')).toHaveTextContent(/Retrying is safe/);
    const firstKey = app.store.getState().checkout.idempotencyKey;
    expect(firstKey).toEqual(expect.any(String));

    await user.click(screen.getByRole('button', { name: 'Retry placing order' }));
    await waitFor(() => expect(app.router.state.location.pathname).toBe(`/orders/${ids.order}`));
    const [first, second] = checkoutCalls(app);
    expect(second?.input.idempotencyKey).toBe(first?.input.idempotencyKey);
    expect(second?.input.idempotencyKey).toBe(firstKey);
    expect(await screen.findByText('Your earlier checkout had already been placed.')).toBeInTheDocument();
  });

  it('asks staff and anonymous visitors to use a customer account', async () => {
    renderApp({ path: '/cart', viewer: viewers.operator, store: storeWithCart() });
    expect(await screen.findByText('Only customer accounts can check out.')).toBeInTheDocument();
    expect(screen.queryByRole('button', { name: 'Place order' })).not.toBeInTheDocument();
  });
});
