'use client';

import { useEffect, useId, useState, useTransition, type FormEvent, type KeyboardEvent } from 'react';
import { useRouter } from 'next/navigation';
import { useQuery } from 'urql';
import { ProductSuggestionsDocument } from '@ofl/graphql-types';
import { toQueryString, withFilterChange, type CatalogSearchState } from './search-params';

const MIN_PREFIX_LENGTH = 2;
const DEBOUNCE_MS = 200;
const SUGGESTION_LIMIT = 6;

function useDebounced(value: string, delayMs: number): string {
  const [debounced, setDebounced] = useState(value);
  useEffect(() => {
    const timer = setTimeout(() => setDebounced(value), delayMs);
    return () => clearTimeout(timer);
  }, [value, delayMs]);
  return debounced;
}

/** Text search with an ARIA 1.2 combobox for autocomplete suggestions. */
export function SearchBox({ state, basePath = '/' }: { readonly state: CatalogSearchState; readonly basePath?: string }) {
  const router = useRouter();
  const [isPending, startTransition] = useTransition();
  const [text, setText] = useState(state.text);
  const [open, setOpen] = useState(false);
  const [activeIndex, setActiveIndex] = useState(-1);
  const inputId = useId();
  const listId = useId();
  const prefix = useDebounced(text.trim(), DEBOUNCE_MS);

  const [{ data }] = useQuery({
    query: ProductSuggestionsDocument,
    variables: { prefix, limit: SUGGESTION_LIMIT },
    pause: prefix.length < MIN_PREFIX_LENGTH,
  });
  const suggestions = prefix.length >= MIN_PREFIX_LENGTH ? (data?.productSuggestions ?? []) : [];
  const expanded = open && suggestions.length > 0;

  function submitSearch(event: FormEvent<HTMLFormElement>): void {
    event.preventDefault();
    setOpen(false);
    startTransition(() => router.push(`${basePath}${toQueryString(withFilterChange(state, { text: text.trim() }))}`));
  }

  function openProduct(slug: string): void {
    setOpen(false);
    router.push(`/products/${encodeURIComponent(slug)}`);
  }

  function onKeyDown(event: KeyboardEvent<HTMLInputElement>): void {
    if (event.key === 'ArrowDown' && suggestions.length > 0) {
      event.preventDefault();
      setOpen(true);
      setActiveIndex((index) => (index + 1) % suggestions.length);
    } else if (event.key === 'ArrowUp' && suggestions.length > 0) {
      event.preventDefault();
      setActiveIndex((index) => (index <= 0 ? suggestions.length - 1 : index - 1));
    } else if (event.key === 'Enter' && expanded && activeIndex >= 0) {
      const suggestion = suggestions[activeIndex];
      if (suggestion) {
        event.preventDefault();
        openProduct(suggestion.slug);
      }
    } else if (event.key === 'Escape') {
      setOpen(false);
      setActiveIndex(-1);
    }
  }

  return (
    <form role="search" className="search-box" onSubmit={submitSearch} aria-busy={isPending}>
      <label htmlFor={inputId}>Search products</label>
      <div className="combobox">
        <input
          id={inputId}
          type="search"
          role="combobox"
          autoComplete="off"
          aria-autocomplete="list"
          aria-expanded={expanded}
          aria-controls={listId}
          aria-activedescendant={expanded && activeIndex >= 0 ? `${listId}-${activeIndex}` : undefined}
          value={text}
          maxLength={200}
          onChange={(event) => {
            setText(event.target.value);
            setOpen(true);
            setActiveIndex(-1);
          }}
          onKeyDown={onKeyDown}
          onBlur={() => setOpen(false)}
        />
        <ul id={listId} role="listbox" aria-label="Suggestions" hidden={!expanded} className="suggestions">
          {suggestions.map((suggestion, index) => (
            <li
              key={suggestion.productId}
              id={`${listId}-${index}`}
              role="option"
              aria-selected={index === activeIndex}
              // mousedown fires before the input's blur closes the list.
              onMouseDown={(event) => {
                event.preventDefault();
                openProduct(suggestion.slug);
              }}
            >
              {suggestion.name}
            </li>
          ))}
        </ul>
      </div>
      <button type="submit">Search</button>
    </form>
  );
}
