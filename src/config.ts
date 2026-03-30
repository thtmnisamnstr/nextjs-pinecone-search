import fs from "node:fs/promises";
import path from "node:path";
import { pathToFileURL } from "node:url";

import jitiFactory from "jiti";

import type {
  PineconeNamedSearch,
  PineconeSearchSource,
  PineconeSearchesDefinition,
  PineconeSearchesDefinitionInput,
  ResolveUrlArgs,
  ResolvedUrl,
  WithPineconeSearchOptions
} from "./types";
import {
  DEFAULT_NAMESPACE_PREFIX,
  maybeJoinUrl,
  normalizeNamespacePrefix,
  normalizeUrlPath,
  toPosixPath
} from "./utils";

export const DEFAULT_CONFIG_FILENAMES = [
  "pinecone.search.config.ts",
  "pinecone.search.config.mts",
  "pinecone.search.config.cts",
  "pinecone.search.config.js",
  "pinecone.search.config.mjs",
  "pinecone.search.config.cjs"
] as const;

function validateSearchDefinition(searchName: string, input: PineconeNamedSearch): void {
  if (!input.namespace || typeof input.namespace !== "string") {
    throw new Error(`[nextjs-pinecone-search] search \"${searchName}\" must define a namespace`);
  }

  if (!Array.isArray(input.sources) || input.sources.length === 0) {
    throw new Error(`[nextjs-pinecone-search] search \"${searchName}\" must define at least one source`);
  }
}

function normalizeSource(searchName: string, source: PineconeSearchSource, sourceIndex: number): PineconeSearchSource {
  if (!Array.isArray(source.include) || source.include.length === 0) {
    throw new Error(
      `[nextjs-pinecone-search] search \"${searchName}\" source[${sourceIndex}] must include at least one glob`
    );
  }

  if (source.exclude && !Array.isArray(source.exclude)) {
    throw new Error(`[nextjs-pinecone-search] search \"${searchName}\" source[${sourceIndex}] exclude must be an array`);
  }

  return {
    include: [...source.include],
    exclude: source.exclude ? [...source.exclude] : undefined,
    routePrefix: source.routePrefix
  };
}

export function defaultResolveUrl(args: ResolveUrlArgs): ResolvedUrl {
  const slug =
    typeof args.frontmatter.slug === "string"
      ? args.frontmatter.slug
      : typeof args.frontmatter.permalink === "string"
        ? args.frontmatter.permalink
        : undefined;

  if (slug) {
    return { urlPath: normalizeUrlPath(slug) };
  }

  const ext = path.extname(args.relativePath);
  const withoutExt = args.relativePath.slice(0, ext ? -ext.length : undefined);
  const normalized = toPosixPath(withoutExt);

  let routePath = normalized;
  if (routePath.endsWith("/index")) {
    routePath = routePath.slice(0, -"/index".length);
  }

  if (!routePath || routePath === ".") {
    routePath = "";
  }

  const prefixed = args.routePrefix
    ? normalizeUrlPath(path.posix.join(args.routePrefix, routePath))
    : normalizeUrlPath(routePath);

  return { urlPath: prefixed };
}

export function definePineconeSearches(input: PineconeSearchesDefinitionInput): PineconeSearchesDefinition {
  if (!input || typeof input !== "object") {
    throw new Error("[nextjs-pinecone-search] definePineconeSearches requires a configuration object");
  }

  if (!input.searches || typeof input.searches !== "object") {
    throw new Error("[nextjs-pinecone-search] searches must be provided");
  }

  const normalizedSearches = Object.fromEntries(
    Object.entries(input.searches).map(([searchName, search]) => {
      validateSearchDefinition(searchName, search);
      const sources = search.sources.map((source, sourceIndex) => normalizeSource(searchName, source, sourceIndex));
      return [searchName, { namespace: search.namespace, sources }];
    })
  );

  return {
    searches: normalizedSearches,
    siteUrl: input.siteUrl,
    resolveUrl: input.resolveUrl,
    namespacePrefix: normalizeNamespacePrefix(input.namespacePrefix ?? DEFAULT_NAMESPACE_PREFIX),
    rebuildScope: input.rebuildScope ?? "managed",
    failOnReindexError: input.failOnReindexError ?? true
  };
}

function isSearchesDefinition(value: unknown): value is PineconeSearchesDefinitionInput {
  return Boolean(value) && typeof value === "object" && "searches" in (value as Record<string, unknown>);
}

async function resolveModule(filePath: string): Promise<unknown> {
  const ext = path.extname(filePath);
  if (ext === ".ts" || ext === ".mts" || ext === ".cts") {
    const jiti = jitiFactory(path.dirname(filePath), { interopDefault: true });
    return jiti.import(filePath);
  }

  const imported = await import(pathToFileURL(filePath).toString());
  return imported.default ?? imported;
}

export async function loadPineconeSearchConfig(
  options: Pick<WithPineconeSearchOptions, "config" | "configPath" | "cwd">
): Promise<PineconeSearchesDefinition> {
  if (options.config) {
    return options.config;
  }

  const cwd = options.cwd ?? process.cwd();
  const envPath = process.env.PINECONE_SEARCH_CONFIG;
  const configPath = options.configPath
    ? path.resolve(cwd, options.configPath)
    : envPath
      ? path.resolve(cwd, envPath)
      : await findDefaultConfigPath(cwd);

  if (!configPath) {
    throw new Error(
      "[nextjs-pinecone-search] could not find search config. Provide `config` to withPineconeSearch() or create pinecone.search.config.{ts,js}`"
    );
  }

  const rawConfig = await resolveModule(configPath);
  const candidate = (rawConfig as { default?: unknown }).default ?? rawConfig;

  if (!isSearchesDefinition(candidate)) {
    throw new Error(
      `[nextjs-pinecone-search] config file \"${configPath}\" must export definePineconeSearches(...) result`
    );
  }

  return definePineconeSearches(candidate);
}

async function findDefaultConfigPath(cwd: string): Promise<string | undefined> {
  for (const filename of DEFAULT_CONFIG_FILENAMES) {
    const absolutePath = path.resolve(cwd, filename);
    try {
      await fs.access(absolutePath);
      return absolutePath;
    } catch {
      // Continue
    }
  }

  return undefined;
}

export function resolveUrlForDocument(
  config: PineconeSearchesDefinition,
  args: ResolveUrlArgs
): Required<ResolvedUrl> | ResolvedUrl {
  const resolver = config.resolveUrl ?? defaultResolveUrl;
  const resolved = resolver(args);

  if (!resolved || !resolved.urlPath) {
    throw new Error(
      `[nextjs-pinecone-search] resolveUrl must return { urlPath } for file \"${args.filePath}\" in search \"${args.searchName}\"`
    );
  }

  const urlPath = normalizeUrlPath(resolved.urlPath);
  const url = resolved.url ?? maybeJoinUrl(config.siteUrl, urlPath);

  return {
    ...resolved,
    urlPath,
    url
  };
}
