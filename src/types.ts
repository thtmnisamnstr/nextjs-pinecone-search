export type RebuildScope = "managed" | "all";

export interface PineconeSearchSource {
  include: string[];
  exclude?: string[];
  routePrefix?: string;
}

export interface PineconeNamedSearchInput {
  namespace: string;
  sources: PineconeSearchSource[];
}

export interface PineconeNamedSearch {
  namespace: string;
  sources: PineconeSearchSource[];
}

export interface ResolveUrlArgs {
  filePath: string;
  relativePath: string;
  searchName: string;
  frontmatter: Record<string, unknown>;
  routePrefix?: string;
}

export interface ResolvedUrl {
  urlPath: string;
  url?: string;
}

export type ResolveUrlFn = (args: ResolveUrlArgs) => ResolvedUrl;

export interface PineconeSearchesDefinitionInput {
  searches: Record<string, PineconeNamedSearchInput>;
  siteUrl?: string;
  resolveUrl?: ResolveUrlFn;
  namespacePrefix?: string;
  rebuildScope?: RebuildScope;
  failOnReindexError?: boolean;
}

export interface PineconeSearchesDefinition {
  searches: Record<string, PineconeNamedSearch>;
  siteUrl?: string;
  resolveUrl?: ResolveUrlFn;
  namespacePrefix: string;
  rebuildScope: RebuildScope;
  failOnReindexError: boolean;
}

export interface PineconeRecordMetadata {
  searchName: string;
  namespace: string;
  sourcePath: string;
  urlPath: string;
  url?: string;
  title?: string;
  chunkIndex: number;
  chunk_text: string;
  rerank_text: string;
}

export interface ChunkOptions {
  maxTokens: number;
  overlapRatio: number;
}

export interface Chunk {
  text: string;
  tokenCount: number;
  chunkIndex: number;
}

export interface ReindexOptions {
  cwd?: string;
  logger?: Logger;
}

export interface Logger {
  info: (message: string) => void;
  warn: (message: string) => void;
  error: (message: string) => void;
  debug?: (message: string) => void;
}

export interface PineconeSearchServiceOptions {
  config: PineconeSearchesDefinition;
  cwd?: string;
  logger?: Logger;
  pineconeApiKey?: string;
  denseIndexName?: string;
  sparseIndexName?: string;
}

export interface SearchOptions {
  topK?: number;
  rerankTopN?: number;
  candidateTopK?: number;
  rerankCandidateLimit?: number;
  filter?: Record<string, unknown>;
}

export interface SearchResult {
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

export interface SearchResponse {
  results: SearchResult[];
  query: string;
  search: string;
}

export interface WithPineconeSearchOptions {
  config?: PineconeSearchesDefinition;
  configPath?: string;
  cwd?: string;
  logger?: Logger;
}

export interface SearchFileDocument {
  filePath: string;
  relativePath: string;
  frontmatter: Record<string, unknown>;
  body: string;
  title?: string;
  routePrefix?: string;
}
