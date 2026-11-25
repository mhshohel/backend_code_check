import { beforeEach, describe, expect, it } from '@jest/globals';
import { screen } from '@testing-library/react';
import userEvent from '@testing-library/user-event';
import { CombinedError } from '@urql/core';
import type { OperationResult } from '@urql/core';
import { CheckoutPanel } from '@/modules/checkout/CheckoutPanel';
import type { CartLine } from '@/modules/cart/cart-slice';
import { createFakeClient, renderWithProviders } from '../support/render';
import { routerCalls } from '../support/next-navigation';
import { makeOrder, SKU_A, SKU_B } from '../support/fixtures';

const cartLines: CartLine[] = [
  { skuId: SKU_A, skuCode: 'LAMP-L', skuLabel: 'Large', productName: 'Desk lamp', productSlug: 'desk-lamp', unitPriceMinor: 2999, quantity: 2 },
  { skuId: SKU_B, skuCode: 'CHAIR', skuLabel: 'Oak', productName: 'Chair', productSlug: 'chair', unitPriceMinor: 8900, quantity: 1 },
];

type Reply = Partial<OperationResult>;
let replies: Reply[];

function setup() {
  const fake = createFakeClient((operationName) => (operationName === 'Checkout' ? (replies.shift() ?? null) : null));
  const rendered = renderWithProviders(<CheckoutPanel />, { client: fake.client, preloadedState: { cart: { lines: cartLines } } });
  const keys = () =>
    fake.calls.filter((call) => call.operationName === 'Checkout').map((call) => (call.variables.input as { idempotencyKey: string }).idempotencyKey);
  return { ...rendered, fake, keys, user: userEvent.setup() };
}

const placeOrder = () => screen.getByRole('button', { name: 'Place order' });

beforeEach(() => {
  replies = [];
});

