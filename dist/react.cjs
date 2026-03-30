"use strict";
var __defProp = Object.defineProperty;
var __getOwnPropDesc = Object.getOwnPropertyDescriptor;
var __getOwnPropNames = Object.getOwnPropertyNames;
var __hasOwnProp = Object.prototype.hasOwnProperty;
var __export = (target, all) => {
  for (var name in all)
    __defProp(target, name, { get: all[name], enumerable: true });
};
var __copyProps = (to, from, except, desc) => {
  if (from && typeof from === "object" || typeof from === "function") {
    for (let key of __getOwnPropNames(from))
      if (!__hasOwnProp.call(to, key) && key !== except)
        __defProp(to, key, { get: () => from[key], enumerable: !(desc = __getOwnPropDesc(from, key)) || desc.enumerable });
  }
  return to;
};
var __toCommonJS = (mod) => __copyProps(__defProp({}, "__esModule", { value: true }), mod);

// src/react.tsx
var react_exports = {};
__export(react_exports, {
  PineconeSearchInput: () => PineconeSearchInput,
  usePineconeSearch: () => usePineconeSearch
});
module.exports = __toCommonJS(react_exports);
var import_react = require("react");
var import_jsx_runtime = require("react/jsx-runtime");
function usePineconeSearch(options) {
  const endpoint = options.endpoint ?? "/api/pinecone-search";
  const debounceMs = options.debounceMs ?? 180;
  const [query, setQuery] = (0, import_react.useState)(options.initialQuery ?? "");
  const [results, setResults] = (0, import_react.useState)([]);
  const [isLoading, setIsLoading] = (0, import_react.useState)(false);
  const [error, setError] = (0, import_react.useState)(void 0);
  const requestCounterRef = (0, import_react.useRef)(0);
  const abortControllerRef = (0, import_react.useRef)(null);
  const requestPayload = (0, import_react.useMemo)(
    () => ({
      search: options.search,
      topK: options.topK,
      rerankTopN: options.rerankTopN
    }),
    [options.rerankTopN, options.search, options.topK]
  );
  const runSearch = (0, import_react.useCallback)(
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
  const clear = (0, import_react.useCallback)(() => {
    requestCounterRef.current += 1;
    abortControllerRef.current?.abort();
    abortControllerRef.current = null;
    setQuery("");
    setIsLoading(false);
    setResults([]);
    setError(void 0);
  }, []);
  (0, import_react.useEffect)(() => {
    return () => {
      abortControllerRef.current?.abort();
      abortControllerRef.current = null;
    };
  }, []);
  (0, import_react.useEffect)(() => {
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
  return /* @__PURE__ */ (0, import_jsx_runtime.jsxs)("div", { className: props.className, children: [
    /* @__PURE__ */ (0, import_jsx_runtime.jsxs)(
      "form",
      {
        onSubmit: (event) => {
          event.preventDefault();
          void search.runSearch();
        },
        children: [
          /* @__PURE__ */ (0, import_jsx_runtime.jsx)(
            "input",
            {
              value: search.query,
              onChange: (event) => search.setQuery(event.target.value),
              placeholder: props.placeholder ?? "Search...",
              "aria-label": "Search query"
            }
          ),
          /* @__PURE__ */ (0, import_jsx_runtime.jsx)("button", { type: "submit", children: props.submitLabel ?? "Search" })
        ]
      }
    ),
    search.isLoading ? /* @__PURE__ */ (0, import_jsx_runtime.jsx)("p", { children: "Searching..." }) : null,
    search.error ? /* @__PURE__ */ (0, import_jsx_runtime.jsx)("p", { role: "alert", children: search.error }) : null,
    /* @__PURE__ */ (0, import_jsx_runtime.jsx)("ul", { children: search.results.map((result) => /* @__PURE__ */ (0, import_jsx_runtime.jsx)("li", { children: props.renderResult ? props.renderResult(result) : /* @__PURE__ */ (0, import_jsx_runtime.jsxs)("a", { href: result.url ?? result.urlPath, children: [
      result.title ?? result.urlPath,
      " (",
      result.score.toFixed(3),
      ")"
    ] }) }, result.id)) })
  ] });
}
// Annotate the CommonJS export names for ESM import in node:
0 && (module.exports = {
  PineconeSearchInput,
  usePineconeSearch
});
//# sourceMappingURL=react.cjs.map