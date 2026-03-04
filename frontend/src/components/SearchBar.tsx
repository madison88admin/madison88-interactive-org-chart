import { useEffect, useRef, useState } from "react";

interface SearchSuggestion {
  id: string;
  label: string;
}

interface SearchBarProps {
  query: string;
  suggestions: SearchSuggestion[];
  onChange: (value: string) => void;
  onClear: () => void;
  onSelectSuggestion: (id: string) => void;
}

export function SearchBar({ query, suggestions, onChange, onClear, onSelectSuggestion }: SearchBarProps) {
  const [isFocused, setIsFocused] = useState(false);
  const blurTimeoutRef = useRef<number | null>(null);

  useEffect(() => {
    return () => {
      if (blurTimeoutRef.current) {
        window.clearTimeout(blurTimeoutRef.current);
      }
    };
  }, []);

  return (
    <div className="search-wrap">
      <label htmlFor="global-search" className="sr-only">
        Search employees
      </label>
      <p className="search-label">Quick Search</p>
      <input
        id="global-search"
        value={query}
        onChange={(event) => onChange(event.target.value)}
        onFocus={() => {
          if (blurTimeoutRef.current) {
            window.clearTimeout(blurTimeoutRef.current);
          }
          setIsFocused(true);
        }}
        onBlur={() => {
          blurTimeoutRef.current = window.setTimeout(() => setIsFocused(false), 150);
        }}
        placeholder="Search name, title, department"
        className="search-input"
        autoComplete="off"
      />
      <div className="search-actions">
        <span>Press F to focus</span>
        {query && (
          <button type="button" className="ghost-btn" onClick={onClear}>
            Clear
          </button>
        )}
      </div>
      {isFocused && query && suggestions.length > 0 && (
        <ul className="search-suggestions" role="listbox" aria-label="Search suggestions">
          {suggestions.map((item) => (
            <li key={item.id}>
              <button type="button" onClick={() => onSelectSuggestion(item.id)}>
                {item.label}
              </button>
            </li>
          ))}
        </ul>
      )}
    </div>
  );
}