describe('CheckoutPanel', () => {
  it('sends the cart with expected prices and an idempotency key, then clears the cart on success', async () => {
    replies.push({ data: { checkout: { __typename: 'CheckoutSucceeded', replayed: false, order: makeOrder() } } });
    const { user, fake, store } = setup();
    await user.click(placeOrder());

    const input = fake.calls[0]?.variables.input as { idempotencyKey: string; lines: unknown; paymentToken: string };
    expect(input.paymentToken).toBe('tok_approve');
    expect(input.lines).toEqual([
      { skuId: SKU_A, quantity: 2, expectedUnitPriceMinor: 2999 },
      { skuId: SKU_B, quantity: 1, expectedUnitPriceMinor: 8900 },
    ]);
    expect(input.idempotencyKey.length).toBeGreaterThanOrEqual(8);

    const heading = await screen.findByRole('heading', { name: 'Order ORD-100042 placed' });
    expect(heading).toHaveFocus();
    expect(screen.getByText(/Payment is being processed/)).toBeInTheDocument();
    expect(screen.getByRole('link', { name: 'Follow the order status live' })).toHaveAttribute('href', expect.stringContaining('/orders/'));
    expect(store.getState().cart.lines).toHaveLength(0);
    expect(store.getState().checkout.idempotencyKey).toBeNull();
    expect(routerCalls).toContainEqual({ method: 'refresh' });
  });

  it('explains a replayed success without implying a second order', async () => {
    replies.push({ data: { checkout: { __typename: 'CheckoutSucceeded', replayed: true, order: makeOrder() } } });
    const { user } = setup();
    await user.click(placeOrder());
    expect(await screen.findByRole('heading', { name: 'Order ORD-100042 was already placed' })).toBeInTheDocument();
    expect(screen.getByText(/no second order was created/)).toBeInTheDocument();
  });

  it('lists short lines on InsufficientStock and can reduce quantities, which starts a new attempt key', async () => {
    replies.push(
      {
        data: {
          checkout: {
            __typename: 'InsufficientStock',
            code: 'INSUFFICIENT_STOCK',
            message: 'Not enough stock.',
            lines: [{ skuId: SKU_A, requested: 2, available: 1 }, { skuId: SKU_B, requested: 1, available: 0 }],
          },
        },
      },
      { data: { checkout: { __typename: 'CheckoutSucceeded', replayed: false, order: makeOrder() } } },
    );
    const { user, store, keys } = setup();
    await user.click(placeOrder());

    expect(await screen.findByRole('heading', { name: /no longer available/ })).toBeInTheDocument();
    expect(screen.getByText('Desk lamp (Large): you asked for 2, 1 available.')).toBeInTheDocument();
    await user.click(screen.getByRole('button', { name: 'Reduce to available quantities' }));
    expect(store.getState().cart.lines).toEqual([{ ...cartLines[0], quantity: 1 }]);

    await user.click(placeOrder());
    await screen.findByRole('heading', { name: 'Order ORD-100042 placed' });
    const [first, second] = keys();
    expect(first).toBeDefined();
    expect(second).not.toBe(first);
  });

  it('shows new prices on PriceChanged and applies them when accepted', async () => {
    replies.push({
      data: {
        checkout: {
          __typename: 'PriceChanged',
          code: 'PRICE_CHANGED',
          message: 'Prices changed.',
          lines: [{ skuId: SKU_A, expectedUnitPriceMinor: 2999, currentUnitPrice: { amountMinor: 3499, currency: 'USD', formatted: '$34.99' } }],
        },
      },
    });
    const { user, store } = setup();
    await user.click(placeOrder());
    expect(await screen.findByText('Desk lamp (Large): was $29.99, now $34.99.')).toBeInTheDocument();
    await user.click(screen.getByRole('button', { name: 'Accept new prices' }));
    expect(store.getState().cart.lines[0]?.unitPriceMinor).toBe(3499);
  });

  it('offers a fresh attempt on IdempotencyKeyReused', async () => {
    replies.push({ data: { checkout: { __typename: 'IdempotencyKeyReused', code: 'IDEMPOTENCY_KEY_REUSED', message: 'Key reused.' } } });
    const { user, store } = setup();
    await user.click(placeOrder());
    expect(await screen.findByRole('heading', { name: /conflicts with an earlier one/ })).toBeInTheDocument();
    expect(store.getState().checkout.idempotencyKey).toBeNull();
    await user.click(screen.getByRole('button', { name: 'Start a new checkout' }));
    expect(screen.queryByRole('heading', { name: /conflicts/ })).not.toBeInTheDocument();
  });

  it('keeps the same key when retrying after a network failure', async () => {
    replies.push(
      { error: new CombinedError({ networkError: new Error('socket hang up') }) },
      { data: { checkout: { __typename: 'CheckoutSucceeded', replayed: true, order: makeOrder() } } },
    );
    const { user, keys, store } = setup();
    await user.click(placeOrder());

    expect(await screen.findByRole('heading', { name: 'We could not confirm your order' })).toBeInTheDocument();
    expect(screen.getByText(/Retrying is safe/)).toBeInTheDocument();
    expect(store.getState().checkout.phase).toBe('network-error');
    expect(store.getState().cart.lines).toHaveLength(2);

    await user.click(screen.getByRole('button', { name: 'Retry checkout' }));
    await screen.findByRole('heading', { name: 'Order ORD-100042 was already placed' });
    const [first, second] = keys();
    expect(second).toBe(first);
  });

  it('shows server validation errors from BAD_USER_INPUT', async () => {
    replies.push({
      error: new CombinedError({
        graphQLErrors: [
          { message: 'The input is not valid.', extensions: { code: 'BAD_USER_INPUT', fieldErrors: [{ path: 'lines.0.quantity', message: 'Must be at most 100.' }] } },
        ],
      }),
    });
    const { user } = setup();
    await user.click(placeOrder());
    expect(await screen.findByRole('heading', { name: 'Checkout failed' })).toBeInTheDocument();
    expect(screen.getByRole('alert')).toHaveTextContent('lines.0.quantity: Must be at most 100.');
  });

  it('uses the selected payment token', async () => {
    replies.push({ data: { checkout: { __typename: 'CheckoutSucceeded', replayed: false, order: makeOrder() } } });
    const { user, fake } = setup();
    await user.selectOptions(screen.getByLabelText('Payment method'), 'tok_decline');
    await user.click(placeOrder());
    await screen.findByRole('heading', { name: /placed/ });
    expect((fake.calls[0]?.variables.input as { paymentToken: string }).paymentToken).toBe('tok_decline');
  });
});
