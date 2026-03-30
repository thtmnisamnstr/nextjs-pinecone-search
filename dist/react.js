// src/react.tsx
import { useCallback, useEffect, useMemo, useRef, useState } from "react";
import { jsx, jsxs } from "react/jsx-runtime";
function usePineconeSearch(options) {
  const endpoint = options.endpoint ?? "/api/pinecone-search";
  const debounceMs = options.debounceMs ?? 180;
  const [query, setQuery] = useState(options.initialQuery ?? "");
  const [results, setResults] = useState([]);
  const [isLoading, setIsLoading] = useState(false);
  const [error, setError] = useState(void 0);
  const requestCounterRef = useRef(0);
  const abortControllerRef = useRef(null);
  const requestPayload = useMemo(
    () => ({
      search: options.search,
      topK: options.topK,
      rerankTopN: options.rerankTopN
    }),
    [options.rerankTopN, options.search, options.topK]
  );
  const runSearch = useCallback(
    async (queryOverride) => {
      const queryText = (queryOverride ?? query).trim();
      if (!queryText) {
        abortControllerRef.current?.abort();
        abortControllerRef.current = null;
        setIsLoading(false);
        setResults([]);
        setError(void 0);
        return;
      }
      requestCounterRef.current += 1;
      const requestId = requestCounterRef.current;
      abortControllerRef.current?.abort();
      const controller = new AbortController();
      abortControllerRef.current = controller;
      setIsLoading(true);
      setError(void 0);
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
        const data = await response.json();
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
    setError(void 0);
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
function PineconeSearchInput(props) {
  const search = usePineconeSearch({
    ...props,
    autoSearch: props.autoSearch ?? true
  });
  return /* @__PURE__ */ jsxs("div", { className: props.className, children: [
    /* @__PURE__ */ jsxs(
      "form",
      {
        onSubmit: (event) => {
          event.preventDefault();
          void search.runSearch();
        },
        children: [
          /* @__PURE__ */ jsx(
            "input",
            {
              value: search.query,
              onChange: (event) => search.setQuery(event.target.value),
              placeholder: props.placeholder ?? "Search...",
              "aria-label": "Search query"
            }
          ),
          /* @__PURE__ */ jsx("button", { type: "submit", children: props.submitLabel ?? "Search" })
        ]
      }
    ),
    search.isLoading ? /* @__PURE__ */ jsx("p", { children: "Searching..." }) : null,
    search.error ? /* @__PURE__ */ jsx("p", { role: "alert", children: search.error }) : null,
    /* @__PURE__ */ jsx("ul", { children: search.results.map((result) => /* @__PURE__ */ jsx("li", { children: props.renderResult ? props.renderResult(result) : /* @__PURE__ */ jsxs("a", { href: result.url ?? result.urlPath, children: [
      result.title ?? result.urlPath,
      " (",
      result.score.toFixed(3),
      ")"
    ] }) }, result.id)) })
  ] });
}
export {
  PineconeSearchInput,
  usePineconeSearch
};
//# sourceMappingURL=react.js.map