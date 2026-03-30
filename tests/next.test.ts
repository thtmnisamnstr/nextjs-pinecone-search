import { afterEach, describe, expect, test } from "vitest";

import { getNextCommandForTesting, resetAutoReindexStateForTesting } from "../src/next";

describe("next command detection", () => {
  const originalArgv = [...process.argv];
  const originalLifecycle = process.env.npm_lifecycle_event;

  afterEach(() => {
    process.argv = [...originalArgv];
    if (originalLifecycle === undefined) {
      delete process.env.npm_lifecycle_event;
    } else {
      process.env.npm_lifecycle_event = originalLifecycle;
    }
    resetAutoReindexStateForTesting();
  });

  test("detects next build", () => {
    process.argv = ["node", "next", "build"];
    expect(getNextCommandForTesting()).toBe("build");
  });

  test("detects next dev", () => {
    process.argv = ["node", "next", "dev"];
    expect(getNextCommandForTesting()).toBe("dev");
  });

  test("detects next typegen", () => {
    process.argv = ["node", "next", "typegen"];
    expect(getNextCommandForTesting()).toBe("typegen");
  });

  test("falls back to npm lifecycle event when argv is not explicit", () => {
    process.argv = ["node", "some-script.js"];
    process.env.npm_lifecycle_event = "next:build";
    expect(getNextCommandForTesting()).toBe("build");
  });

  test("returns null for non-next commands", () => {
    process.argv = ["node", "some-script.js"];
    process.env.npm_lifecycle_event = "lint";
    expect(getNextCommandForTesting()).toBe(null);
  });
});
