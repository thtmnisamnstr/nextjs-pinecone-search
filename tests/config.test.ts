import fs from "node:fs/promises";
import os from "node:os";
import path from "node:path";

import { afterEach, describe, expect, test } from "vitest";

import {
  defaultResolveUrl,
  definePineconeSearches,
  loadPineconeSearchConfig,
  resolveUrlForDocument
} from "../src/config";

const createdDirs: string[] = [];

afterEach(async () => {
  delete process.env.PINECONE_SEARCH_CONFIG;
  await Promise.all(
    createdDirs.splice(0).map(async (dir) => {
      await fs.rm(dir, { recursive: true, force: true });
    })
  );
});

describe("config", () => {
  test("definePineconeSearches applies defaults", () => {
    const config = definePineconeSearches({
      searches: {
        blog: {
          namespace: "blog",
          sources: [
            {
              include: ["content/blog/**/*.mdx"]
            }
          ]
        }
      }
    });

    expect(config.rebuildScope).toBe("managed");
    expect(config.failOnReindexError).toBe(true);
    expect(config.namespacePrefix).toBe("nps");
  });

  test("defaultResolveUrl respects slug", () => {
    const resolved = defaultResolveUrl({
      filePath: "/repo/content/blog/hello-world.mdx",
      relativePath: "hello-world.mdx",
      searchName: "blog",
      frontmatter: {
        slug: "/posts/hello-world"
      },
      routePrefix: "/blog"
    });

    expect(resolved.urlPath).toBe("/posts/hello-world");
  });

  test("resolveUrlForDocument computes absolute url when siteUrl is configured", () => {
    const config = definePineconeSearches({
      siteUrl: "https://example.com",
      searches: {
        blog: {
          namespace: "blog",
          sources: [
            {
              include: ["content/blog/**/*.mdx"],
              routePrefix: "/blog"
            }
          ]
        }
      }
    });

    const resolved = resolveUrlForDocument(config, {
      filePath: "/repo/content/blog/hello-world.mdx",
      relativePath: "hello-world.mdx",
      searchName: "blog",
      frontmatter: {},
      routePrefix: "/blog"
    });

    expect(resolved.urlPath).toBe("/blog/hello-world");
    expect(resolved.url).toBe("https://example.com/blog/hello-world");
  });

  test("definePineconeSearches supports multiple include/routePrefix pairs", () => {
    const config = definePineconeSearches({
      searches: {
        global: {
          namespace: "global",
          sources: [
            { include: ["content/blog/**/*.mdx"], routePrefix: "/blog" },
            { include: ["content/authors/**/*.mdx"], routePrefix: "/authors" },
            { include: ["content/pages/**/*.mdx"], routePrefix: "/" }
          ]
        }
      }
    });

    expect(config.searches.global.sources).toHaveLength(3);
    expect(config.searches.global.sources[1]?.routePrefix).toBe("/authors");
  });

  test("defaultResolveUrl normalizes index files with routePrefix", () => {
    const resolved = defaultResolveUrl({
      filePath: "/repo/content/docs/getting-started/index.mdx",
      relativePath: "getting-started/index.mdx",
      searchName: "docs",
      frontmatter: {},
      routePrefix: "/docs"
    });

    expect(resolved.urlPath).toBe("/docs/getting-started");
  });

  test("resolveUrlForDocument throws when resolver does not return urlPath", () => {
    const config = definePineconeSearches({
      resolveUrl: () => ({ urlPath: "" }),
      searches: {
        docs: {
          namespace: "docs",
          sources: [{ include: ["docs/**/*.mdx"] }]
        }
      }
    });

    expect(() =>
      resolveUrlForDocument(config, {
        filePath: "/repo/docs/intro.mdx",
        relativePath: "intro.mdx",
        searchName: "docs",
        frontmatter: {}
      })
    ).toThrow("resolveUrl must return { urlPath }");
  });

  test("definePineconeSearches validates source include globs", () => {
    expect(() =>
      definePineconeSearches({
        searches: {
          docs: {
            namespace: "docs",
            sources: [{ include: [] }]
          }
        }
      })
    ).toThrow("must include at least one glob");
  });

  test("loadPineconeSearchConfig discovers default config from cwd", async () => {
    const tempDir = await fs.mkdtemp(path.join(os.tmpdir(), "nps-config-"));
    createdDirs.push(tempDir);

    await fs.writeFile(
      path.join(tempDir, "pinecone.search.config.mjs"),
      [
        "export default {",
        "  searches: {",
        "    docs: {",
        "      namespace: 'docs',",
        "      sources: [{ include: ['docs/**/*.mdx'] }]",
        "    }",
        "  }",
        "};"
      ].join("\n")
    );

    const config = await loadPineconeSearchConfig({ cwd: tempDir });
    expect(config.searches.docs.namespace).toBe("docs");
  });

  test("loadPineconeSearchConfig respects PINECONE_SEARCH_CONFIG env var", async () => {
    const tempDir = await fs.mkdtemp(path.join(os.tmpdir(), "nps-config-"));
    createdDirs.push(tempDir);

    await fs.writeFile(
      path.join(tempDir, "custom-search-config.mjs"),
      [
        "export default {",
        "  namespacePrefix: 'custom',",
        "  searches: {",
        "    blog: {",
        "      namespace: 'blog',",
        "      sources: [{ include: ['content/blog/**/*.mdx'] }]",
        "    }",
        "  }",
        "};"
      ].join("\n")
    );

    process.env.PINECONE_SEARCH_CONFIG = "custom-search-config.mjs";
    const config = await loadPineconeSearchConfig({ cwd: tempDir });

    expect(config.namespacePrefix).toBe("custom");
    expect(config.searches.blog.namespace).toBe("blog");
  });

  test("loadPineconeSearchConfig throws when config cannot be found", async () => {
    const tempDir = await fs.mkdtemp(path.join(os.tmpdir(), "nps-config-"));
    createdDirs.push(tempDir);

    await expect(loadPineconeSearchConfig({ cwd: tempDir })).rejects.toThrow("could not find search config");
  });
});
