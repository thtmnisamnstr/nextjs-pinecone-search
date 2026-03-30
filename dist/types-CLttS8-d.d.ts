type RebuildScope = "managed" | "all";
interface PineconeSearchSource {
    include: string[];
    exclude?: string[];
    routePrefix?: string;
}
interface PineconeNamedSearchInput {
    namespace: string;
    sources: PineconeSearchSource[];
}
interface PineconeNamedSearch {
    namespace: string;
    sources: PineconeSearchSource[];
}
interface ResolveUrlArgs {
    filePath: string;
    relativePath: string;
    searchName: string;
    frontmatter: Record<string, unknown>;
    routePrefix?: string;
}
interface ResolvedUrl {
    urlPath: string;
    url?: string;
}
type ResolveUrlFn = (args: ResolveUrlArgs) => ResolvedUrl;
interface PineconeSearchesDefinitionInput {
    searches: Record<string, PineconeNamedSearchInput>;
    siteUrl?: string;
    resolveUrl?: ResolveUrlFn;
    namespacePrefix?: string;
    rebuildScope?: RebuildScope;
    failOnReindexError?: boolean;
}
interface PineconeSearchesDefinition {
    searches: Record<string, PineconeNamedSearch>;
    siteUrl?: string;
    resolveUrl?: ResolveUrlFn;
    namespacePrefix: string;
    rebuildScope: RebuildScope;
    failOnReindexError: boolean;
}
interface ChunkOptions {
    maxTokens: number;
    overlapRatio: number;
}
interface Chunk {
    text: string;
    tokenCount: number;
    chunkIndex: number;
}
interface Logger {
    info: (message: string) => void;
    warn: (message: string) => void;
    error: (message: string) => void;
    debug?: (message: string) => void;
}
interface PineconeSearchServiceOptions {
    config: PineconeSearchesDefinition;
    cwd?: string;
    logger?: Logger;
    pineconeApiKey?: string;
    denseIndexName?: string;
    sparseIndexName?: string;
}
interface SearchOptions {
    topK?: number;
    rerankTopN?: number;
    candidateTopK?: number;
    rerankCandidateLimit?: number;
    filter?: Record<string, unknown>;
}
interface SearchResult {
    id: string;
    score: number;
    rrfScore: number;
    denseScore?: number;
    sparseScore?: number;
    searchName: string;
    namespace: string;
    sourcePath: string;
    urlPath: string;
    url?: string;
    title?: string;
    chunkIndex: number;
    snippet: string;
}
interface SearchResponse {
    results: SearchResult[];
    query: string;
    search: string;
}
interface WithPineconeSearchOptions {
    config?: PineconeSearchesDefinition;
    configPath?: string;
    cwd?: string;
    logger?: Logger;
}

export type { Chunk as C, Logger as L, PineconeSearchesDefinitionInput as P, RebuildScope as R, SearchOptions as S, WithPineconeSearchOptions as W, PineconeSearchesDefinition as a, PineconeSearchServiceOptions as b, SearchResponse as c, ChunkOptions as d, PineconeNamedSearch as e, PineconeNamedSearchInput as f, PineconeSearchSource as g, ResolveUrlArgs as h, ResolveUrlFn as i, ResolvedUrl as j, SearchResult as k };
