import { describe, expect, it } from '@jest/globals';
import { screen, waitFor } from '@testing-library/react';
import userEvent from '@testing-library/user-event';
import { parsePriceRange, toSearchInput, parseCatalogParams } from '../src/features/catalog/catalogParams';
import { searchResult } from './fixtures';
import { renderApp } from './test-utils';

function lastSearchVariables(app: ReturnType<typeof renderApp>) {
  const calls = app.mock.calls('SearchProducts');
  return calls[calls.length - 1];
}

describe('catalog search', () => {
  it('maps URL parameters to SearchProducts variables', () => {
    const params = new URLSearchParams('q=mug&category=kitchen&category=outdoor&price=2500-5000&availability=in_stock&sort=PRICE_ASC');
    expect(toSearchInput(parseCatalogParams(params))).toEqual({
      text: 'mug',
      categorySlugs: ['kitchen', 'outdoor'],
      inStockOnly: true,
      sort: 'PRICE_ASC',
      minPriceMinor: 2500,
      maxPriceMinor: 5000,
    });
    expect(parsePriceRange('25000-')).toEqual({ minPriceMinor: 25000 });
    expect(parsePriceRange('garbage')).toEqual({});
  });

  it('renders results with facet counts from the URL state', async () => {
    const app = renderApp({ path: '/?q=mug', handlers: { SearchProducts: () => ({ data: searchResult() }) } });
    expect(await screen.findByRole('link', { name: 'Trail Mug' })).toBeInTheDocument();
    expect(screen.getByText('2 products found')).toBeInTheDocument();
    expect(screen.getByRole('checkbox', { name: /Outdoor/ })).toBeInTheDocument();
    expect(screen.getByLabelText('5 results')).toBeInTheDocument();
    expect(lastSearchVariables(app)).toEqual({ input: { sort: 'RELEVANCE', text: 'mug' }, first: 20, after: null });
  });

  it('updates the URL and the query variables when filters change', async () => {
    const user = userEvent.setup();
    const app = renderApp({ path: '/', handlers: { SearchProducts: () => ({ data: searchResult() }) } });

    await user.click(await screen.findByRole('checkbox', { name: /Kitchen/ }));
    await waitFor(() => expect(app.router.state.location.search).toBe('?category=kitchen'));
    expect(lastSearchVariables(app)).toMatchObject({ input: { categorySlugs: ['kitchen'] } });

    await user.click(screen.getByRole('radio', { name: /Under \$25/ }));
    await waitFor(() => expect(app.router.state.location.search).toBe('?category=kitchen&price=0-2500'));
    expect(lastSearchVariables(app)).toMatchObject({ input: { categorySlugs: ['kitchen'], minPriceMinor: 0, maxPriceMinor: 2500 } });

    await user.click(screen.getByRole('checkbox', { name: /In stock/ }));
    await user.selectOptions(screen.getByLabelText('Sort by'), 'PRICE_DESC');
    await waitFor(() => expect(lastSearchVariables(app)).toMatchObject({ input: { inStockOnly: true, sort: 'PRICE_DESC' } }));
    expect(new URLSearchParams(app.router.state.location.search).get('sort')).toBe('PRICE_DESC');

    await user.type(screen.getByRole('combobox', { name: 'Search products' }), 'kettle{Enter}');
    await waitFor(() => expect(lastSearchVariables(app)).toMatchObject({ input: { text: 'kettle' } }));
    expect(new URLSearchParams(app.router.state.location.search).get('q')).toBe('kettle');
  });

  it('keeps "Load more" cursors in the URL and resets them when a filter changes', async () => {
    const user = userEvent.setup();
    const app = renderApp({
      path: '/',
      handlers: {
        SearchProducts: (variables) =>
          variables.after === 'cursor-2' ? { data: searchResult(['Page Two Item']) } : { data: searchResult(['Trail Mug'], true) },
      },
    });

    await user.click(await screen.findByRole('button', { name: 'Load more products' }));
    expect(await screen.findByRole('link', { name: 'Page Two Item' })).toBeInTheDocument();
    expect(app.router.state.location.search).toBe('?after=cursor-2');
    expect(screen.getByRole('link', { name: 'Trail Mug' })).toBeInTheDocument();

    await user.click(screen.getByRole('checkbox', { name: /Outdoor/ }));
    await waitFor(() => expect(app.router.state.location.search).toBe('?category=outdoor'));
  });

  it('shows suggestions and opens the chosen product with the keyboard', async () => {
    const user = userEvent.setup();
    const app = renderApp({
      path: '/',
      handlers: {
        SearchProducts: () => ({ data: searchResult() }),
        ProductSuggestions: () => ({ data: { productSuggestions: [{ productId: 'p-1', slug: 'trail-mug', name: 'Trail Mug' }] } }),
      },
    });
    const box = await screen.findByRole('combobox', { name: 'Search products' });
    await user.type(box, 'tr');
    expect(await screen.findByRole('option', { name: 'Trail Mug' })).toBeInTheDocument();
    expect(app.mock.calls('ProductSuggestions')).toContainEqual({ prefix: 'tr', limit: 5 });
    await user.keyboard('{ArrowDown}{Enter}');
    await waitFor(() => expect(app.router.state.location.pathname).toBe('/products/trail-mug'));
  });

  it('explains when search is unavailable', async () => {
    const { CombinedError } = await import('urql');
    renderApp({
      path: '/',
      handlers: {
        SearchProducts: () => ({
          error: new CombinedError({ graphQLErrors: [{ message: 'down', extensions: { code: 'SEARCH_UNAVAILABLE' } }] }),
        }),
      },
    });
    expect(await screen.findByRole('alert')).toHaveTextContent('Search is temporarily unavailable');
  });
});
