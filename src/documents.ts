import fs from "node:fs/promises";
import path from "node:path";

import fg from "fast-glob";
import matter from "gray-matter";

import type { PineconeNamedSearch, SearchFileDocument } from "./types";
import { mapWithConcurrency, toPosixPath } from "./utils";

const FILE_READ_CONCURRENCY = 8;

function extractBaseDir(globPattern: string): string {
  const normalized = toPosixPath(globPattern);
  const wildcardIndex = normalized.search(/[!*?{}()[\]]/);
  const head = wildcardIndex === -1 ? normalized : normalized.slice(0, wildcardIndex);
  const trimmed = head.replace(/\/$/, "");
  return trimmed || ".";
}

function chooseRelativePath(filePath: string, baseDirs: string[], cwd: string): string {
  const normalizedFilePath = toPosixPath(path.resolve(filePath));

  let best: string | undefined;
  for (const dir of baseDirs) {
    const absBase = toPosixPath(path.resolve(cwd, dir));
    if (normalizedFilePath === absBase || normalizedFilePath.startsWith(`${absBase}/`)) {
      const candidate = normalizedFilePath.slice(absBase.length).replace(/^\//, "");
      if (!best || candidate.length < best.length) {
        best = candidate;
      }
    }
  }

  if (best) {
    return best;
  }

  return toPosixPath(path.relative(cwd, filePath));
}

function inferTitle(frontmatterData: Record<string, unknown>, body: string): string | undefined {
  if (typeof frontmatterData.title === "string" && frontmatterData.title.trim()) {
    return frontmatterData.title.trim();
  }

  const headingMatch = body.match(/^#\s+(.+)$/m);
  if (!headingMatch) {
    return undefined;
  }

  return headingMatch[1].trim();
}

export async function discoverSearchDocuments(
  search: PineconeNamedSearch,
  cwd: string
): Promise<SearchFileDocument[]> {
  const deduped = new Map<string, SearchFileDocument>();

  for (const sourceDef of search.sources) {
    const uniqueFiles = await fg(sourceDef.include, {
      cwd,
      absolute: true,
      ignore: sourceDef.exclude ?? [],
      onlyFiles: true,
      unique: true,
      dot: false
    });

    const baseDirs = sourceDef.include.map((globPattern) => extractBaseDir(globPattern));
    const toProcess = uniqueFiles
      .map((absoluteFilePath) => path.resolve(absoluteFilePath))
      .filter((absoluteFilePath) => !deduped.has(absoluteFilePath));

    const documents = await mapWithConcurrency(toProcess, FILE_READ_CONCURRENCY, async (absoluteFilePath) => {
      const source = await fs.readFile(absoluteFilePath, "utf8");
      const parsed = matter(source);
      const frontmatter = (parsed.data ?? {}) as Record<string, unknown>;
      const body = parsed.content.trim();

      if (!body) {
        return undefined;
      }

      const relativePath = chooseRelativePath(absoluteFilePath, baseDirs, cwd);
      const title = inferTitle(frontmatter, body);

      return {
        filePath: absoluteFilePath,
        relativePath,
        frontmatter,
        body,
        title,
        routePrefix: sourceDef.routePrefix
      } satisfies SearchFileDocument;
    });

    for (const document of documents) {
      if (!document) {
        continue;
      }
      deduped.set(document.filePath, document);
    }
  }

  return Array.from(deduped.values());
}
