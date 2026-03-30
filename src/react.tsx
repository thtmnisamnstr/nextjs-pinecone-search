import React, { useCallback, useEffect, useMemo, useRef, useState } from "react";

import type { SearchResult } from "./types";

interface UsePineconeSearchOptions {
  search: string;
  endpoint?: string;
  initialQuery?: string;
  debounceMs?: number;
  topK?: number;
  rerankTopN?: number;
  autoSearch?: boolean;
}

interface UsePineconeSearchState {
  query: string;
  setQuery: React.Dispatch<React.SetStateAction<string>>;
  results: SearchResult[];
  isLoading: boolean;
  error?: string;
  runSearch: (queryOverride?: string) => Promise<void>;
  clear: () => void;
}

interface SearchApiResponse {
  results?: SearchResult[];
  error?: string;
}

export function usePineconeSearch(options: UsePineconeSearchOptions): UsePineconeSearchState {
  const endpoint = options.endpoint ?? "/api/pinecone-search";
  const debounceMs = options.debounceMs ?? 180;

  const [query, setQuery] = useState(options.initialQuery ?? "");
  const [results, setResults] = useState<SearchResult[]>([]);
  const [isLoading, setIsLoading] = useState(false);
  const [error, setError] = useState<string | undefined>(undefined);
  const requestCounterRef = useRef(0);
  const abortControllerRef = useRef<AbortController | null>(null);

  const requestPayload = useMemo(
    () => ({
      search: options.search,
      topK: options.topK,
      rerankTopN: options.rerankTopN
    }),
    [options.rerankTopN, options.search, options.topK]
  );

  const runSearch = useCallback(
    async (queryOverride?: string) => {
      const queryText = (queryOverride ?? query).trim();

      if (!queryText) {
        abortControllerRef.current?.abort();
        abortControllerRef.current = null;
        setIsLoading(false);
        setResults([]);
        setError(undefined);
        return;
      }

      requestCounterRef.current += 1;
      const requestId = requestCounterRef.current;

      abortControllerRef.current?.abort();
      const controller = new AbortController();
      abortControllerRef.current = controller;

      setIsLoading(true);
      setError(undefined);

      try {
        const response = await fetch(endpoint, {
          method: "POST",
          signal: controller.signal,
          headers: {
            "content-type": "application/json"
          },
          body: JSON.stringify({
            ...requestPayload,
            query: queryText
          })
        });

        const data = (await response.json()) as SearchApiResponse;

        if (!response.ok) {
          throw new Error(data.error ?? `Search failed with status ${response.status}`);
        }

        if (requestId !== requestCounterRef.current) {
          return;
        }
        setResults(data.results ?? []);
      } catch (requestError) {
        if (requestError instanceof Error && requestError.name === "AbortError") {
          return;
        }
        if (requestId !== requestCounterRef.current) {
          return;
        }
        setError(requestError instanceof Error ? requestError.message : "Unknown search error");
      } finally {
        if (requestId === requestCounterRef.current) {
          setIsLoading(false);
        }
      }
    },
    [endpoint, query, requestPayload]
  );

  const clear = useCallback(() => {
    requestCounterRef.current += 1;
    abortControllerRef.current?.abort();
    abortControllerRef.current = null;
    setQuery("");
    setIsLoading(false);
    setResults([]);
    setError(undefined);
  }, []);

  useEffect(() => {
    return () => {
      abortControllerRef.current?.abort();
      abortControllerRef.current = null;
    };
  }, []);

  useEffect(() => {
    if (!options.autoSearch) {
      return;
    }

    const timeout = setTimeout(() => {
      void runSearch();
    }, debounceMs);

    return () => clearTimeout(timeout);
  }, [debounceMs, options.autoSearch, query, runSearch]);

  return {
    query,
    setQuery,
    results,
    isLoading,
    error,
    runSearch,
    clear
  };
}

interface PineconeSearchInputProps extends UsePineconeSearchOptions {
  className?: string;
  placeholder?: string;
  submitLabel?: string;
  renderResult?: (result: SearchResult) => React.ReactNode;
}

export function PineconeSearchInput(props: PineconeSearchInputProps): React.ReactElement {
  const search = usePineconeSearch({
    ...props,
    autoSearch: props.autoSearch ?? true
  });

  return (
    <div className={props.className}>
      <form
        onSubmit={(event) => {
          event.preventDefault();
          void search.runSearch();
        }}
      >
        <input
          value={search.query}
          onChange={(event) => search.setQuery(event.target.value)}
          placeholder={props.placeholder ?? "Search..."}
          aria-label="Search query"
        />
        <button type="submit">{props.submitLabel ?? "Search"}</button>
      </form>

      {search.isLoading ? <p>Searching...</p> : null}
      {search.error ? <p role="alert">{search.error}</p> : null}

      <ul>
        {search.results.map((result) => (
          <li key={result.id}>
            {props.renderResult ? (
              props.renderResult(result)
            ) : (
              <a href={result.url ?? result.urlPath}>
                {result.title ?? result.urlPath} ({result.score.toFixed(3)})
              </a>
            )}
          </li>
        ))}
      </ul>
    </div>
  );
}
