import fs from "node:fs/promises";
import os from "node:os";
import path from "node:path";

import { afterEach, describe, expect, test } from "vitest";

import { discoverSearchDocuments } from "../src/documents";

const createdDirs: string[] = [];

afterEach(async () => {
  await Promise.all(
    createdDirs.splice(0).map(async (dir) => {
      await fs.rm(dir, { recursive: true, force: true });
    })
  );
});

describe("discoverSearchDocuments", () => {
  test("attaches routePrefix from the matched source", async () => {
    const tmpDir = await fs.mkdtemp(path.join(os.tmpdir(), "nps-docs-"));
    createdDirs.push(tmpDir);

    await fs.mkdir(path.join(tmpDir, "content/blog"), { recursive: true });
    await fs.mkdir(path.join(tmpDir, "content/authors"), { recursive: true });

    await fs.writeFile(path.join(tmpDir, "content/blog/hello.mdx"), "# Hello\n\nBlog body");
    await fs.writeFile(path.join(tmpDir, "content/authors/jane.mdx"), "# Jane\n\nAuthor body");

    const docs = await discoverSearchDocuments(
      {
        namespace: "global",
        sources: [
          { include: ["content/blog/**/*.mdx"], routePrefix: "/blog" },
          { include: ["content/authors/**/*.mdx"], routePrefix: "/authors" }
        ]
      },
      tmpDir
    );

    const blog = docs.find((doc) => doc.filePath.endsWith("content/blog/hello.mdx"));
    const author = docs.find((doc) => doc.filePath.endsWith("content/authors/jane.mdx"));

    expect(blog?.routePrefix).toBe("/blog");
    expect(author?.routePrefix).toBe("/authors");
  });

  test("dedupes same file matched by multiple sources", async () => {
    const tmpDir = await fs.mkdtemp(path.join(os.tmpdir(), "nps-docs-"));
    createdDirs.push(tmpDir);

    await fs.mkdir(path.join(tmpDir, "content/blog"), { recursive: true });
    await fs.writeFile(path.join(tmpDir, "content/blog/hello.mdx"), "# Hello\n\nBlog body");

    const docs = await discoverSearchDocuments(
      {
        namespace: "global",
        sources: [
          { include: ["content/**/*.mdx"], routePrefix: "/" },
          { include: ["content/blog/**/*.mdx"], routePrefix: "/blog" }
        ]
      },
      tmpDir
    );

    expect(docs).toHaveLength(1);
  });
});
