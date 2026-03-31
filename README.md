# nextjs-pinecone-search

Plug-and-play Pinecone hybrid search for Next.js.

## 5-Minute Setup

### 1) Create a Pinecone account + API key

- Sign up in Pinecone.
- Create an API key.
- Keep it for your `.env.local`.

### 2) Install

```bash
npm install nextjs-pinecone-search
```

### 3) Add environment variables

In `.env.local`:

```bash
PINECONE_API_KEY=your_api_key_here
PINECONE_DENSE_INDEX=my-site-dense
PINECONE_SPARSE_INDEX=my-site-sparse
```

You only provide index names. If those indexes do not exist yet, this package can create compatible integrated indexes for you.

### 4) Add `pinecone.search.config.ts`

```ts
import { definePineconeSearches } from "nextjs-pinecone-search";

export default definePineconeSearches({
  siteUrl: "https://example.com",
  namespacePrefix: "my-site",
  searches: {
    blog: {
      namespace: "blog",
      sources: [{ include: ["content/blog/**/*.{md,mdx}"], routePrefix: "/blog" }]
    }
  }
});
```

### 5) Wrap `next.config` (always-on or conditional)

If you want auto-reindex on every local `next dev` and build, wrap unconditionally:

```ts
import { withPineconeSearch } from "nextjs-pinecone-search";

const nextConfig = {
  reactStrictMode: true
};

export default withPineconeSearch(nextConfig);
```

If you only want reindexing in specific environments (e.g., production deploys), gate it:

```js
const { withPineconeSearch } = require("nextjs-pinecone-search");

const nextConfig = {
  reactStrictMode: true
};

const isNetlifyProductionDeploy =
  process.env.NETLIFY === "true" && process.env.CONTEXT === "production";

module.exports = isNetlifyProductionDeploy ? withPineconeSearch(nextConfig) : nextConfig;
```

#### Optional: Manual Reindex Script

Useful when you do not enable `withPineconeSearch` for every environment.

`scripts/reindex-pinecone.mjs`:

```js
import nextEnv from "@next/env";
import { createPineconeSearchService, loadPineconeSearchConfig } from "nextjs-pinecone-search";

const cwd = process.cwd();
const { loadEnvConfig } = nextEnv;
loadEnvConfig(cwd);

const config = await loadPineconeSearchConfig({ cwd });
const service = createPineconeSearchService({ config, cwd });

await service.reindexAll();
console.log("[nextjs-pinecone-search] manual reindex complete");
```

`package.json`:

```json
{
  "scripts": {
    "reindex": "node ./scripts/reindex-pinecone.mjs"
  }
}
```

### 6) Add the search API route

Pages Router (`pages/api/pinecone-search.ts`):

```ts
import type { NextApiRequest, NextApiResponse } from "next";
import { createPineconeSearchService } from "nextjs-pinecone-search";

import pineconeSearchConfig from "../../pinecone.search.config";

export const config = {
  api: {
    bodyParser: true
  }
};

const service = createPineconeSearchService({ config: pineconeSearchConfig });

export default async function handler(req: NextApiRequest, res: NextApiResponse) {
  if (req.method !== "POST") {
    res.setHeader("Allow", "POST");
    return res.status(405).json({ error: "Method not allowed" });
  }

  const { search, query, topK } = req.body ?? {};

  if (typeof search !== "string" || typeof query !== "string") {
    return res.status(400).json({ error: "Expected body: { search, query, topK? }" });
  }

  try {
    const topKNumber = typeof topK === "number" ? topK : undefined;
    const result = await service.search(search, query, { topK: topKNumber });
    return res.status(200).json(result);
  } catch (error) {
    return res.status(500).json({ error: error instanceof Error ? error.message : "Search failed" });
  }
}
```

App Router alternative (`app/api/pinecone-search/route.ts`):

```ts
import {
  createPineconeSearchRouteHandler,
  createPineconeSearchService
} from "nextjs-pinecone-search";

import config from "../../../pinecone.search.config";

const service = createPineconeSearchService({ config });

export const POST = createPineconeSearchRouteHandler(service);
```

### 7) Query it from your client

```ts
let response = await fetch("/api/pinecone-search", {
  method: "POST",
  headers: { "content-type": "application/json" },
  body: JSON.stringify({ search: "blog", query: "how namespaces work", topK: 10 })
});

let data = await response.json();
console.log(data.results);
```

`rerankTopN` is optional. You can add it to your request body and pass it through in your API handler when needed.

Run:

```bash
# If reindexing only in specific environments (e.g., production deploys), reindex first
npm run reindex

npm run dev
```

## What This Package Handles For You

- Document discovery via globs (`md`/`mdx`)
- Paragraph-aware chunking with overlap
- Auto reindexing
- Namespace management and rebuild safety
- Dense + sparse retrieval
- RRF merge + rerank

## Search Result Shape

Results include:

- `id`
- `score`, `rrfScore`, `denseScore`, `sparseScore`
- `title`, `urlPath`, `url`
- `sourcePath`, `chunkIndex`, `snippet`

## Common Options

`definePineconeSearches({...})` supports:

- `namespacePrefix`: default `"nps"`
- `rebuildScope`: `"managed"` (default) or `"all"`
- `failOnReindexError`: default `true`
- `resolveUrl`: custom URL resolver per document

## Troubleshooting

### Reindex runs but results are empty

- Check your `include` globs match real files.
- Ensure matched files have non-empty body content.
- Ensure you are querying the correct `search` name.

### Model mismatch errors from Pinecone

Your existing indexes were created with incompatible integrated models. Use dedicated index names for this package or point env vars to compatible indexes.

### `400` response says search/query required

Request body must include both fields:

```json
{ "search": "blog", "query": "your text" }
```

## Learn More

- Beginner concepts: [Search Primer](./docs/SEARCH_PRIMER.md)

## Requirements

- Node.js `>= 18.17`
- Next.js `>= 14.2`
- React `>= 18.2`
- Pinecone
