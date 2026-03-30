import { execFileSync } from "node:child_process";
import fs from "node:fs/promises";
import path from "node:path";

import { loadPineconeSearchConfig } from "./config";
import { createPineconeSearchService } from "./service";
import type { WithPineconeSearchOptions } from "./types";
import { defaultLogger } from "./utils";

type AnyNextConfig = Record<string, unknown>;
type NextConfigFactory = (phase: string, context: Record<string, unknown>) => AnyNextConfig | Promise<AnyNextConfig>;

const REINDEX_RUNS_KEY = "__nextjs_pinecone_search_reindex_runs__";
const REINDEX_ENV_KEY = "NEXTJS_PINECONE_SEARCH_REINDEX_RUN_KEY";

function getGlobalRunMap(): Map<string, Promise<void>> {
  const globalState = globalThis as typeof globalThis & {
    [REINDEX_RUNS_KEY]?: Map<string, Promise<void>>;
  };

  if (!globalState[REINDEX_RUNS_KEY]) {
    globalState[REINDEX_RUNS_KEY] = new Map<string, Promise<void>>();
  }

  return globalState[REINDEX_RUNS_KEY] as Map<string, Promise<void>>;
}

type NextCommand = "dev" | "build" | "typegen" | null;

function detectNextCommand(): NextCommand {
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

function shouldAutoReindex(command: NextCommand): command is Exclude<NextCommand, null> {
  return command === "dev" || command === "build";
}

async function runAutoReindexOnce(options: WithPineconeSearchOptions): Promise<void> {
  const cwd = path.resolve(options.cwd ?? process.cwd());
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
          `[nextjs-pinecone-search] reindex failed but failOnReindexError=false, continuing: ${(error as Error).message}`
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

function getReindexMarkerPath(cwd: string, command: Exclude<NextCommand, null>): string {
  return path.join(cwd, ".next", "cache", `nextjs-pinecone-search-${command}.run-key`);
}

function getProcessGroupId(): string {
  try {
    const value = execFileSync("ps", ["-o", "pgid=", "-p", String(process.pid)], {
      encoding: "utf8"
    }).trim();
    if (value) {
      return value;
    }
  } catch {
    // fall through
  }

  return String(process.ppid);
}

async function hasReindexedInProcessGroup(
  cwd: string,
  command: Exclude<NextCommand, null>,
  runKey: string
): Promise<boolean> {
  const markerPath = getReindexMarkerPath(cwd, command);
  await fs.mkdir(path.dirname(markerPath), { recursive: true });

  try {
    const existingKey = (await fs.readFile(markerPath, "utf8")).trim();
    if (existingKey === runKey) {
      return true;
    }
  } catch {
    // Marker does not exist yet.
  }

  await fs.writeFile(markerPath, runKey);
  return false;
}

export function withPineconeSearch(
  nextConfig: AnyNextConfig | NextConfigFactory,
  options: WithPineconeSearchOptions = {}
): NextConfigFactory {
  return async (phase: string, context: Record<string, unknown>) => {
    const resolvedConfig =
      typeof nextConfig === "function"
        ? await (nextConfig as NextConfigFactory)(phase, context)
        : nextConfig;

    await runAutoReindexOnce(options);

    return resolvedConfig;
  };
}

export function getNextCommandForTesting(): NextCommand {
  return detectNextCommand();
}

export function resetAutoReindexStateForTesting(): void {
  getGlobalRunMap().clear();
}
