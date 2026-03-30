import { describe, expect, test } from "vitest";

import { __internal } from "../src/service";
import { countTextTokens } from "../src/chunking";

describe("hybrid merge", () => {
  test("dedupes and boosts docs found by dense and sparse", () => {
    const dense = [
      {
        _id: "id-1",
        _score: 0.9,
        fields: {
          searchName: "blog",
          namespace: "nps-blog",
          sourcePath: "content/a.mdx",
          urlPath: "/blog/a",
          chunk_text: "alpha"
        }
      },
      {
        _id: "id-2",
        _score: 0.8,
        fields: {
          searchName: "blog",
          namespace: "nps-blog",
          sourcePath: "content/b.mdx",
          urlPath: "/blog/b",
          chunk_text: "beta"
        }
      }
    ];

    const sparse = [
      {
        _id: "id-2",
        _score: 0.6,
        fields: {
          searchName: "blog",
          namespace: "nps-blog",
          sourcePath: "content/b.mdx",
          urlPath: "/blog/b",
          chunk_text: "beta"
        }
      },
      {
        _id: "id-3",
        _score: 0.5,
        fields: {
          searchName: "blog",
          namespace: "nps-blog",
          sourcePath: "content/c.mdx",
          urlPath: "/blog/c",
          chunk_text: "gamma"
        }
      }
    ];

    const merged = __internal.mergeHybridHits(dense, sparse, 60, "blog", "nps-blog");

    expect(merged.length).toBe(3);
    expect(merged[0]?.id).toBe("id-2");
    expect(merged[0]?.urlPath).toBe("/blog/b");
  });

  test("dedupes candidates by document key before rerank", () => {
    const deduped = __internal.dedupeCandidates([
      {
        id: "chunk-a1",
        rrfScore: 0.9,
        searchName: "blog",
        namespace: "nps-blog",
        sourcePath: "content/a.mdx",
        urlPath: "/blog/a",
        chunkIndex: 0,
        snippet: "alpha",
        rerankText: "alpha"
      },
      {
        id: "chunk-a2",
        rrfScore: 0.8,
        searchName: "blog",
        namespace: "nps-blog",
        sourcePath: "content/a.mdx",
        urlPath: "/blog/a",
        chunkIndex: 1,
        snippet: "alpha two",
        rerankText: "alpha two"
      },
      {
        id: "chunk-b1",
        rrfScore: 0.7,
        searchName: "blog",
        namespace: "nps-blog",
        sourcePath: "content/b.mdx",
        urlPath: "/blog/b",
        chunkIndex: 0,
        snippet: "beta",
        rerankText: "beta"
      }
    ]);

    expect(deduped.length).toBe(2);
    expect(deduped[0]?.id).toBe("chunk-a1");
    expect(deduped[1]?.id).toBe("chunk-b1");
  });

  test("builds rerank inputs within query+document pair token limit", () => {
    const query = Array.from({ length: 400 }, (_, idx) => `q${idx}`).join(" ");
    const candidates = [
      {
        id: "chunk-a1",
        rrfScore: 0.9,
        searchName: "blog",
        namespace: "nps-blog",
        sourcePath: "content/a.mdx",
        urlPath: "/blog/a",
        chunkIndex: 0,
        snippet: "alpha",
        rerankText: Array.from({ length: 700 }, (_, idx) => `d${idx}`).join(" ")
      }
    ];

    const inputs = __internal.buildRerankInputs(query, candidates);

    expect(inputs.length).toBe(1);
    const pairTokens = countTextTokens(query) + countTextTokens(inputs[0]!.rerankText);
    expect(pairTokens).toBeLessThanOrEqual(1024);
  });

  test("returns no rerank inputs when query token budget is exhausted", () => {
    const query = Array.from({ length: 2000 }, (_, idx) => `q${idx}`).join(" ");
    const candidates = [
      {
        id: "chunk-a1",
        rrfScore: 0.9,
        searchName: "blog",
        namespace: "nps-blog",
        sourcePath: "content/a.mdx",
        urlPath: "/blog/a",
        chunkIndex: 0,
        snippet: "alpha",
        rerankText: "alpha"
      }
    ];

    const inputs = __internal.buildRerankInputs(query, candidates);
    expect(inputs.length).toBe(0);
  });

  test("baseCandidateFromFields falls back to query context and parses chunkIndex", () => {
    const candidate = __internal.baseCandidateFromFields(
      "id-1",
      {
        chunk_text: "hello world",
        chunkIndex: "3"
      },
      "blog",
      "nps-blog"
    );

    expect(candidate.searchName).toBe("blog");
    expect(candidate.namespace).toBe("nps-blog");
    expect(candidate.chunkIndex).toBe(3);
    expect(candidate.rrfScore).toBe(0);
  });

  test("toNumber handles numeric strings and invalid values", () => {
    expect(__internal.toNumber(123)).toBe(123);
    expect(__internal.toNumber("456")).toBe(456);
    expect(__internal.toNumber("invalid")).toBeUndefined();
  });
});
