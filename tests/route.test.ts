import { describe, expect, test, vi } from "vitest";

import { createPineconeSearchRouteHandler } from "../src/route";

describe("createPineconeSearchRouteHandler", () => {
  test("returns 400 when search or query is missing", async () => {
    const service = {
      search: vi.fn()
    };
    const handler = createPineconeSearchRouteHandler(service as any);

    const response = await handler(
      new Request("http://localhost/api/pinecone-search", {
        method: "POST",
        headers: { "content-type": "application/json" },
        body: JSON.stringify({ search: "blog" })
      })
    );

    expect(response.status).toBe(400);
    await expect(response.json()).resolves.toEqual({
      error: "Both `search` and `query` are required"
    });
    expect(service.search).not.toHaveBeenCalled();
  });

  test("invokes service search and returns results", async () => {
    const service = {
      search: vi.fn().mockResolvedValue({
        query: "pinecone",
        search: "blog",
        results: [
          {
            id: "id-1",
            score: 0.9,
            rrfScore: 0.9,
            searchName: "blog",
            namespace: "nps-blog",
            sourcePath: "content/blog/hello.mdx",
            urlPath: "/blog/hello",
            chunkIndex: 0,
            snippet: "hello"
          }
        ]
      })
    };
    const handler = createPineconeSearchRouteHandler(service as any);

    const response = await handler(
      new Request("http://localhost/api/pinecone-search", {
        method: "POST",
        headers: { "content-type": "application/json" },
        body: JSON.stringify({
          search: "blog",
          query: "pinecone",
          topK: 7,
          rerankTopN: 5
        })
      })
    );

    expect(response.status).toBe(200);
    expect(service.search).toHaveBeenCalledWith("blog", "pinecone", {
      topK: 7,
      rerankTopN: 5
    });

    const payload = await response.json();
    expect(payload.results).toHaveLength(1);
    expect(payload.results[0].id).toBe("id-1");
  });

  test("returns 500 when service throws", async () => {
    const service = {
      search: vi.fn().mockRejectedValue(new Error("boom"))
    };
    const handler = createPineconeSearchRouteHandler(service as any);

    const response = await handler(
      new Request("http://localhost/api/pinecone-search", {
        method: "POST",
        headers: { "content-type": "application/json" },
        body: JSON.stringify({ search: "blog", query: "pinecone" })
      })
    );

    expect(response.status).toBe(500);
    await expect(response.json()).resolves.toEqual({ error: "boom" });
  });
});
