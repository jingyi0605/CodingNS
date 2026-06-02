import fs from "node:fs";
import os from "node:os";
import path from "node:path";

import { describe, expect, it } from "vitest";

import { runAffairsIndexerCommand } from "../../src/modules/affairs-indexer/internal-command-runner.js";
import { acquireAffairsIndexerRootLock } from "../../src/modules/affairs-indexer/core/src/utils/root-command-lock.js";

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

  it("index 失败时会把当前 tag 统计附带到错误详情里", async () => {
    const rootDir = fs.mkdtempSync(path.join(os.tmpdir(), "affairs-index-command-failure-"));
    const aiIndexDir = path.join(rootDir, ".ai-index");
    fs.mkdirSync(aiIndexDir, { recursive: true });
    fs.writeFileSync(path.join(rootDir, "示例文档.md"), "# 标题\n\n测试文档。\n", "utf8");
    fs.writeFileSync(
      path.join(aiIndexDir, "runtime-status.json"),
      JSON.stringify({ version: 1, status: "idle", stage: "finished" }),
      "utf8",
    );

    const { TextIndexer } = await import("../../src/modules/affairs-indexer/core/src/services/indexer/text-indexer.js");
    const original = TextIndexer.prototype.index;
    TextIndexer.prototype.index = async function patchedIndex(...args: Parameters<typeof original>) {
      await original.apply(this, args);
      throw new Error("FOREIGN KEY constraint failed");
    };

    try {
      await expect(runAffairsIndexerCommand(rootDir, "index")).rejects.toSatisfy((error: unknown) => {
        if (!(error instanceof Error) || !("data" in error)) {
          return false;
        }
        const data = (error as Error & { data?: Record<string, unknown> }).data;
        const details = data?.details as Record<string, unknown> | undefined;
        return typeof details?.tagCount === "number"
          && typeof details.documentTagCount === "number"
          && typeof details.derivedTagCount === "number";
      });
    } finally {
      TextIndexer.prototype.index = original;
      fs.rmSync(rootDir, { recursive: true, force: true });
    }
  });

  it("同一 rootDir 被别的进程锁住时会等待释放后再执行", async () => {
    const rootDir = fs.mkdtempSync(path.join(os.tmpdir(), "affairs-index-command-lock-"));
    const documentPath = path.join(rootDir, "等待文档.md");
    fs.writeFileSync(documentPath, "# 标题\n\n这是一个测试文档。\n", "utf8");
    const lock = await acquireAffairsIndexerRootLock(rootDir, "index", {
      reason: "test_lock_holder",
    });

    try {
      const startedAt = Date.now();
      const pending = runAffairsIndexerCommand(rootDir, "index");
      await new Promise((resolve) => setTimeout(resolve, 700));
      lock.release();
      const result = await pending;

      expect(Date.now() - startedAt).toBeGreaterThanOrEqual(500);
      expect(result.command).toBe("index");
    } finally {
      fs.rmSync(rootDir, { recursive: true, force: true });
    }
  });
});
