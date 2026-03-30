import { describe, expect, test } from "vitest";

import { chunkDocumentByParagraphs, countTextTokens, trimForRerank } from "../src/chunking";

describe("chunking", () => {
  test("paragraph chunking enforces token ceiling", () => {
    const text = [
      "Paragraph one has enough words to make token counts non-trivial for tests.",
      "Paragraph two should overlap into later chunks when overlap is enabled.",
      "Paragraph three keeps the chunker busy and confirms chunk boundaries.",
      "Paragraph four exists to force at least three chunks from this input."
    ].join("\n\n");

    const chunks = chunkDocumentByParagraphs(text, {
      maxTokens: 30,
      overlapRatio: 0.2
    });

    expect(chunks.length).toBeGreaterThan(1);
    for (const chunk of chunks) {
      expect(chunk.tokenCount).toBeLessThanOrEqual(30);
      expect(chunk.text.length).toBeGreaterThan(0);
    }

    expect(chunks[0].chunkIndex).toBe(0);
    expect(chunks[1].chunkIndex).toBe(1);
  });

  test("rerank text trimming stays in budget", () => {
    const long = new Array(600).fill("token").join(" ");
    const trimmed = trimForRerank(long, 120);
    expect(countTextTokens(trimmed)).toBeLessThanOrEqual(120);
    expect(trimmed.length).toBeGreaterThan(0);
  });
});
