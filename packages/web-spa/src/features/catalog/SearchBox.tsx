import { ProductSuggestionsDocument } from '@ofl/graphql-types';
import { useEffect, useId, useState, type FormEvent, type KeyboardEvent } from 'react';
import { useNavigate } from 'react-router';
import { useQuery } from 'urql';
import { Button } from '../../components';

const MIN_PREFIX = 2;
const DEBOUNCE_MS = 200;

function useDebounced(value: string, delayMs: number): string {
  const [debounced, setDebounced] = useState(value);
  useEffect(() => {
    const timer = setTimeout(() => setDebounced(value), delayMs);
    return () => clearTimeout(timer);
  }, [value, delayMs]);
  return debounced;
}

type SearchBoxProps = { initialText: string; onSearch: (text: string) => void };

/** Text search with an ARIA combobox for autocomplete (Query.productSuggestions). */
export function SearchBox({ initialText, onSearch }: SearchBoxProps) {
  const [text, setText] = useState(initialText);
  const [open, setOpen] = useState(false);
  const [activeIndex, setActiveIndex] = useState(-1);
  const navigate = useNavigate();
  const listId = useId();
  const inputId = useId();
  const prefix = useDebounced(text.trim(), DEBOUNCE_MS);

  useEffect(() => setText(initialText), [initialText]);

  const [{ data }] = useQuery({
    query: ProductSuggestionsDocument,
    variables: { prefix, limit: 5 },
    pause: prefix.length < MIN_PREFIX,
  });
  const suggestions = prefix.length >= MIN_PREFIX ? (data?.productSuggestions ?? []) : [];
  const expanded = open && suggestions.length > 0;

  function submit(event: FormEvent<HTMLFormElement>) {
    event.preventDefault();
    setOpen(false);
    onSearch(text);
  }

  function choose(index: number) {
    const suggestion = suggestions[index];
    if (!suggestion) return;
    setOpen(false);
    navigate(`/products/${encodeURIComponent(suggestion.slug)}`);
  }

  function handleKeyDown(event: KeyboardEvent<HTMLInputElement>) {
    if (event.key === 'ArrowDown') {
      event.preventDefault();
      setOpen(true);
      setActiveIndex((i) => Math.min(suggestions.length - 1, i + 1));
    } else if (event.key === 'ArrowUp') {
      event.preventDefault();
      setActiveIndex((i) => Math.max(-1, i - 1));
    } else if (event.key === 'Escape') {
      setOpen(false);
      setActiveIndex(-1);
    } else if (event.key === 'Enter' && expanded && activeIndex >= 0) {
      event.preventDefault();
      choose(activeIndex);
    }
  }

  return (
    <form role="search" className="search-box" onSubmit={submit}>
      <label htmlFor={inputId}>Search products</label>
      <div className="combobox">
        <input
          id={inputId}
          type="search"
          role="combobox"
          aria-autocomplete="list"
          aria-expanded={expanded}
          aria-controls={listId}
          aria-activedescendant={expanded && activeIndex >= 0 ? `${listId}-${activeIndex}` : undefined}
          autoComplete="off"
          value={text}
          onChange={(e) => {
            setText(e.target.value);
            setOpen(true);
            setActiveIndex(-1);
          }}
          onKeyDown={handleKeyDown}
          onBlur={() => setOpen(false)}
        />
        <ul id={listId} role="listbox" className="suggestions" hidden={!expanded} aria-label="Suggestions">
          {suggestions.map((suggestion, index) => (
            <li
              key={suggestion.productId}
              id={`${listId}-${index}`}
              role="option"
              aria-selected={index === activeIndex}
              onMouseDown={(e) => {
                e.preventDefault();
                choose(index);
              }}
            >
              {suggestion.name}
            </li>
          ))}
        </ul>
      </div>
      <Button type="submit" variant="primary">
        Search
      </Button>
    </form>
  );
}
