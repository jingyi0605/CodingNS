import path from "node:path";

import { afterEach, describe, expect, it } from "vitest";

import { getAffairsLibraryDebugLogPath } from "../../../src/modules/workspace/affairs-library-debug-log.js";

describe("affairs-library-debug-log", () => {
  const originalNodeEnv = process.env.NODE_ENV;
  const originalLogDir = process.env.CODINGNS_AFFAIRS_DEBUG_LOG_DIR;

  afterEach(() => {
    if (originalNodeEnv === undefined) {
      delete process.env.NODE_ENV;
    } else {
      process.env.NODE_ENV = originalNodeEnv;
    }

    if (originalLogDir === undefined) {
      delete process.env.CODINGNS_AFFAIRS_DEBUG_LOG_DIR;
    } else {
      process.env.CODINGNS_AFFAIRS_DEBUG_LOG_DIR = originalLogDir;
    }
  });

  it("默认会把调试日志写到仓库根目录的 tmp/logs", () => {
    process.env.NODE_ENV = "development";
    delete process.env.CODINGNS_AFFAIRS_DEBUG_LOG_DIR;

    const logPath = getAffairsLibraryDebugLogPath();

    expect(logPath).toBe(path.resolve("/Users/jackson/Code/CodingNS/tmp/logs/affairs-library-debug.log"));
  });
});
