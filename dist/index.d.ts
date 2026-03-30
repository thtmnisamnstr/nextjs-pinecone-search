import { P as PineconeSearchesDefinitionInput, a as PineconeSearchesDefinition, W as WithPineconeSearchOptions, b as PineconeSearchServiceOptions, S as SearchOptions, c as SearchResponse } from './types-CLttS8-d.js';
export { C as Chunk, d as ChunkOptions, L as Logger, e as PineconeNamedSearch, f as PineconeNamedSearchInput, g as PineconeSearchSource, R as RebuildScope, h as ResolveUrlArgs, i as ResolveUrlFn, j as ResolvedUrl, k as SearchResult } from './types-CLttS8-d.js';

declare function definePineconeSearches(input: PineconeSearchesDefinitionInput): PineconeSearchesDefinition;
declare function loadPineconeSearchConfig(options: Pick<WithPineconeSearchOptions, "config" | "configPath" | "cwd">): Promise<PineconeSearchesDefinition>;

type AnyNextConfig = Record<string, unknown>;
type NextConfigFactory = (phase: string, context: Record<string, unknown>) => AnyNextConfig | Promise<AnyNextConfig>;
declare function withPineconeSearch(nextConfig: AnyNextConfig | NextConfigFactory, options?: WithPineconeSearchOptions): NextConfigFactory;

interface ReindexSummary {
    denseIndex: string;
    sparseIndex: string;
    namespaces: Record<string, number>;
}
declare class PineconeSearchService {
    private readonly config;
    private readonly cwd;
    private readonly logger;
    private readonly pc;
    private readonly denseIndexName;
    private readonly sparseIndexName;
    private maxSequenceLength;
    constructor(options: PineconeSearchServiceOptions);
    reindexAll(): Promise<ReindexSummary>;
    search(searchName: string, query: string, options?: SearchOptions): Promise<SearchResponse>;
    private upsertRecordsToIndex;
    private runRerank;
    private createRerankText;
    private getNamespace;
    private hydrateModelLimits;
    private ensureIndexes;
    private resolveCloudRegion;
    private ensureSingleIndex;
    private listAllNamespaces;
    private deleteNamespacesForRebuild;
    private deleteNamespaces;
    private waitForNamespaceCounts;
}
declare function createPineconeSearchService(options: PineconeSearchServiceOptions): PineconeSearchService;

declare function createPineconeSearchRouteHandler(serviceOrOptions: PineconeSearchService | PineconeSearchServiceOptions): (request: Request) => Promise<Response>;

export { PineconeSearchService, PineconeSearchServiceOptions, PineconeSearchesDefinition, PineconeSearchesDefinitionInput, SearchOptions, SearchResponse, WithPineconeSearchOptions, createPineconeSearchRouteHandler, createPineconeSearchService, definePineconeSearches, loadPineconeSearchConfig, withPineconeSearch };
