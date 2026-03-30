import { describe, expect, test, vi } from "vitest";

import {
  applyNamespacePrefix,
  chunkArray,
  isRetryableError,
  mapWithConcurrency,
  maybeJoinUrl,
  normalizeUrlPath,
  trimToTokenBudget,
  withRetry
} from "../src/utils";

describe("utils", () => {
  test("normalizeUrlPath normalizes separators and slashes", () => {
    expect(normalizeUrlPath("blog\\hello//")).toBe("/blog/hello");
  });

  test("applyNamespacePrefix avoids duplicate prefixes", () => {
    expect(applyNamespacePrefix("nps", "blog")).toBe("nps-blog");
    expect(applyNamespacePrefix("nps", "nps-blog")).toBe("nps-blog");
  });

  test("chunkArray splits arrays and validates chunk size", () => {
    expect(chunkArray([1, 2, 3, 4, 5], 2)).toEqual([
      [1, 2],
      [3, 4],
      [5]
    ]);
    expect(() => chunkArray([1], 0)).toThrow("chunkSize must be greater than 0");
  });

  test("mapWithConcurrency preserves result order", async () => {
    const results = await mapWithConcurrency([1, 2, 3, 4], 2, async (value) => {
      await new Promise((resolve) => setTimeout(resolve, 5 * (5 - value)));
      return value * 2;
    });

    expect(results).toEqual([2, 4, 6, 8]);
  });

  test("isRetryableError detects retryable status and messages", () => {
    const statusError = Object.assign(new Error("rate limited"), { status: 429 });

    expect(isRetryableError(statusError)).toBe(true);
    expect(isRetryableError(new Error("request timed out"))).toBe(true);
    expect(isRetryableError(new Error("bad request"))).toBe(false);
  });

  test("withRetry retries transient failures", async () => {
    let attempts = 0;
    const logger = {
      info: vi.fn(),
      warn: vi.fn(),
      error: vi.fn()
    };

    const value = await withRetry(
      async () => {
        attempts += 1;
        if (attempts < 3) {
          throw Object.assign(new Error("rate limited"), { status: 429 });
        }
        return "ok";
      },
      {
        retries: 4,
        initialDelayMs: 1,
        label: "test op",
        logger
      }
    );

    expect(value).toBe("ok");
    expect(attempts).toBe(3);
    expect(logger.warn).toHaveBeenCalledTimes(2);
  });

  test("maybeJoinUrl joins valid base URLs and rejects invalid ones", () => {
    expect(maybeJoinUrl("https://example.com", "/docs")).toBe("https://example.com/docs");
    expect(maybeJoinUrl("not-a-url", "/docs")).toBeUndefined();
  });

  test("trimToTokenBudget uses provided tokenizer to enforce budget", () => {
    const value = trimToTokenBudget("a bb ccc dddd", 6, (input) => input.length);
    expect(value).toBe("a bb");
  });
});
