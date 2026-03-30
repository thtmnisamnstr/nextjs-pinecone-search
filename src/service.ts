import path from "node:path";

import { Pinecone } from "@pinecone-database/pinecone";
import type { IndexModel } from "@pinecone-database/pinecone";

import { countTextTokens, chunkDocumentByParagraphs, trimForRerank } from "./chunking";
import { resolveUrlForDocument } from "./config";
import { discoverSearchDocuments } from "./documents";
import type {
  Logger,
  PineconeSearchServiceOptions,
  PineconeSearchesDefinition,
  SearchOptions,
  SearchResponse,
  SearchResult
} from "./types";
import {
  DEFAULT_DENSE_MODEL,
  DEFAULT_MAX_SEQUENCE_LENGTH,
  DEFAULT_RERANK_MODEL,
  DEFAULT_SPARSE_MODEL,
  RERANK_MAX_DOCS,
  RERANK_PAIR_MAX_TOKENS,
  applyNamespacePrefix,
  defaultLogger,
  mapWithConcurrency,
  sha256,
  sleep,
  toPosixPath,
  trimToTokenBudget,
  withRetry
} from "./utils";

const DENSE_FIELD_MAP = { text: "chunk_text" };
const SPARSE_FIELD_MAP = { text: "chunk_text" };
const SPARSE_RW_PARAMS = { max_tokens_per_sequence: 2048 };

const DEFAULT_TOP_K = 10;
const DEFAULT_RRF_K = 60;
const SPARSE_INGEST_CONCURRENCY = 1;
const DENSE_INGEST_CONCURRENCY = 1;
const READY_TIMEOUT_MS = 180_000;
const READY_POLL_MS = 2_000;
const RERANK_PAIR_SAFETY_MARGIN = 192;
const RERANK_PAIR_RETRY_SAFETY_MARGIN = 320;

interface InternalRecord {
  _id: string;
  chunk_text: string;
  rerank_text: string;
  searchName: string;
  namespace: string;
  sourcePath: string;
  urlPath: string;
  url?: string;
  title?: string;
  chunkIndex: number;
}

interface Candidate {
  id: string;
  denseScore?: number;
  sparseScore?: number;
  rrfScore: number;
  searchName: string;
  namespace: string;
  sourcePath: string;
  urlPath: string;
  url?: string;
  title?: string;
  chunkIndex: number;
  snippet: string;
  rerankText: string;
}

interface SearchHit {
  _id: string;
  _score: number;
  fields: unknown;
}

interface NamespaceIndex {
  upsertRecords(records: InternalRecord[]): Promise<void>;
  searchRecords(payload: {
    query: {
      topK: number;
      inputs: { text: string };
      filter?: Record<string, unknown>;
    };
    fields: string[];
  }): Promise<{ result: { hits: SearchHit[] } }>;
}

interface IndexNamespaceStats {
  namespaces?: Record<string, { recordCount: number }>;
}

export interface ReindexSummary {
  denseIndex: string;
  sparseIndex: string;
  namespaces: Record<string, number>;
}

export class PineconeSearchService {
  private readonly config: PineconeSearchesDefinition;
  private readonly cwd: string;
  private readonly logger: Logger;
  private readonly pc: Pinecone;
  private readonly denseIndexName: string;
  private readonly sparseIndexName: string;

  private maxSequenceLength = DEFAULT_MAX_SEQUENCE_LENGTH;

  constructor(options: PineconeSearchServiceOptions) {
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
    this.cwd = options.cwd ? path.resolve(options.cwd) : process.cwd();
    this.logger = options.logger ?? defaultLogger;
    this.pc = new Pinecone({ apiKey });
  }

  async reindexAll(): Promise<ReindexSummary> {
    this.logger.info("[nextjs-pinecone-search] starting full reindex");

    await this.hydrateModelLimits();
    await this.ensureIndexes();

    const denseIndex = this.pc.index(this.denseIndexName);
    const sparseIndex = this.pc.index(this.sparseIndexName);

    await this.deleteNamespacesForRebuild(denseIndex, sparseIndex);

    const namespaceRecordCounts: Record<string, number> = {};

    for (const [searchName, searchDefinition] of Object.entries(this.config.searches)) {
      const managedNamespace = this.getNamespace(searchDefinition.namespace);
      const documents = await discoverSearchDocuments(searchDefinition, this.cwd);

      const records: InternalRecord[] = [];

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

        const sourcePath = toPosixPath(path.relative(this.cwd, document.filePath));

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
          `[nextjs-pinecone-search] search \"${searchName}\" produced 0 records for namespace \"${managedNamespace}\"`
        );
        continue;
      }

