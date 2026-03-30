"use strict";
var __create = Object.create;
var __defProp = Object.defineProperty;
var __getOwnPropDesc = Object.getOwnPropertyDescriptor;
var __getOwnPropNames = Object.getOwnPropertyNames;
var __getProtoOf = Object.getPrototypeOf;
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
var __toESM = (mod, isNodeMode, target) => (target = mod != null ? __create(__getProtoOf(mod)) : {}, __copyProps(
  // If the importer is in node compatibility mode or this is not an ESM
  // file that has been converted to a CommonJS file using a Babel-
  // compatible transform (i.e. "__esModule" has not been set), then set
  // "default" to the CommonJS "module.exports" for node compatibility.
  isNodeMode || !mod || !mod.__esModule ? __defProp(target, "default", { value: mod, enumerable: true }) : target,
  mod
));
var __toCommonJS = (mod) => __copyProps(__defProp({}, "__esModule", { value: true }), mod);

// src/index.ts
var src_exports = {};
__export(src_exports, {
  PineconeSearchService: () => PineconeSearchService,
  createPineconeSearchRouteHandler: () => createPineconeSearchRouteHandler,
  createPineconeSearchService: () => createPineconeSearchService,
  definePineconeSearches: () => definePineconeSearches,
  loadPineconeSearchConfig: () => loadPineconeSearchConfig,
  withPineconeSearch: () => withPineconeSearch
});
module.exports = __toCommonJS(src_exports);

// src/config.ts
var import_promises = __toESM(require("fs/promises"), 1);
var import_node_path2 = __toESM(require("path"), 1);
var import_node_url = require("url");
var import_jiti = __toESM(require("jiti"), 1);

// src/utils.ts
var import_node_crypto = __toESM(require("crypto"), 1);
var import_node_path = __toESM(require("path"), 1);
var DEFAULT_DENSE_MODEL = "multilingual-e5-large";
var DEFAULT_SPARSE_MODEL = "pinecone-sparse-english-v0";
var DEFAULT_RERANK_MODEL = "bge-reranker-v2-m3";
var DEFAULT_MAX_SEQUENCE_LENGTH = 507;
var RERANK_MAX_DOCS = 100;
var RERANK_PAIR_MAX_TOKENS = 1024;
var DEFAULT_NAMESPACE_PREFIX = "nps";
var defaultLogger = {
  info: (message) => console.info(message),
  warn: (message) => console.warn(message),
  error: (message) => console.error(message),
  debug: (message) => console.debug(message)
};
function toPosixPath(value) {
  return value.split(import_node_path.default.sep).join(import_node_path.default.posix.sep);
}
function normalizeUrlPath(input) {
  const pathLike = input.replace(/\\/g, "/").trim();
  const withLeadingSlash = pathLike.startsWith("/") ? pathLike : `/${pathLike}`;
  const squashed = withLeadingSlash.replace(/\/+/g, "/");
  const noTrailingSlash = squashed.length > 1 ? squashed.replace(/\/$/, "") : squashed;
  return noTrailingSlash || "/";
}
function normalizeNamespacePrefix(prefix) {
  if (!prefix) {
    return DEFAULT_NAMESPACE_PREFIX;
  }
  return prefix.trim().replace(/\s+/g, "-");
}
function applyNamespacePrefix(prefix, namespace) {
  const normalizedPrefix = normalizeNamespacePrefix(prefix);
  if (!normalizedPrefix) {
    return namespace;
  }
  if (namespace.startsWith(`${normalizedPrefix}-`)) {
    return namespace;
  }
  return `${normalizedPrefix}-${namespace}`;
}
function sha256(input) {
  return import_node_crypto.default.createHash("sha256").update(input).digest("hex");
}
function isRetryableError(error) {
  if (!(error instanceof Error)) {
    return false;
  }
  const candidate = error;
  const status = candidate.status ?? candidate.statusCode ?? candidate.response?.status ?? candidate.cause?.status ?? candidate.cause?.statusCode ?? candidate.cause?.response?.status;
  if (status === 429) {
    return true;
  }
  if (typeof status === "number" && status >= 500 && status < 600) {
    return true;
  }
  const message = candidate.message.toLowerCase();
  return message.includes("timed out") || message.includes("econnreset") || message.includes("connection") || message.includes("resource_exhausted") || message.includes("too many requests") || message.includes('status":429');
}
async function withRetry(fn, options = {}) {
  const retries = options.retries ?? 5;
  const initialDelayMs = options.initialDelayMs ?? 400;
  let attempt = 0;
  while (true) {
    try {
      return await fn();
    } catch (error) {
      attempt += 1;
      if (attempt > retries || !isRetryableError(error)) {
        throw error;
      }
      const delay = initialDelayMs * 2 ** (attempt - 1);
      options.logger?.warn(
        `[nextjs-pinecone-search] retrying ${options.label ?? "operation"} after failure (${attempt}/${retries}, wait ${delay}ms)`
      );
      await sleep(delay);
    }
  }
}
function sleep(ms) {
  return new Promise((resolve) => setTimeout(resolve, ms));
}
async function mapWithConcurrency(items, concurrency, mapper) {
  if (concurrency <= 0) {
    throw new Error("concurrency must be greater than 0");
  }
  const results = new Array(items.length);
  let current = 0;
  async function worker() {
    while (current < items.length) {
      const index = current;
      current += 1;
      results[index] = await mapper(items[index], index);
    }
  }
  const workerCount = Math.min(concurrency, items.length);
  const workers = Array.from({ length: workerCount }, () => worker());
  await Promise.all(workers);
  return results;
}
function maybeJoinUrl(siteUrl, urlPath) {
  if (!siteUrl) {
    return void 0;
  }
  try {
    return new URL(urlPath, siteUrl).toString();
  } catch {
    return void 0;
  }
}
function trimToTokenBudget(text, maxTokens, countTokens2) {
  const clean = text.trim();
  if (!clean) {
    return "";
  }
  if (countTokens2(clean) <= maxTokens) {
    return clean;
  }
  const words = clean.split(/\s+/);
  let low = 1;
  let high = words.length;
  let best = words[0] ?? "";
  while (low <= high) {
    const mid = Math.floor((low + high) / 2);
    const candidate = words.slice(0, mid).join(" ");
    if (countTokens2(candidate) <= maxTokens) {
      best = candidate;
      low = mid + 1;
    } else {
      high = mid - 1;
    }
  }
  return best;
}

