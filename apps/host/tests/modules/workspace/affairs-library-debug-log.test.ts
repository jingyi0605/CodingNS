import fs from "node:fs";
import os from "node:os";
import path from "node:path";

import { afterEach, describe, expect, it } from "vitest";

import {
  getAffairsLibraryDebugLogPath,
  writeAffairsLibraryDebugLog
} from "../../../src/modules/workspace/affairs-library-debug-log.js";

describe("affairs-library-debug-log", () => {
  const originalNodeEnv = process.env.NODE_ENV;
  const originalLogDir = process.env.CODINGNS_AFFAIRS_DEBUG_LOG_DIR;
  const originalLogLevel = process.env.DOC_SEMANTIC_INDEX_LOG_LEVEL;

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

    if (originalLogLevel === undefined) {
      delete process.env.DOC_SEMANTIC_INDEX_LOG_LEVEL;
    } else {
      process.env.DOC_SEMANTIC_INDEX_LOG_LEVEL = originalLogLevel;
    }
  });

  it("默认不生成事务文档库调试日志文件", () => {
    process.env.NODE_ENV = "development";
    delete process.env.DOC_SEMANTIC_INDEX_LOG_LEVEL;
    delete process.env.CODINGNS_AFFAIRS_DEBUG_LOG_DIR;

    const rootDir = fs.mkdtempSync(path.join(os.tmpdir(), "affairs-library-debug-log-"));
    const logPath = path.join(rootDir, "affairs-library-debug.log");

    writeAffairsLibraryDebugLog({
      event: "test_event",
      rootDir,
    });

    expect(getAffairsLibraryDebugLogPath(rootDir)).toBeNull();
    expect(fs.existsSync(logPath)).toBe(false);
  });

  it("开启 debug 后会把调试日志写到仓库根目录的 tmp/logs", () => {
    process.env.NODE_ENV = "development";
    process.env.DOC_SEMANTIC_INDEX_LOG_LEVEL = "debug";
    delete process.env.CODINGNS_AFFAIRS_DEBUG_LOG_DIR;

    const logPath = getAffairsLibraryDebugLogPath();

    expect(logPath).toBe(path.resolve("/Users/jackson/Code/CodingNS/tmp/logs/affairs-library-debug.log"));
  });
});
