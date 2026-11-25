import { describe, expect, it } from '@jest/globals';
import { screen, within } from '@testing-library/react';
import userEvent from '@testing-library/user-event';
import { STORAGE_KEY } from '../src/app/persistence';
import { createAppStore } from '../src/app/store';
import { cartSlice, itemAdded, itemRemoved, quantityChanged } from '../src/features/cart/cartSlice';
import { attemptStarted } from '../src/features/checkout/checkoutSlice';
import { ids, productDetail } from './fixtures';
import { memoryStorage, renderApp, viewers } from './test-utils';

const line = {
  skuId: ids.sku1,
  productSlug: 'trail-mug',
  productName: 'Trail Mug',
  skuCode: 'MUG-BLUE',
  skuLabel: 'Blue',
  unitPriceMinor: 1250,
  quantity: 1,
};

describe('cart state', () => {
  it('adds, merges, updates and removes lines', () => {
    let state = cartSlice.reducer(undefined, itemAdded(line));
    state = cartSlice.reducer(state, itemAdded({ ...line, quantity: 2 }));
    expect(state.lines).toEqual([{ ...line, quantity: 3 }]);
    state = cartSlice.reducer(state, quantityChanged({ skuId: ids.sku1, quantity: 500 }));
    expect(state.lines[0]?.quantity).toBe(100);
    state = cartSlice.reducer(state, itemRemoved({ skuId: ids.sku1 }));
    expect(state.lines).toEqual([]);
  });

  it('persists the cart and ignores corrupt storage', () => {
    const storage = memoryStorage();
    const store = createAppStore({ storage });
    store.dispatch(itemAdded(line));
    expect(JSON.parse(storage.data[STORAGE_KEY] ?? '{}').cart.lines).toHaveLength(1);
    expect(createAppStore({ storage }).getState().cart.lines).toEqual([line]);

    const corrupt = memoryStorage({ [STORAGE_KEY]: '{"cart":{"lines":[{"skuId":1}]},"checkout":"x"}' });
    expect(createAppStore({ storage: corrupt }).getState().cart.lines).toEqual([]);
    expect(createAppStore({ storage: memoryStorage({ [STORAGE_KEY]: 'not json' }) }).getState().cart.lines).toEqual([]);
  });

  it('starts a new checkout attempt when the cart changes', () => {
    const store = createAppStore();
    store.dispatch(itemAdded(line));
    store.dispatch(attemptStarted());
    const key = store.getState().checkout.idempotencyKey;
    expect(key).toEqual(expect.any(String));
    store.dispatch(attemptStarted());
    expect(store.getState().checkout.idempotencyKey).toBe(key);
    store.dispatch(quantityChanged({ skuId: ids.sku1, quantity: 2 }));
    expect(store.getState().checkout.idempotencyKey).toBeNull();
  });
});

describe('cart UI', () => {
  it('adds from the product page, then updates and removes in the cart', async () => {
    const user = userEvent.setup();
    const app = renderApp({ path: '/products/trail-mug', viewer: viewers.customer, handlers: { ProductDetail: () => ({ data: productDetail() }) } });

    const availability = await screen.findByRole('table', { name: 'Availability for Blue' });
    expect(within(availability).getByText('East')).toBeInTheDocument();
    const quantity = screen.getByLabelText('Quantity');
    await user.type(quantity, '2', { initialSelectionStart: 0, initialSelectionEnd: 1 });
    await user.click(screen.getByRole('button', { name: 'Add Blue to cart' }));
    expect(await screen.findByText(/Added 2 × Trail Mug/)).toBeInTheDocument();
    expect(app.store.getState().cart.lines).toEqual([{ ...line, quantity: 2 }]);

    await app.router.navigate('/cart');
    expect(await screen.findByLabelText('Estimated total')).toHaveTextContent('$25.00');
    const cartQuantity = screen.getByLabelText('Quantity for Trail Mug (Blue)');
    await user.type(cartQuantity, '3', { initialSelectionStart: 0, initialSelectionEnd: 1 });
    expect(app.store.getState().cart.lines[0]?.quantity).toBe(3);
    expect(screen.getByLabelText('Estimated total')).toHaveTextContent('$37.50');

    await user.click(screen.getByRole('button', { name: 'Remove Trail Mug (Blue)' }));
    expect(screen.getByText('Your cart is empty.')).toBeInTheDocument();
    expect(app.store.getState().cart.lines).toEqual([]);
  });
});
