import { countTokens } from "gpt-tokenizer";

import type { Chunk, ChunkOptions } from "./types";
import { trimToTokenBudget } from "./utils";

const SENTENCE_SPLIT_REGEX = /(?<=[.!?])\s+/;

function normalizeBody(content: string): string {
  return content.replace(/\r\n/g, "\n").trim();
}

function tokenizeCount(text: string): number {
  return countTokens(text);
}

function splitByParagraphs(content: string): string[] {
  const normalized = normalizeBody(content);
  if (!normalized) {
    return [];
  }

  return normalized
    .split(/\n{2,}/)
    .map((value) => value.trim())
    .filter(Boolean);
}

function splitOversizedByWords(text: string, maxTokens: number): string[] {
  const words = text.split(/\s+/).filter(Boolean);
  if (words.length === 0) {
    return [];
  }

  const chunks: string[] = [];
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
      // If a single tokenized word still exceeds the budget, force emit it.
      chunks.push(words[cursor]);
      cursor += 1;
      continue;
    }

    chunks.push(words.slice(cursor, best).join(" "));
    cursor = best;
  }

  return chunks.filter(Boolean);
}

function splitOversizedParagraph(paragraph: string, maxTokens: number): string[] {
  const sentenceCandidates = paragraph
    .split(SENTENCE_SPLIT_REGEX)
    .map((value) => value.trim())
    .filter(Boolean);

  if (sentenceCandidates.length <= 1) {
    return splitOversizedByWords(paragraph, maxTokens);
  }

  const normalizedSentences = sentenceCandidates.flatMap((sentence) => {
    if (tokenizeCount(sentence) <= maxTokens) {
      return [sentence];
    }
    return splitOversizedByWords(sentence, maxTokens);
  });

  const units: string[] = [];
  let current: string[] = [];
  let currentTokens = 0;

  for (const sentence of normalizedSentences) {
    const sentenceTokens = tokenizeCount(sentence);
    if (sentenceTokens > maxTokens) {
      // final fallback for pathological text
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

function toBoundedUnits(content: string, maxTokens: number): { text: string; tokens: number }[] {
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

export function chunkDocumentByParagraphs(content: string, options: ChunkOptions): Chunk[] {
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

  const chunks: Chunk[] = [];

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

export function trimForRerank(text: string, maxTokens = 700): string {
  return trimToTokenBudget(text, maxTokens, tokenizeCount);
}

export function countTextTokens(text: string): number {
  return tokenizeCount(text);
}
