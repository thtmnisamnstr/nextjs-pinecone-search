import crypto from "node:crypto";
import path from "node:path";

import type { Logger } from "./types";

export const DEFAULT_DENSE_MODEL = "multilingual-e5-large";
export const DEFAULT_SPARSE_MODEL = "pinecone-sparse-english-v0";
export const DEFAULT_RERANK_MODEL = "bge-reranker-v2-m3";

export const DEFAULT_MAX_SEQUENCE_LENGTH = 507;
export const DEFAULT_MAX_BATCH_SIZE = 96;
export const RERANK_MAX_DOCS = 100;
export const RERANK_PAIR_MAX_TOKENS = 1024;

export const DEFAULT_NAMESPACE_PREFIX = "nps";

export const defaultLogger: Logger = {
  info: (message) => console.info(message),
  warn: (message) => console.warn(message),
  error: (message) => console.error(message),
  debug: (message) => console.debug(message)
};

export function toPosixPath(value: string): string {
  return value.split(path.sep).join(path.posix.sep);
}

export function normalizeUrlPath(input: string): string {
  const pathLike = input.replace(/\\/g, "/").trim();
  const withLeadingSlash = pathLike.startsWith("/") ? pathLike : `/${pathLike}`;
  const squashed = withLeadingSlash.replace(/\/+/g, "/");
  const noTrailingSlash = squashed.length > 1 ? squashed.replace(/\/$/, "") : squashed;
  return noTrailingSlash || "/";
}

export function normalizeNamespacePrefix(prefix?: string): string {
  if (!prefix) {
    return DEFAULT_NAMESPACE_PREFIX;
  }
  return prefix.trim().replace(/\s+/g, "-");
}

export function applyNamespacePrefix(prefix: string, namespace: string): string {
  const normalizedPrefix = normalizeNamespacePrefix(prefix);
  if (!normalizedPrefix) {
    return namespace;
  }
  if (namespace.startsWith(`${normalizedPrefix}-`)) {
    return namespace;
  }
  return `${normalizedPrefix}-${namespace}`;
}

export function chunkArray<T>(input: T[], chunkSize: number): T[][] {
  if (chunkSize <= 0) {
    throw new Error("chunkSize must be greater than 0");
  }

  const result: T[][] = [];
  for (let i = 0; i < input.length; i += chunkSize) {
    result.push(input.slice(i, i + chunkSize));
  }
  return result;
}

export function sha256(input: string): string {
  return crypto.createHash("sha256").update(input).digest("hex");
}

export function isRetryableError(error: unknown): boolean {
  if (!(error instanceof Error)) {
    return false;
  }

  const candidate = error as Error & {
    status?: number;
    statusCode?: number;
    response?: { status?: number };
    cause?: { status?: number; statusCode?: number; response?: { status?: number } };
  };

  const status =
    candidate.status ??
    candidate.statusCode ??
    candidate.response?.status ??
    candidate.cause?.status ??
    candidate.cause?.statusCode ??
    candidate.cause?.response?.status;

  if (status === 429) {
    return true;
  }

  if (typeof status === "number" && status >= 500 && status < 600) {
    return true;
  }

  const message = candidate.message.toLowerCase();
  return (
    message.includes("timed out") ||
    message.includes("econnreset") ||
    message.includes("connection") ||
    message.includes("resource_exhausted") ||
    message.includes("too many requests") ||
    message.includes("status\":429")
  );
}

export async function withRetry<T>(
  fn: () => Promise<T>,
  options: {
    retries?: number;
    initialDelayMs?: number;
    logger?: Logger;
    label?: string;
  } = {}
): Promise<T> {
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

export function sleep(ms: number): Promise<void> {
  return new Promise((resolve) => setTimeout(resolve, ms));
}

export async function mapWithConcurrency<T, R>(
  items: T[],
  concurrency: number,
  mapper: (item: T, index: number) => Promise<R>
): Promise<R[]> {
  if (concurrency <= 0) {
    throw new Error("concurrency must be greater than 0");
  }

  const results: R[] = new Array(items.length);
  let current = 0;

  async function worker(): Promise<void> {
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

export function maybeJoinUrl(siteUrl: string | undefined, urlPath: string): string | undefined {
  if (!siteUrl) {
    return undefined;
  }

  try {
    return new URL(urlPath, siteUrl).toString();
  } catch {
    return undefined;
  }
}

export function trimToTokenBudget(
  text: string,
  maxTokens: number,
  countTokens: (value: string) => number
): string {
  const clean = text.trim();
  if (!clean) {
    return "";
  }

  if (countTokens(clean) <= maxTokens) {
    return clean;
  }

  const words = clean.split(/\s+/);
  let low = 1;
  let high = words.length;
  let best = words[0] ?? "";

  while (low <= high) {
    const mid = Math.floor((low + high) / 2);
    const candidate = words.slice(0, mid).join(" ");
    if (countTokens(candidate) <= maxTokens) {
      best = candidate;
      low = mid + 1;
    } else {
      high = mid - 1;
    }
  }

  return best;
}
