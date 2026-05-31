import fs from "node:fs";
import os from "node:os";
import path from "node:path";

import { describe, expect, it } from "vitest";

import { runAffairsIndexerCommand } from "../../src/modules/affairs-indexer/internal-command-runner.js";

describe("runAffairsIndexerCommand", () => {
  it("index 命令会同时刷新静态导出状态", async () => {
    const rootDir = fs.mkdtempSync(path.join(os.tmpdir(), "affairs-index-command-"));
    const documentPath = path.join(rootDir, "示例文档.md");
    fs.writeFileSync(documentPath, "# 标题\n\n这是一个测试文档。\n", "utf8");

    try {
      const result = await runAffairsIndexerCommand(rootDir, "index");
      const payload = result.result as {
        indexResult?: { scannedCount?: number; indexedCount?: number };
        exportResult?: { exportedAt?: string };
      };
      const statusPath = path.join(rootDir, ".ai-index", "exports", "status.json");
      const statusFile = JSON.parse(fs.readFileSync(statusPath, "utf8")) as {
        exported_at?: string;
        document_count?: number;
      };

      expect(result.command).toBe("index");
      expect(payload.indexResult?.scannedCount).toBeGreaterThanOrEqual(1);
      expect(payload.indexResult?.indexedCount).toBeGreaterThanOrEqual(1);
      expect(payload.exportResult?.exportedAt).toBeTruthy();
      expect(statusFile.exported_at).toBe(payload.exportResult?.exportedAt);
      expect(statusFile.document_count).toBeGreaterThanOrEqual(1);
    } finally {
      fs.rmSync(rootDir, { recursive: true, force: true });
    }
  });
});
