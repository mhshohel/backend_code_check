import { describe, expect, it } from '@jest/globals';
import { screen } from '@testing-library/react';
import userEvent from '@testing-library/user-event';
import { SearchFilters, type SearchFacetsData } from '@/modules/catalog/SearchFilters';
import { parseSearchState } from '@/modules/catalog/search-params';
import { routerCalls } from '../support/next-navigation';
import { renderWithProviders } from '../support/render';

const facets: SearchFacetsData = {
  categories: [
    { value: 'lighting', label: 'Lighting', count: 7, selected: false },
    { value: 'desks', label: 'Desks', count: 3, selected: false },
  ],
  priceRanges: [
    { value: '0-2500', label: 'Under $25', count: 4, selected: false },
    { value: '2500-5000', label: '$25 to $50', count: 6, selected: false },
  ],
  availability: [
    { value: 'in_stock', label: 'In stock', count: 9, selected: false },
    { value: 'out_of_stock', label: 'Out of stock', count: 1, selected: false },
  ],
};

function lastPush(): string | undefined {
  return routerCalls.filter((call) => call.method === 'push').at(-1)?.href;
}

describe('SearchFilters', () => {
  it('shows facet counts next to each option', () => {
    renderWithProviders(<SearchFilters state={parseSearchState({})} facets={facets} />);
    expect(screen.getByRole('checkbox', { name: /Lighting \(7\)/ })).toBeInTheDocument();
    expect(screen.getByRole('radio', { name: /\$25 to \$50 \(6\)/ })).toBeInTheDocument();
    expect(screen.getByRole('checkbox', { name: /In stock only \(9\)/ })).toBeInTheDocument();
  });

  it('adds a category to the URL and drops the page cursor', async () => {
    const user = userEvent.setup();
    renderWithProviders(<SearchFilters state={parseSearchState({ q: 'lamp', after: 'cursor-2' })} facets={facets} />);
    await user.click(screen.getByRole('checkbox', { name: /Lighting/ }));
    expect(lastPush()).toBe('/?q=lamp&category=lighting');
  });

  it('removes a selected category', async () => {
    const user = userEvent.setup();
    renderWithProviders(<SearchFilters state={parseSearchState({ category: ['lighting', 'desks'] })} facets={facets} />);
    expect(screen.getByRole('checkbox', { name: /Lighting/ })).toBeChecked();
    await user.click(screen.getByRole('checkbox', { name: /Lighting/ }));
    expect(lastPush()).toBe('/?category=desks');
  });

  it('applies price range, availability, and sort', async () => {
    const user = userEvent.setup();
    const { rerender } = renderWithProviders(<SearchFilters state={parseSearchState({})} facets={facets} />);
    await user.click(screen.getByRole('radio', { name: /\$25 to \$50/ }));
    expect(lastPush()).toBe('/?price=2500-5000');

    rerender(<SearchFilters state={parseSearchState({ price: '2500-5000' })} facets={facets} />);
    await user.click(screen.getByRole('checkbox', { name: /In stock only/ }));
    expect(lastPush()).toBe('/?price=2500-5000&stock=in_stock');

    await user.selectOptions(screen.getByLabelText('Sort by'), 'PRICE_DESC');
    expect(lastPush()).toBe('/?price=2500-5000&sort=PRICE_DESC');
  });

  it('keeps working without facets when search is unavailable', () => {
    renderWithProviders(<SearchFilters state={parseSearchState({ stock: 'in_stock' })} facets={null} />);
    expect(screen.getByRole('checkbox', { name: 'In stock only' })).toBeChecked();
    expect(screen.queryByRole('checkbox', { name: /Lighting/ })).not.toBeInTheDocument();
  });
});