      await Promise.all([
        this.upsertRecordsToIndex(
          denseIndex.namespace(managedNamespace) as unknown as NamespaceIndex,
          records,
          DENSE_INGEST_CONCURRENCY,
          "dense"
        ),
        this.upsertRecordsToIndex(
          sparseIndex.namespace(managedNamespace) as unknown as NamespaceIndex,
          records,
          SPARSE_INGEST_CONCURRENCY,
          "sparse"
        )
      ]);

      this.logger.info(
        `[nextjs-pinecone-search] indexed ${records.length} chunks for search \"${searchName}\" into namespace \"${managedNamespace}\"`
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

  async search(searchName: string, query: string, options: SearchOptions = {}): Promise<SearchResponse> {
    const searchDef = this.config.searches[searchName];
    if (!searchDef) {
      throw new Error(`[nextjs-pinecone-search] Unknown search \"${searchName}\"`);
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

    const denseIndex = this.pc.index(this.denseIndexName).namespace(namespace) as unknown as NamespaceIndex;
    const sparseIndex = this.pc.index(this.sparseIndexName).namespace(namespace) as unknown as NamespaceIndex;

    const [denseResponse, sparseResponse] = await Promise.all([
      withRetry(
        () =>
          denseIndex.searchRecords({
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
        () =>
          sparseIndex.searchRecords({
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

    let ranked: Candidate[];
    if (rerankInputs.length > 0 && rerankTopN > 0) {
      try {
        const rerankResponse = await this.runRerank(query, rerankInputs, rerankTopN, "rerank");

        const reranked = rerankResponse.data
          .map((item) => {
            const candidate = rerankInputs[item.index]?.candidate;
            if (!candidate) {
              return undefined;
            }
            return {
              candidate,
              rerankScore: item.score
            };
          })
          .filter((value): value is { candidate: Candidate; rerankScore: number } => Boolean(value))
          .sort((a, b) => b.rerankScore - a.rerankScore)
          .slice(0, rerankTopN);

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
              const reranked = rerankResponse.data
                .map((item) => {
                  const candidate = tighterInputs[item.index]?.candidate;
                  if (!candidate) {
                    return undefined;
                  }
                  return {
                    candidate,
                    rerankScore: item.score
                  };
                })
                .filter((value): value is { candidate: Candidate; rerankScore: number } => Boolean(value))
                .sort((a, b) => b.rerankScore - a.rerankScore)
                .slice(0, tighterTopN);

              ranked = reranked.map((item) => ({
                ...item.candidate,
                rrfScore: item.rerankScore
              }));
            } catch (retryError) {
              this.logger.warn(
                `[nextjs-pinecone-search] rerank retry failed for search \"${searchName}\", falling back to hybrid RRF ordering: ${(retryError as Error).message}`
              );
              ranked = candidates.slice(0, topK);
            }
          } else {
            ranked = candidates.slice(0, topK);
          }
        } else {
          this.logger.warn(
            `[nextjs-pinecone-search] rerank failed for search \"${searchName}\", falling back to hybrid RRF ordering: ${(error as Error).message}`
          );
          ranked = candidates.slice(0, topK);
        }
      }
    } else {
      ranked = candidates.slice(0, topK);
    }

    const results: SearchResult[] = ranked.slice(0, topK).map((candidate) => ({
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

  private async upsertRecordsToIndex(
    namespaceIndex: NamespaceIndex,
    records: InternalRecord[],
    concurrency: number,
    flavor: "dense" | "sparse"
  ): Promise<void> {
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

  private async runRerank(
    query: string,
    inputs: Array<{ candidate: Candidate; rerankText: string }>,
    topN: number,
    label: string
  ) {
    return withRetry(
      () =>
        this.pc.inference.rerank(
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

  private createRerankText(text: string): string {
    const budget = Math.max(256, RERANK_PAIR_MAX_TOKENS - 224);
    const trimmed = trimForRerank(text, budget);
    if (trimmed) {
      return trimmed;
    }
    return trimToTokenBudget(text, budget, countTextTokens);
  }

  private getNamespace(rawNamespace: string): string {
    return applyNamespacePrefix(this.config.namespacePrefix, rawNamespace);
  }

  private async hydrateModelLimits(): Promise<void> {
    try {
      const model = await this.pc.inference.getModel(DEFAULT_DENSE_MODEL);
      this.maxSequenceLength = Math.min(model.maxSequenceLength ?? DEFAULT_MAX_SEQUENCE_LENGTH, DEFAULT_MAX_SEQUENCE_LENGTH);
    } catch (error) {
      this.logger.warn(
        `[nextjs-pinecone-search] could not fetch model metadata for ${DEFAULT_DENSE_MODEL}, using defaults (${DEFAULT_MAX_SEQUENCE_LENGTH}): ${(error as Error).message}`
      );
      this.maxSequenceLength = DEFAULT_MAX_SEQUENCE_LENGTH;
    }
  }

  private async ensureIndexes(): Promise<void> {
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

  private resolveCloudRegion(
    denseExisting?: IndexModel,
    sparseExisting?: IndexModel
  ): { cloud: "aws" | "gcp" | "azure"; region: string } {
    const candidates = [denseExisting, sparseExisting].filter(Boolean) as IndexModel[];

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

  private async ensureSingleIndex(input: {
    existing?: IndexModel;
    name: string;
    model: string;
    expectedFieldMap: Record<string, string>;
    location: { cloud: "aws" | "gcp" | "azure"; region: string };
    isSparse: boolean;
  }): Promise<void> {
    if (!input.existing) {
      this.logger.info(`[nextjs-pinecone-search] creating missing index \"${input.name}\" for model \"${input.model}\"`);
      await withRetry(
        () =>
          this.pc.createIndexForModel({
            name: input.name,
            cloud: input.location.cloud,
            region: input.location.region,
            waitUntilReady: true,
            suppressConflicts: true,
            embed: {
              model: input.model,
              fieldMap: input.expectedFieldMap,
              ...(input.isSparse
                ? {
                    readParameters: SPARSE_RW_PARAMS,
                    writeParameters: SPARSE_RW_PARAMS
                  }
                : {})
            }
          }),
        { logger: this.logger, label: `create index ${input.name}` }
      );
      return;
    }

    if (!input.existing.spec?.serverless) {
      throw new Error(
        `[nextjs-pinecone-search] index \"${input.name}\" is not serverless. This package only supports serverless indexes.`
      );
    }

    const existingModel = input.existing.embed?.model;
    if (existingModel !== input.model) {
      throw new Error(
        `[nextjs-pinecone-search] index \"${input.name}\" is integrated with model \"${existingModel ?? "unknown"}\", expected \"${input.model}\". Create a dedicated index or update env vars.`
      );
    }

    const currentFieldMap = input.existing.embed?.fieldMap as Record<string, unknown> | undefined;
    const currentField = typeof currentFieldMap?.text === "string" ? currentFieldMap.text : undefined;

    const needsFieldMapUpdate = currentField !== input.expectedFieldMap.text;

    const embedPatch: {
      fieldMap?: Record<string, string>;
      readParameters?: Record<string, unknown>;
      writeParameters?: Record<string, unknown>;
    } = {};

    if (needsFieldMapUpdate) {
      embedPatch.fieldMap = input.expectedFieldMap;
    }

    if (input.isSparse) {
      const readParams = (input.existing.embed?.readParameters ?? {}) as Record<string, unknown>;
      const writeParams = (input.existing.embed?.writeParameters ?? {}) as Record<string, unknown>;

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
      this.logger.info(`[nextjs-pinecone-search] configuring index \"${input.name}\" embed settings`);
      await withRetry(
        () => this.pc.configureIndex(input.name, { embed: embedPatch }),
        { logger: this.logger, label: `configure index ${input.name}` }
      );
    }
  }

  private async listAllNamespaces(indexName: string): Promise<string[]> {
    const index = this.pc.index(indexName);
    const namespaces = new Set<string>();
    let paginationToken: string | undefined;

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

  private async deleteNamespacesForRebuild(
    denseIndex: ReturnType<Pinecone["index"]>,
    sparseIndex: ReturnType<Pinecone["index"]>
  ): Promise<void> {
    let targets: string[];

    if (this.config.rebuildScope === "all") {
      const [denseNamespaces, sparseNamespaces] = await Promise.all([
        this.listAllNamespaces(this.denseIndexName),
        this.listAllNamespaces(this.sparseIndexName)
      ]);
      targets = Array.from(new Set([...denseNamespaces, ...sparseNamespaces]));
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

  private async deleteNamespaces(index: ReturnType<Pinecone["index"]>, targets: string[], indexName: string): Promise<void> {
    for (const namespace of targets) {
      try {
        await withRetry(
          () => index.deleteNamespace(namespace),
          { logger: this.logger, label: `delete namespace ${indexName}/${namespace}` }
        );
      } catch (error) {
        const message = (error as Error).message;
        if (message.includes("404") || message.toLowerCase().includes("not found")) {
          continue;
        }
        throw error;
      }
    }
  }

  private async waitForNamespaceCounts(
    index: ReturnType<Pinecone["index"]>,
    expected: Record<string, number>,
    indexName: string
  ): Promise<void> {
    const targetNamespaces = Object.entries(expected).filter(([, count]) => count > 0);
    if (targetNamespaces.length === 0) {
      return;
    }

    const startedAt = Date.now();

    while (true) {
      const stats = (await withRetry(() => index.describeIndexStats(), {
        logger: this.logger,
        label: `describe index stats ${indexName}`
      })) as IndexNamespaceStats;

      const ready = targetNamespaces.every(([namespace, expectedCount]) => {
        const actual = stats.namespaces?.[namespace]?.recordCount ?? 0;
        return actual >= expectedCount;
      });

      if (ready) {
        return;
      }

      if (Date.now() - startedAt > READY_TIMEOUT_MS) {
        throw new Error(
          `[nextjs-pinecone-search] timed out waiting for index \"${indexName}\" namespace counts to match expected values`
        );
      }

      await sleep(READY_POLL_MS);
    }
  }
}

export function createPineconeSearchService(options: PineconeSearchServiceOptions): PineconeSearchService {
  return new PineconeSearchService(options);
}

function buildRerankInputs(
  query: string,
  candidates: Candidate[],
  safetyMargin = RERANK_PAIR_SAFETY_MARGIN
): Array<{ candidate: Candidate; rerankText: string }> {
  const queryTokens = countTextTokens(query);
  const pairTokenBudget = Math.max(1, RERANK_PAIR_MAX_TOKENS - safetyMargin);
  const maxDocumentTokens = pairTokenBudget - queryTokens;

  if (maxDocumentTokens <= 0) {
    return [];
  }

  return candidates
    .map((candidate) => {
      let rerankText = trimToTokenBudget(candidate.rerankText, maxDocumentTokens, countTextTokens);
      let remainingBudget = maxDocumentTokens;

      for (let i = 0; i < 6 && rerankText; i += 1) {
        const pairTokens = countTextTokens(`${query}\n${rerankText}`);
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
    })
    .filter((value) => value.rerankText.length > 0);
}

function isRerankPairLimitError(error: unknown): boolean {
  if (!(error instanceof Error)) {
    return false;
  }
  const message = error.message.toLowerCase();
  return (
    message.includes("query+document pair") &&
    message.includes("exceeds the maximum token limit") &&
    message.includes("1024")
  );
}

function dedupeCandidates(candidates: Candidate[]): Candidate[] {
  const seen = new Set<string>();
  const deduped: Candidate[] = [];

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

function mergeHybridHits(
  denseHits: SearchHit[],
  sparseHits: SearchHit[],
  rrfK: number,
  searchName: string,
  namespace: string
): Candidate[] {
  const candidateMap = new Map<string, Candidate>();

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

function baseCandidateFromFields(
  id: string,
  fields: Record<string, unknown>,
  searchName: string,
  namespace: string
): Candidate {
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

function toFields(value: unknown): Record<string, unknown> {
  if (!value || typeof value !== "object") {
    return {};
  }
  return value as Record<string, unknown>;
}

function stringOrEmpty(value: unknown): string {
  return typeof value === "string" ? value : "";
}

function stringOrUndefined(value: unknown): string | undefined {
  return typeof value === "string" ? value : undefined;
}

function numberOrDefault(value: unknown, fallback: number): number {
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

function toNumber(value: unknown): number | undefined {
  if (typeof value === "number") {
    return value;
  }
  if (typeof value === "string") {
    const parsed = Number(value);
    if (Number.isFinite(parsed)) {
      return parsed;
    }
  }
  return undefined;
}

export const __internal = {
  buildRerankInputs,
  dedupeCandidates,
  mergeHybridHits,
  baseCandidateFromFields,
  toNumber
};