// src/config.ts
var DEFAULT_CONFIG_FILENAMES = [
  "pinecone.search.config.ts",
  "pinecone.search.config.mts",
  "pinecone.search.config.cts",
  "pinecone.search.config.js",
  "pinecone.search.config.mjs",
  "pinecone.search.config.cjs"
];
function validateSearchDefinition(searchName, input) {
  if (!input.namespace || typeof input.namespace !== "string") {
    throw new Error(`[nextjs-pinecone-search] search "${searchName}" must define a namespace`);
  }
  if (!Array.isArray(input.sources) || input.sources.length === 0) {
    throw new Error(`[nextjs-pinecone-search] search "${searchName}" must define at least one source`);
  }
}
function normalizeSource(searchName, source, sourceIndex) {
  if (!Array.isArray(source.include) || source.include.length === 0) {
    throw new Error(
      `[nextjs-pinecone-search] search "${searchName}" source[${sourceIndex}] must include at least one glob`
    );
  }
  if (source.exclude && !Array.isArray(source.exclude)) {
    throw new Error(`[nextjs-pinecone-search] search "${searchName}" source[${sourceIndex}] exclude must be an array`);
  }
  return {
    include: [...source.include],
    exclude: source.exclude ? [...source.exclude] : void 0,
    routePrefix: source.routePrefix
  };
}
function defaultResolveUrl(args) {
  const slug = typeof args.frontmatter.slug === "string" ? args.frontmatter.slug : typeof args.frontmatter.permalink === "string" ? args.frontmatter.permalink : void 0;
  if (slug) {
    return { urlPath: normalizeUrlPath(slug) };
  }
  const ext = import_node_path2.default.extname(args.relativePath);
  const withoutExt = args.relativePath.slice(0, ext ? -ext.length : void 0);
  const normalized = toPosixPath(withoutExt);
  let routePath = normalized;
  if (routePath.endsWith("/index")) {
    routePath = routePath.slice(0, -"/index".length);
  }
  if (!routePath || routePath === ".") {
    routePath = "";
  }
  const prefixed = args.routePrefix ? normalizeUrlPath(import_node_path2.default.posix.join(args.routePrefix, routePath)) : normalizeUrlPath(routePath);
  return { urlPath: prefixed };
}
function definePineconeSearches(input) {
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
function isSearchesDefinition(value) {
  return Boolean(value) && typeof value === "object" && "searches" in value;
}
async function resolveModule(filePath) {
  const ext = import_node_path2.default.extname(filePath);
  if (ext === ".ts" || ext === ".mts" || ext === ".cts") {
    const jiti = (0, import_jiti.default)(import_node_path2.default.dirname(filePath), { interopDefault: true });
    return jiti.import(filePath);
  }
  const imported = await import((0, import_node_url.pathToFileURL)(filePath).toString());
  return imported.default ?? imported;
}
async function loadPineconeSearchConfig(options) {
  if (options.config) {
    return options.config;
  }
  const cwd = options.cwd ?? process.cwd();
  const envPath = process.env.PINECONE_SEARCH_CONFIG;
  const configPath = options.configPath ? import_node_path2.default.resolve(cwd, options.configPath) : envPath ? import_node_path2.default.resolve(cwd, envPath) : await findDefaultConfigPath(cwd);
  if (!configPath) {
    throw new Error(
      "[nextjs-pinecone-search] could not find search config. Provide `config` to withPineconeSearch() or create pinecone.search.config.{ts,js}`"
    );
  }
  const rawConfig = await resolveModule(configPath);
  const candidate = rawConfig.default ?? rawConfig;
  if (!isSearchesDefinition(candidate)) {
    throw new Error(
      `[nextjs-pinecone-search] config file "${configPath}" must export definePineconeSearches(...) result`
    );
  }
  return definePineconeSearches(candidate);
}
async function findDefaultConfigPath(cwd) {
  for (const filename of DEFAULT_CONFIG_FILENAMES) {
    const absolutePath = import_node_path2.default.resolve(cwd, filename);
    try {
      await import_promises.default.access(absolutePath);
      return absolutePath;
    } catch {
    }
  }
  return void 0;
}
function resolveUrlForDocument(config, args) {
  const resolver = config.resolveUrl ?? defaultResolveUrl;
  const resolved = resolver(args);
  if (!resolved || !resolved.urlPath) {
    throw new Error(
      `[nextjs-pinecone-search] resolveUrl must return { urlPath } for file "${args.filePath}" in search "${args.searchName}"`
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

// src/next.ts
var import_node_child_process = require("child_process");
var import_promises3 = __toESM(require("fs/promises"), 1);
var import_node_path5 = __toESM(require("path"), 1);

// src/service.ts
var import_node_path4 = __toESM(require("path"), 1);
var import_pinecone = require("@pinecone-database/pinecone");

// src/chunking.ts
var import_gpt_tokenizer = require("gpt-tokenizer");
var SENTENCE_SPLIT_REGEX = /(?<=[.!?])\s+/;
function normalizeBody(content) {
  return content.replace(/\r\n/g, "\n").trim();
}
function tokenizeCount(text) {
  return (0, import_gpt_tokenizer.countTokens)(text);
}
function splitByParagraphs(content) {
  const normalized = normalizeBody(content);
  if (!normalized) {
    return [];
  }
  return normalized.split(/\n{2,}/).map((value) => value.trim()).filter(Boolean);
}
function splitOversizedByWords(text, maxTokens) {
  const words = text.split(/\s+/).filter(Boolean);
  if (words.length === 0) {
    return [];
  }
  const chunks = [];
  let cursor = 0;
  while (cursor < words.length) {
    let low = cursor + 1;
    let high = words.length;
    let best = cursor + 1;
    while (low <= high) {
      const mid = Math.floor((low + high) / 2);
      const candidate = words.slice(cursor, mid).join(" ");
      const tokens = tokenizeCount(candidate);
      if (tokens <= maxTokens) {
        best = mid;
        low = mid + 1;
      } else {
        high = mid - 1;
      }
    }
    if (best === cursor + 1 && tokenizeCount(words[cursor]) > maxTokens) {
      chunks.push(words[cursor]);
      cursor += 1;
      continue;
    }
    chunks.push(words.slice(cursor, best).join(" "));
    cursor = best;
  }
  return chunks.filter(Boolean);
}
function splitOversizedParagraph(paragraph, maxTokens) {
  const sentenceCandidates = paragraph.split(SENTENCE_SPLIT_REGEX).map((value) => value.trim()).filter(Boolean);
  if (sentenceCandidates.length <= 1) {
    return splitOversizedByWords(paragraph, maxTokens);
  }
  const normalizedSentences = sentenceCandidates.flatMap((sentence) => {
    if (tokenizeCount(sentence) <= maxTokens) {
      return [sentence];
    }
    return splitOversizedByWords(sentence, maxTokens);
  });
  const units = [];
  let current = [];
  let currentTokens = 0;
  for (const sentence of normalizedSentences) {
    const sentenceTokens = tokenizeCount(sentence);
    if (sentenceTokens > maxTokens) {
      const forced = trimToTokenBudget(sentence, maxTokens, tokenizeCount);
      if (forced) {
        if (current.length > 0) {
          units.push(current.join(" "));
          current = [];
          currentTokens = 0;
        }
        units.push(forced);
      }
      continue;
    }
    if (currentTokens + sentenceTokens <= maxTokens) {
      current.push(sentence);
      currentTokens += sentenceTokens;
    } else {
      if (current.length > 0) {
        units.push(current.join(" "));
      }
      current = [sentence];
      currentTokens = sentenceTokens;
    }
  }
  if (current.length > 0) {
    units.push(current.join(" "));
  }
  return units;
}
function toBoundedUnits(content, maxTokens) {
  const paragraphUnits = splitByParagraphs(content).flatMap((paragraph) => {
    const tokens = tokenizeCount(paragraph);
    if (tokens <= maxTokens) {
      return [{ text: paragraph, tokens }];
    }
    return splitOversizedParagraph(paragraph, maxTokens).map((piece) => ({
      text: piece,
      tokens: Math.min(tokenizeCount(piece), maxTokens)
    }));
  });
  return paragraphUnits.filter((unit) => unit.text.trim().length > 0);
}
function chunkDocumentByParagraphs(content, options) {
  const maxTokens = options.maxTokens;
  const overlapRatio = options.overlapRatio;
  if (maxTokens <= 0) {
    throw new Error("maxTokens must be greater than 0");
  }
  if (overlapRatio < 0 || overlapRatio >= 1) {
    throw new Error("overlapRatio must be in [0, 1)");
  }
  const units = toBoundedUnits(content, maxTokens);
  if (units.length === 0) {
    return [];
  }
  const chunks = [];
  let startIndex = 0;
  let chunkIndex = 0;
  while (startIndex < units.length) {
    let endIndex = startIndex;
    let totalTokens = 0;
    while (endIndex < units.length && totalTokens + units[endIndex].tokens <= maxTokens) {
      totalTokens += units[endIndex].tokens;
      endIndex += 1;
    }
    if (endIndex === startIndex) {
      totalTokens = Math.min(units[startIndex].tokens, maxTokens);
      endIndex += 1;
    }
    const currentUnits = units.slice(startIndex, endIndex);
    const text = currentUnits.map((unit) => unit.text).join("\n\n").trim();
    chunks.push({
      text,
      tokenCount: totalTokens,
      chunkIndex
    });
    chunkIndex += 1;
    if (endIndex >= units.length) {
      break;
    }
    const targetOverlapTokens = Math.max(1, Math.floor(totalTokens * overlapRatio));
    let overlapTokens = 0;
    let nextStart = endIndex - 1;
    while (nextStart > startIndex && overlapTokens < targetOverlapTokens) {
      overlapTokens += units[nextStart].tokens;
      nextStart -= 1;
    }
    const candidateNextStart = Math.max(nextStart, startIndex + 1);
    startIndex = candidateNextStart;
  }
  return chunks;
}
function trimForRerank(text, maxTokens = 700) {
  return trimToTokenBudget(text, maxTokens, tokenizeCount);
}
function countTextTokens(text) {
  return tokenizeCount(text);
}

// src/documents.ts
var import_promises2 = __toESM(require("fs/promises"), 1);
var import_node_path3 = __toESM(require("path"), 1);
var import_fast_glob = __toESM(require("fast-glob"), 1);
var import_gray_matter = __toESM(require("gray-matter"), 1);
var FILE_READ_CONCURRENCY = 8;
function extractBaseDir(globPattern) {
  const normalized = toPosixPath(globPattern);
  const wildcardIndex = normalized.search(/[!*?{}()[\]]/);
  const head = wildcardIndex === -1 ? normalized : normalized.slice(0, wildcardIndex);
  const trimmed = head.replace(/\/$/, "");
  return trimmed || ".";
}
function chooseRelativePath(filePath, baseDirs, cwd) {
  const normalizedFilePath = toPosixPath(import_node_path3.default.resolve(filePath));
  let best;
  for (const dir of baseDirs) {
    const absBase = toPosixPath(import_node_path3.default.resolve(cwd, dir));
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
  return toPosixPath(import_node_path3.default.relative(cwd, filePath));
}
function inferTitle(frontmatterData, body) {
  if (typeof frontmatterData.title === "string" && frontmatterData.title.trim()) {
    return frontmatterData.title.trim();
  }
  const headingMatch = body.match(/^#\s+(.+)$/m);
  if (!headingMatch) {
    return void 0;
  }
  return headingMatch[1].trim();
}
async function discoverSearchDocuments(search, cwd) {
  const deduped = /* @__PURE__ */ new Map();
  for (const sourceDef of search.sources) {
    const uniqueFiles = await (0, import_fast_glob.default)(sourceDef.include, {
      cwd,
      absolute: true,
      ignore: sourceDef.exclude ?? [],
      onlyFiles: true,
      unique: true,
      dot: false
    });
    const baseDirs = sourceDef.include.map((globPattern) => extractBaseDir(globPattern));
    const toProcess = uniqueFiles.map((absoluteFilePath) => import_node_path3.default.resolve(absoluteFilePath)).filter((absoluteFilePath) => !deduped.has(absoluteFilePath));
    const documents = await mapWithConcurrency(toProcess, FILE_READ_CONCURRENCY, async (absoluteFilePath) => {
      const source = await import_promises2.default.readFile(absoluteFilePath, "utf8");
      const parsed = (0, import_gray_matter.default)(source);
      const frontmatter = parsed.data ?? {};
      const body = parsed.content.trim();
      if (!body) {
        return void 0;
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
      };
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

// src/service.ts
var DENSE_FIELD_MAP = { text: "chunk_text" };
var SPARSE_FIELD_MAP = { text: "chunk_text" };
var SPARSE_RW_PARAMS = { max_tokens_per_sequence: 2048 };
var DEFAULT_TOP_K = 10;
var DEFAULT_RRF_K = 60;
var SPARSE_INGEST_CONCURRENCY = 1;
var DENSE_INGEST_CONCURRENCY = 1;
var READY_TIMEOUT_MS = 18e4;
var READY_POLL_MS = 2e3;
var RERANK_PAIR_SAFETY_MARGIN = 192;
var RERANK_PAIR_RETRY_SAFETY_MARGIN = 320;
var PineconeSearchService = class {
  config;
  cwd;
  logger;
  pc;
  denseIndexName;
  sparseIndexName;
  maxSequenceLength = DEFAULT_MAX_SEQUENCE_LENGTH;
  constructor(options) {
    const apiKey = options.pineconeApiKey ?? process.env.PINECONE_API_KEY;
    if (!apiKey) {
      throw new Error("[nextjs-pinecone-search] Missing required env var PINECONE_API_KEY");
    }
    this.denseIndexName = options.denseIndexName ?? process.env.PINECONE_DENSE_INDEX ?? "";
    if (!this.denseIndexName) {
      throw new Error("[nextjs-pinecone-search] Missing required env var PINECONE_DENSE_INDEX");
    }
    this.sparseIndexName = options.sparseIndexName ?? process.env.PINECONE_SPARSE_INDEX ?? "";
    if (!this.sparseIndexName) {
      throw new Error("[nextjs-pinecone-search] Missing required env var PINECONE_SPARSE_INDEX");
    }
    this.config = options.config;
    this.cwd = options.cwd ? import_node_path4.default.resolve(options.cwd) : process.cwd();
    this.logger = options.logger ?? defaultLogger;
    this.pc = new import_pinecone.Pinecone({ apiKey });
  }
  async reindexAll() {
    this.logger.info("[nextjs-pinecone-search] starting full reindex");
    await this.hydrateModelLimits();
    await this.ensureIndexes();
    const denseIndex = this.pc.index(this.denseIndexName);
    const sparseIndex = this.pc.index(this.sparseIndexName);
    await this.deleteNamespacesForRebuild(denseIndex, sparseIndex);
    const namespaceRecordCounts = {};
    for (const [searchName, searchDefinition] of Object.entries(this.config.searches)) {
      const managedNamespace = this.getNamespace(searchDefinition.namespace);
      const documents = await discoverSearchDocuments(searchDefinition, this.cwd);
      const records = [];
      for (const document of documents) {
        const resolvedUrl = resolveUrlForDocument(this.config, {
          filePath: document.filePath,
          relativePath: document.relativePath,
          searchName,
          frontmatter: document.frontmatter,
          routePrefix: document.routePrefix
        });
        const chunks = chunkDocumentByParagraphs(document.body, {
          maxTokens: this.maxSequenceLength,
          overlapRatio: 0.2
        });
        const sourcePath = toPosixPath(import_node_path4.default.relative(this.cwd, document.filePath));
        for (const chunk of chunks) {
          const id = sha256(`${managedNamespace}:${sourcePath}:${chunk.chunkIndex}`);
          const rerankText = this.createRerankText(chunk.text);
          records.push({
            _id: id,
            chunk_text: chunk.text,
            rerank_text: rerankText,
            searchName,
            namespace: managedNamespace,
            sourcePath,
            urlPath: resolvedUrl.urlPath,
            url: resolvedUrl.url,
            title: document.title,
            chunkIndex: chunk.chunkIndex
          });
        }
      }
      namespaceRecordCounts[managedNamespace] = records.length;
      if (records.length === 0) {
        this.logger.warn(
          `[nextjs-pinecone-search] search "${searchName}" produced 0 records for namespace "${managedNamespace}"`
        );
        continue;
      }
      await Promise.all([
        this.upsertRecordsToIndex(
          denseIndex.namespace(managedNamespace),
          records,
          DENSE_INGEST_CONCURRENCY,
          "dense"
        ),
        this.upsertRecordsToIndex(
          sparseIndex.namespace(managedNamespace),
          records,
          SPARSE_INGEST_CONCURRENCY,
          "sparse"
        )
      ]);
      this.logger.info(
        `[nextjs-pinecone-search] indexed ${records.length} chunks for search "${searchName}" into namespace "${managedNamespace}"`
      );
    }
    await Promise.all([
      this.waitForNamespaceCounts(denseIndex, namespaceRecordCounts, this.denseIndexName),
      this.waitForNamespaceCounts(sparseIndex, namespaceRecordCounts, this.sparseIndexName)
    ]);
    this.logger.info("[nextjs-pinecone-search] full reindex complete");
    return {
      denseIndex: this.denseIndexName,
      sparseIndex: this.sparseIndexName,
      namespaces: namespaceRecordCounts
    };
  }
  async search(searchName, query, options = {}) {
    const searchDef = this.config.searches[searchName];
    if (!searchDef) {
      throw new Error(`[nextjs-pinecone-search] Unknown search "${searchName}"`);
    }
    const namespace = this.getNamespace(searchDef.namespace);
    const topK = Math.max(1, options.topK ?? DEFAULT_TOP_K);
    const candidateTopK = Math.max(topK, options.candidateTopK ?? topK * 4);
    const rerankLimit = Math.min(
      RERANK_MAX_DOCS,
      Math.max(topK, options.rerankCandidateLimit ?? Math.min(candidateTopK * 2, RERANK_MAX_DOCS))
    );
    const fields = [
      "searchName",
      "namespace",
      "sourcePath",
      "urlPath",
      "url",
      "title",
      "chunkIndex",
      "chunk_text",
      "rerank_text"
    ];
    const denseIndex = this.pc.index(this.denseIndexName).namespace(namespace);
    const sparseIndex = this.pc.index(this.sparseIndexName).namespace(namespace);
    const [denseResponse, sparseResponse] = await Promise.all([
      withRetry(
        () => denseIndex.searchRecords({
          query: {
            topK: candidateTopK,
            inputs: { text: query },
            filter: options.filter
          },
          fields
        }),
        { logger: this.logger, label: "dense search" }
      ),
      withRetry(
        () => sparseIndex.searchRecords({
          query: {
            topK: candidateTopK,
            inputs: { text: query },
            filter: options.filter
          },
          fields
        }),
        { logger: this.logger, label: "sparse search" }
      )
    ]);
    const mergedCandidates = mergeHybridHits(
      denseResponse.result.hits,
      sparseResponse.result.hits,
      DEFAULT_RRF_K,
      searchName,
      namespace
    );
    const candidates = dedupeCandidates(mergedCandidates);
    const rerankPool = candidates.slice(0, rerankLimit);
    const rerankInputs = buildRerankInputs(query, rerankPool);
    const rerankTopN = Math.min(topK, options.rerankTopN ?? topK, rerankInputs.length);
    let ranked;
    if (rerankInputs.length > 0 && rerankTopN > 0) {
      try {
        const rerankResponse = await this.runRerank(query, rerankInputs, rerankTopN, "rerank");
        const reranked = rerankResponse.data.map((item) => {
          const candidate = rerankInputs[item.index]?.candidate;
          if (!candidate) {
            return void 0;
          }
          return {
            candidate,
            rerankScore: item.score
          };
        }).filter((value) => Boolean(value)).sort((a, b) => b.rerankScore - a.rerankScore).slice(0, rerankTopN);
        ranked = reranked.map((item) => ({
          ...item.candidate,
          rrfScore: item.rerankScore
        }));
      } catch (error) {
        if (isRerankPairLimitError(error)) {
          const tighterInputs = buildRerankInputs(query, rerankPool, RERANK_PAIR_RETRY_SAFETY_MARGIN);
          const tighterTopN = Math.min(topK, options.rerankTopN ?? topK, tighterInputs.length);
          if (tighterInputs.length > 0 && tighterTopN > 0) {
            try {
              const rerankResponse = await this.runRerank(query, tighterInputs, tighterTopN, "rerank retry");
              const reranked = rerankResponse.data.map((item) => {
                const candidate = tighterInputs[item.index]?.candidate;
                if (!candidate) {
                  return void 0;
                }
                return {
                  candidate,
                  rerankScore: item.score
                };
              }).filter((value) => Boolean(value)).sort((a, b) => b.rerankScore - a.rerankScore).slice(0, tighterTopN);
              ranked = reranked.map((item) => ({
                ...item.candidate,
                rrfScore: item.rerankScore
              }));
            } catch (retryError) {
              this.logger.warn(
                `[nextjs-pinecone-search] rerank retry failed for search "${searchName}", falling back to hybrid RRF ordering: ${retryError.message}`
              );
              ranked = candidates.slice(0, topK);
            }
          } else {
            ranked = candidates.slice(0, topK);
          }
        } else {
          this.logger.warn(
            `[nextjs-pinecone-search] rerank failed for search "${searchName}", falling back to hybrid RRF ordering: ${error.message}`
          );
          ranked = candidates.slice(0, topK);
        }
      }
    } else {
      ranked = candidates.slice(0, topK);
    }
    const results = ranked.slice(0, topK).map((candidate) => ({
      id: candidate.id,
      score: candidate.rrfScore,
      rrfScore: candidate.rrfScore,
      denseScore: candidate.denseScore,
      sparseScore: candidate.sparseScore,
      searchName: candidate.searchName,
      namespace: candidate.namespace,
      sourcePath: candidate.sourcePath,
      urlPath: candidate.urlPath,
      url: candidate.url,
      title: candidate.title,
      chunkIndex: candidate.chunkIndex,
      snippet: candidate.snippet
    }));
    return {
      results,
      query,
      search: searchName
    };
  }
  async upsertRecordsToIndex(namespaceIndex, records, concurrency, flavor) {
    await mapWithConcurrency(records, concurrency, async (record, idx) => {
      await withRetry(
        () => namespaceIndex.upsertRecords([record]),
        {
          logger: this.logger,
          label: `${flavor} upsert record ${idx + 1}/${records.length}`
        }
      );
    });
  }
  async runRerank(query, inputs, topN, label) {
    return withRetry(
      () => this.pc.inference.rerank(
        DEFAULT_RERANK_MODEL,
        query,
        inputs.map((item) => ({ rerank_text: item.rerankText })),
        {
          rankFields: ["rerank_text"],
          returnDocuments: false,
          topN
        }
      ),
      { logger: this.logger, label }
    );
  }
  createRerankText(text) {
    const budget = Math.max(256, RERANK_PAIR_MAX_TOKENS - 224);
    const trimmed = trimForRerank(text, budget);
    if (trimmed) {
      return trimmed;
    }
    return trimToTokenBudget(text, budget, countTextTokens);
  }
  getNamespace(rawNamespace) {
    return applyNamespacePrefix(this.config.namespacePrefix, rawNamespace);
  }
  async hydrateModelLimits() {
    try {
      const model = await this.pc.inference.getModel(DEFAULT_DENSE_MODEL);
      this.maxSequenceLength = Math.min(model.maxSequenceLength ?? DEFAULT_MAX_SEQUENCE_LENGTH, DEFAULT_MAX_SEQUENCE_LENGTH);
    } catch (error) {
      this.logger.warn(
        `[nextjs-pinecone-search] could not fetch model metadata for ${DEFAULT_DENSE_MODEL}, using defaults (${DEFAULT_MAX_SEQUENCE_LENGTH}): ${error.message}`
      );
      this.maxSequenceLength = DEFAULT_MAX_SEQUENCE_LENGTH;
    }
  }
  async ensureIndexes() {
    const indexList = await withRetry(() => this.pc.listIndexes(), { logger: this.logger, label: "list indexes" });
    const denseExisting = indexList.indexes?.find((index) => index.name === this.denseIndexName);
    const sparseExisting = indexList.indexes?.find((index) => index.name === this.sparseIndexName);
    const location = this.resolveCloudRegion(denseExisting, sparseExisting);
    await Promise.all([
      this.ensureSingleIndex({
        existing: denseExisting,
        name: this.denseIndexName,
        model: DEFAULT_DENSE_MODEL,
        expectedFieldMap: DENSE_FIELD_MAP,
        location,
        isSparse: false
      }),
      this.ensureSingleIndex({
        existing: sparseExisting,
        name: this.sparseIndexName,
        model: DEFAULT_SPARSE_MODEL,
        expectedFieldMap: SPARSE_FIELD_MAP,
        location,
        isSparse: true
      })
    ]);
  }
  resolveCloudRegion(denseExisting, sparseExisting) {
    const candidates = [denseExisting, sparseExisting].filter(Boolean);
    for (const candidate of candidates) {
      if (candidate.spec?.serverless?.cloud && candidate.spec.serverless.region) {
        return {
          cloud: candidate.spec.serverless.cloud,
          region: candidate.spec.serverless.region
        };
      }
    }
    return {
      cloud: "aws",
      region: "us-east-1"
    };
  }
  async ensureSingleIndex(input) {
    if (!input.existing) {
      this.logger.info(`[nextjs-pinecone-search] creating missing index "${input.name}" for model "${input.model}"`);
      await withRetry(
        () => this.pc.createIndexForModel({
          name: input.name,
          cloud: input.location.cloud,
          region: input.location.region,
          waitUntilReady: true,
          suppressConflicts: true,
          embed: {
            model: input.model,
            fieldMap: input.expectedFieldMap,
            ...input.isSparse ? {
              readParameters: SPARSE_RW_PARAMS,
              writeParameters: SPARSE_RW_PARAMS
            } : {}
          }
        }),
        { logger: this.logger, label: `create index ${input.name}` }
      );
      return;
    }
    if (!input.existing.spec?.serverless) {
      throw new Error(
        `[nextjs-pinecone-search] index "${input.name}" is not serverless. This package only supports serverless indexes.`
      );
    }
    const existingModel = input.existing.embed?.model;
    if (existingModel !== input.model) {
      throw new Error(
        `[nextjs-pinecone-search] index "${input.name}" is integrated with model "${existingModel ?? "unknown"}", expected "${input.model}". Create a dedicated index or update env vars.`
      );
    }
    const currentFieldMap = input.existing.embed?.fieldMap;
    const currentField = typeof currentFieldMap?.text === "string" ? currentFieldMap.text : void 0;
    const needsFieldMapUpdate = currentField !== input.expectedFieldMap.text;
    const embedPatch = {};
    if (needsFieldMapUpdate) {
      embedPatch.fieldMap = input.expectedFieldMap;
    }
    if (input.isSparse) {
      const readParams = input.existing.embed?.readParameters ?? {};
      const writeParams = input.existing.embed?.writeParameters ?? {};
      const readMax = toNumber(readParams.max_tokens_per_sequence ?? readParams.maxTokensPerSequence);
      const writeMax = toNumber(writeParams.max_tokens_per_sequence ?? writeParams.maxTokensPerSequence);
      if (readMax !== 2048) {
        embedPatch.readParameters = SPARSE_RW_PARAMS;
      }
      if (writeMax !== 2048) {
        embedPatch.writeParameters = SPARSE_RW_PARAMS;
      }
    }
    if (Object.keys(embedPatch).length > 0) {
      this.logger.info(`[nextjs-pinecone-search] configuring index "${input.name}" embed settings`);
      await withRetry(
        () => this.pc.configureIndex(input.name, { embed: embedPatch }),
        { logger: this.logger, label: `configure index ${input.name}` }
      );
    }
  }
  async listAllNamespaces(indexName) {
    const index = this.pc.index(indexName);
    const namespaces = /* @__PURE__ */ new Set();
    let paginationToken;
    do {
      const response = await withRetry(
        () => index.listNamespaces(100, paginationToken),
        { logger: this.logger, label: `list namespaces ${indexName}` }
      );
      for (const namespace of response.namespaces ?? []) {
        if (namespace.name) {
          namespaces.add(namespace.name);
        }
      }
      paginationToken = response.pagination?.next;
    } while (paginationToken);
    return Array.from(namespaces);
  }
  async deleteNamespacesForRebuild(denseIndex, sparseIndex) {
    let targets;
    if (this.config.rebuildScope === "all") {
      const [denseNamespaces, sparseNamespaces] = await Promise.all([
        this.listAllNamespaces(this.denseIndexName),
        this.listAllNamespaces(this.sparseIndexName)
      ]);
      targets = Array.from(/* @__PURE__ */ new Set([...denseNamespaces, ...sparseNamespaces]));
    } else {
      targets = Array.from(new Set(Object.values(this.config.searches).map((search) => this.getNamespace(search.namespace))));
    }
    if (targets.length === 0) {
      return;
    }
    await Promise.all([
      this.deleteNamespaces(denseIndex, targets, this.denseIndexName),
      this.deleteNamespaces(sparseIndex, targets, this.sparseIndexName)
    ]);
  }
  async deleteNamespaces(index, targets, indexName) {
    for (const namespace of targets) {
      try {
        await withRetry(
          () => index.deleteNamespace(namespace),
          { logger: this.logger, label: `delete namespace ${indexName}/${namespace}` }
        );
      } catch (error) {
        const message = error.message;
        if (message.includes("404") || message.toLowerCase().includes("not found")) {
          continue;
        }
        throw error;
      }
    }
  }
  async waitForNamespaceCounts(index, expected, indexName) {
    const targetNamespaces = Object.entries(expected).filter(([, count]) => count > 0);
    if (targetNamespaces.length === 0) {
      return;
    }
    const startedAt = Date.now();
    while (true) {
      const stats = await withRetry(() => index.describeIndexStats(), {
        logger: this.logger,
        label: `describe index stats ${indexName}`
      });
      const ready = targetNamespaces.every(([namespace, expectedCount]) => {
        const actual = stats.namespaces?.[namespace]?.recordCount ?? 0;
        return actual >= expectedCount;
      });
      if (ready) {
        return;
      }
      if (Date.now() - startedAt > READY_TIMEOUT_MS) {
        throw new Error(
          `[nextjs-pinecone-search] timed out waiting for index "${indexName}" namespace counts to match expected values`
        );
      }
      await sleep(READY_POLL_MS);
    }
  }
};
function createPineconeSearchService(options) {
  return new PineconeSearchService(options);
}
function buildRerankInputs(query, candidates, safetyMargin = RERANK_PAIR_SAFETY_MARGIN) {
  const queryTokens = countTextTokens(query);
  const pairTokenBudget = Math.max(1, RERANK_PAIR_MAX_TOKENS - safetyMargin);
  const maxDocumentTokens = pairTokenBudget - queryTokens;
  if (maxDocumentTokens <= 0) {
    return [];
  }
  return candidates.map((candidate) => {
    let rerankText = trimToTokenBudget(candidate.rerankText, maxDocumentTokens, countTextTokens);
    let remainingBudget = maxDocumentTokens;
    for (let i = 0; i < 6 && rerankText; i += 1) {
      const pairTokens = countTextTokens(`${query}
${rerankText}`);
      if (pairTokens <= pairTokenBudget) {
        break;
      }
      remainingBudget = Math.max(1, remainingBudget - 32);
      rerankText = trimToTokenBudget(rerankText, remainingBudget, countTextTokens);
    }
    return {
      candidate,
      rerankText
    };
  }).filter((value) => value.rerankText.length > 0);
}
function isRerankPairLimitError(error) {
  if (!(error instanceof Error)) {
    return false;
  }
  const message = error.message.toLowerCase();
  return message.includes("query+document pair") && message.includes("exceeds the maximum token limit") && message.includes("1024");
}
function dedupeCandidates(candidates) {
  const seen = /* @__PURE__ */ new Set();
  const deduped = [];
  for (const candidate of candidates) {
    const key = candidate.urlPath || candidate.url || candidate.sourcePath || candidate.id;
    if (seen.has(key)) {
      continue;
    }
    seen.add(key);
    deduped.push(candidate);
  }
  return deduped;
}
function mergeHybridHits(denseHits, sparseHits, rrfK, searchName, namespace) {
  const candidateMap = /* @__PURE__ */ new Map();
  for (let rank = 0; rank < denseHits.length; rank += 1) {
    const hit = denseHits[rank];
    const id = hit._id;
    const fields = toFields(hit.fields);
    const existing = candidateMap.get(id);
    const base = existing ?? baseCandidateFromFields(id, fields, searchName, namespace);
    base.denseScore = hit._score;
    base.rrfScore += 1 / (rrfK + rank + 1);
    candidateMap.set(id, base);
  }
  for (let rank = 0; rank < sparseHits.length; rank += 1) {
    const hit = sparseHits[rank];
    const id = hit._id;
    const fields = toFields(hit.fields);
    const existing = candidateMap.get(id);
    const base = existing ?? baseCandidateFromFields(id, fields, searchName, namespace);
    base.sparseScore = hit._score;
    base.rrfScore += 1 / (rrfK + rank + 1);
    candidateMap.set(id, base);
  }
  return Array.from(candidateMap.values()).sort((a, b) => b.rrfScore - a.rrfScore);
}
function baseCandidateFromFields(id, fields, searchName, namespace) {
  const chunkText = stringOrEmpty(fields.chunk_text);
  const rerankText = stringOrEmpty(fields.rerank_text) || trimToTokenBudget(chunkText, 700, countTextTokens);
  return {
    id,
    rrfScore: 0,
    searchName: stringOrEmpty(fields.searchName) || searchName,
    namespace: stringOrEmpty(fields.namespace) || namespace,
    sourcePath: stringOrEmpty(fields.sourcePath),
    urlPath: stringOrEmpty(fields.urlPath),
    url: stringOrUndefined(fields.url),
    title: stringOrUndefined(fields.title),
    chunkIndex: numberOrDefault(fields.chunkIndex, 0),
    snippet: chunkText,
    rerankText
  };
}
function toFields(value) {
  if (!value || typeof value !== "object") {
    return {};
  }
  return value;
}
function stringOrEmpty(value) {
  return typeof value === "string" ? value : "";
}
function stringOrUndefined(value) {
  return typeof value === "string" ? value : void 0;
}
function numberOrDefault(value, fallback) {
  if (typeof value === "number") {
    return value;
  }
  if (typeof value === "string") {
    const parsed = Number(value);
    if (Number.isFinite(parsed)) {
      return parsed;
    }
  }
  return fallback;
}
function toNumber(value) {
  if (typeof value === "number") {
    return value;
  }
  if (typeof value === "string") {
    const parsed = Number(value);
    if (Number.isFinite(parsed)) {
      return parsed;
    }
  }
  return void 0;
}

// src/next.ts
var REINDEX_RUNS_KEY = "__nextjs_pinecone_search_reindex_runs__";
var REINDEX_ENV_KEY = "NEXTJS_PINECONE_SEARCH_REINDEX_RUN_KEY";
function getGlobalRunMap() {
  const globalState = globalThis;
  if (!globalState[REINDEX_RUNS_KEY]) {
    globalState[REINDEX_RUNS_KEY] = /* @__PURE__ */ new Map();
  }
  return globalState[REINDEX_RUNS_KEY];
}
function detectNextCommand() {
  const argv = process.argv.join(" ");
  if (/\bnext\b/.test(argv)) {
    if (/\btypegen\b/.test(argv)) {
      return "typegen";
    }
    if (/\bdev\b/.test(argv)) {
      return "dev";
    }
    if (/\bbuild\b/.test(argv)) {
      return "build";
    }
  }
  const lifecycle = process.env.npm_lifecycle_event ?? "";
  if (/typegen/i.test(lifecycle)) {
    return "typegen";
  }
  if (/next(:|-)?.*dev|\bdev\b/i.test(lifecycle)) {
    return "dev";
  }
  if (/next(:|-)?.*build|\bbuild\b/i.test(lifecycle)) {
    return "build";
  }
  return null;
}
function shouldAutoReindex(command) {
  return command === "dev" || command === "build";
}
async function runAutoReindexOnce(options) {
  const cwd = import_node_path5.default.resolve(options.cwd ?? process.cwd());
  const command = detectNextCommand();
  if (!shouldAutoReindex(command)) {
    return;
  }
  const processGroupId = getProcessGroupId();
  const envRunKey = `${cwd}:${command}:${processGroupId}`;
  if (process.env[REINDEX_ENV_KEY] === envRunKey) {
    return;
  }
  if (await hasReindexedInProcessGroup(cwd, command, envRunKey)) {
    return;
  }
  process.env[REINDEX_ENV_KEY] = envRunKey;
  const logger = options.logger ?? defaultLogger;
  const runMap = getGlobalRunMap();
  const runKey = `${cwd}:${command}`;
  const existing = runMap.get(runKey);
  if (existing) {
    await existing;
    return;
  }
  const runPromise = (async () => {
    const config = await loadPineconeSearchConfig(options);
    const service = createPineconeSearchService({
      config,
      cwd,
      logger
    });
    try {
      await service.reindexAll();
    } catch (error) {
      if (!config.failOnReindexError) {
        logger.warn(
          `[nextjs-pinecone-search] reindex failed but failOnReindexError=false, continuing: ${error.message}`
        );
        return;
      }
      throw error;
    }
  })();
  runMap.set(runKey, runPromise);
  try {
    await runPromise;
  } finally {
    runMap.set(runKey, runPromise);
  }
}
function getReindexMarkerPath(cwd, command) {
  return import_node_path5.default.join(cwd, ".next", "cache", `nextjs-pinecone-search-${command}.run-key`);
}
function getProcessGroupId() {
  try {
    const value = (0, import_node_child_process.execFileSync)("ps", ["-o", "pgid=", "-p", String(process.pid)], {
      encoding: "utf8"
    }).trim();
    if (value) {
      return value;
    }
  } catch {
  }
  return String(process.ppid);
}
async function hasReindexedInProcessGroup(cwd, command, runKey) {
  const markerPath = getReindexMarkerPath(cwd, command);
  await import_promises3.default.mkdir(import_node_path5.default.dirname(markerPath), { recursive: true });
  try {
    const existingKey = (await import_promises3.default.readFile(markerPath, "utf8")).trim();
    if (existingKey === runKey) {
      return true;
    }
  } catch {
  }
  await import_promises3.default.writeFile(markerPath, runKey);
  return false;
}
function withPineconeSearch(nextConfig, options = {}) {
  return async (phase, context) => {
    const resolvedConfig = typeof nextConfig === "function" ? await nextConfig(phase, context) : nextConfig;
    await runAutoReindexOnce(options);
    return resolvedConfig;
  };
}

// src/route.ts
function createPineconeSearchRouteHandler(serviceOrOptions) {
  const service = "search" in serviceOrOptions ? serviceOrOptions : createPineconeSearchService(serviceOrOptions);
  return async function handler(request) {
    try {
      const body = await request.json();
      const search = body.search?.trim();
      const query = body.query?.trim();
      if (!search || !query) {
        return jsonResponse({ error: "Both `search` and `query` are required" }, 400);
      }
      const response = await service.search(search, query, {
        topK: body.topK,
        rerankTopN: body.rerankTopN
      });
      return jsonResponse(response, 200);
    } catch (error) {
      const message = error instanceof Error ? error.message : "Unknown error";
      return jsonResponse({ error: message }, 500);
    }
  };
}
function jsonResponse(data, status) {
  return new Response(JSON.stringify(data), {
    status,
    headers: {
      "content-type": "application/json"
    }
  });
}
// Annotate the CommonJS export names for ESM import in node:
0 && (module.exports = {
  PineconeSearchService,
  createPineconeSearchRouteHandler,
  createPineconeSearchService,
  definePineconeSearches,
  loadPineconeSearchConfig,
  withPineconeSearch
});
//# sourceMappingURL=index.cjs.map