import { describe, expect, it } from '@jest/globals';
import { screen, within } from '@testing-library/react';
import userEvent from '@testing-library/user-event';
import { AddToCartForm, type PurchasableSku } from '@/modules/catalog/AddToCartForm';
import { CartView } from '@/modules/cart/CartView';
import type { CartLine } from '@/modules/cart/cart-slice';
import { renderWithProviders } from '../support/render';

const skus: PurchasableSku[] = [
  { id: 'sku-a', code: 'LAMP-S', label: 'Small', priceMinor: 1999, priceFormatted: '$19.99', available: 0 },
  { id: 'sku-b', code: 'LAMP-L', label: 'Large', priceMinor: 2999, priceFormatted: '$29.99', available: 4 },
];

const line = (overrides: Partial<CartLine> = {}): CartLine => ({
  skuId: 'sku-b',
  skuCode: 'LAMP-L',
  skuLabel: 'Large',
  productName: 'Desk lamp',
  productSlug: 'desk-lamp',
  unitPriceMinor: 2999,
  quantity: 2,
  ...overrides,
});

describe('AddToCartForm', () => {
  it('preselects the first available option and adds it with the seen price', async () => {
    const user = userEvent.setup();
    const { store } = renderWithProviders(<AddToCartForm productName="Desk lamp" productSlug="desk-lamp" skus={skus} />);
    expect(screen.getByRole('radio', { name: /Large/ })).toBeChecked();

    await user.clear(screen.getByLabelText('Quantity'));
    await user.type(screen.getByLabelText('Quantity'), '3');
    await user.click(screen.getByRole('button', { name: 'Add to cart' }));

    expect(store.getState().cart.lines).toEqual([line({ quantity: 3 })]);
    expect(screen.getByRole('link', { name: 'Go to cart' })).toHaveAttribute('href', '/cart');
  });

  it('merges repeated additions of the same option', async () => {
    const user = userEvent.setup();
    const { store } = renderWithProviders(<AddToCartForm productName="Desk lamp" productSlug="desk-lamp" skus={skus} />);
    await user.click(screen.getByRole('button', { name: 'Add to cart' }));
    await user.click(screen.getByRole('button', { name: 'Add to cart' }));
    expect(store.getState().cart.lines).toHaveLength(1);
    expect(store.getState().cart.lines[0]?.quantity).toBe(2);
  });

  it('rejects an invalid quantity with an accessible message', async () => {
    const user = userEvent.setup();
    const { store } = renderWithProviders(<AddToCartForm productName="Desk lamp" productSlug="desk-lamp" skus={skus} />);
    await user.clear(screen.getByLabelText('Quantity'));
    await user.type(screen.getByLabelText('Quantity'), '101');
    await user.click(screen.getByRole('button', { name: 'Add to cart' }));

    expect(screen.getByRole('alert')).toHaveTextContent('Enter a whole number from 1 to 100.');
    expect(screen.getByLabelText('Quantity')).toHaveAttribute('aria-invalid', 'true');
    expect(store.getState().cart.lines).toHaveLength(0);
  });
});

describe('CartView', () => {
  it('shows an empty state', () => {
    renderWithProviders(<CartView />);
    expect(screen.getByText(/Your cart is empty/)).toBeInTheDocument();
  });

  it('changes quantities and updates the estimated total', async () => {
    const user = userEvent.setup();
    const { store } = renderWithProviders(<CartView />, { preloadedState: { cart: { lines: [line()] } } });
    expect(screen.getByRole('row', { name: /Estimated total/ })).toHaveTextContent('$59.98');

    const quantity = screen.getByLabelText('Quantity of Desk lamp Large');
    await user.clear(quantity);
    await user.type(quantity, '5');
    expect(store.getState().cart.lines[0]?.quantity).toBe(5);
    expect(screen.getByRole('row', { name: /Estimated total/ })).toHaveTextContent('$149.95');
  });

  it('removes a line', async () => {
    const user = userEvent.setup();
    const { store } = renderWithProviders(<CartView />, {
      preloadedState: { cart: { lines: [line(), line({ skuId: 'sku-c', skuCode: 'CHAIR', skuLabel: 'Oak', productName: 'Chair' })] } },
    });
    const chairRow = screen.getByRole('row', { name: /Chair/ });
    await user.click(within(chairRow).getByRole('button', { name: /Remove/ }));
    expect(store.getState().cart.lines.map((l) => l.skuId)).toEqual(['sku-b']);
  });
});
