import fs from "node:fs";
import os from "node:os";
import path from "node:path";

import { describe, expect, it, vi } from "vitest";

import { runAffairsIndexerCommand } from "../../src/modules/affairs-indexer/internal-command-runner.js";
import { acquireAffairsIndexerRootLock } from "../../src/modules/affairs-indexer/core/src/utils/root-command-lock.js";
import { CatalogRepository } from "../../src/modules/affairs-indexer/core/src/repositories/catalog-repository.js";
import { CatalogWriteRepository } from "../../src/modules/affairs-indexer/core/src/repositories/catalog-write-repository.js";
import { TagRecomputeService } from "../../src/modules/affairs-indexer/core/src/services/tagging/tag-recompute-service.js";
import { createAffairsIndexerRuntimeConfig } from "../../src/modules/affairs-indexer/internal-command-runner.js";
import { openDatabase } from "../../src/modules/affairs-indexer/core/src/sqlite/open-database.js";

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

  it("未变化文件不会重复解析，并会写出数量进度", async () => {
    const rootDir = fs.mkdtempSync(path.join(os.tmpdir(), "affairs-index-command-unchanged-"));
    const documentPath = path.join(rootDir, "未变化文档.md");
    fs.writeFileSync(documentPath, "# 标题\n\n这是一个测试文档。\n", "utf8");

    try {
      await runAffairsIndexerCommand(rootDir, "index");
      const dbPath = path.join(rootDir, ".ai-index", "catalog.db");
      const getLastSeenAt = (): string | null => {
        const db = openDatabase(dbPath);
        try {
          const row = db.prepare(`SELECT last_seen_at FROM files WHERE path = ?`).get("未变化文档.md") as {
            last_seen_at?: string | null;
          } | undefined;
          return row?.last_seen_at ?? null;
        } finally {
          db.close();
        }
      };
      const firstLastSeenAt = getLastSeenAt();

      await new Promise((resolve) => setTimeout(resolve, 20));
      const secondResult = await runAffairsIndexerCommand(rootDir, "index");
      const payload = secondResult.result as {
        indexResult?: {
          scannedCount?: number;
          indexedCount?: number;
          unchangedCount?: number;
        };
        exportSkipped?: boolean;
      };
      const runtimeStatusPath = path.join(rootDir, ".ai-index", "runtime-status.json");
      const runtimeStatus = JSON.parse(fs.readFileSync(runtimeStatusPath, "utf8")) as {
        progress?: {
          scannedCount?: number;
          indexedCount?: number;
          unchangedCount?: number;
          totalCount?: number | null;
          maxConcurrency?: number;
        };
      };
      const secondLastSeenAt = getLastSeenAt();

      expect(payload.indexResult?.scannedCount).toBe(1);
      expect(payload.indexResult?.indexedCount).toBe(0);
      expect(payload.indexResult?.unchangedCount).toBe(1);
      expect(payload.exportSkipped).toBe(true);
      expect(runtimeStatus.progress?.scannedCount).toBe(1);
      expect(runtimeStatus.progress?.indexedCount).toBe(0);
      expect(runtimeStatus.progress?.unchangedCount).toBe(1);
      expect(runtimeStatus.progress?.totalCount).toBe(1);
      expect(runtimeStatus.progress?.maxConcurrency).toBeGreaterThanOrEqual(1);
      expect(firstLastSeenAt).toBeTruthy();
      expect(secondLastSeenAt).toBe(firstLastSeenAt);
    } finally {
      fs.rmSync(rootDir, { recursive: true, force: true });
    }
  });

  it("高频 progress 不会把 runtime-status.json 写成每次都落盘", async () => {
    const rootDir = fs.mkdtempSync(path.join(os.tmpdir(), "affairs-index-progress-throttle-"));
    const statusPath = path.join(rootDir, ".ai-index", "runtime-status.json");
    const originalHeartbeatMs = process.env.CODINGNS_AFFAIRS_RUNTIME_HEARTBEAT_MS;
    process.env.CODINGNS_AFFAIRS_RUNTIME_HEARTBEAT_MS = "60000";
    const writeSpy = vi.spyOn(fs, "writeFileSync");

    const { TextIndexer } = await import("../../src/modules/affairs-indexer/core/src/services/indexer/text-indexer.js");
    const originalIndex = TextIndexer.prototype.index;
    TextIndexer.prototype.index = async function patchedIndex(_targetPath, options = {}) {
      for (let scannedCount = 1; scannedCount <= 60; scannedCount += 1) {
        options.onProgress?.({
          scannedCount,
          indexedCount: 0,
          skippedCount: 0,
          failedCount: 0,
          unchangedCount: scannedCount,
          totalCount: 60,
          maxConcurrency: 1,
        });
      }
      return {
        scannedCount: 60,
        indexedCount: 0,
        unchangedCount: 60,
        indexedPaths: [],
        skippedPaths: [],
        failedPaths: [],
        failedCount: 0,
        failures: [],
        failureOverflowCount: 0,
        deletedCount: 0,
        deletedPaths: [],
        dirtyScope: {
          trigger: "full",
          changedPaths: [],
          dirtyDirectories: [],
          dirtyTagPaths: [],
          dirtyRelations: [],
        },
        timingsMs: {
          scanFs: 0,
          parse: 0,
          tagInference: 0,
          skipCatalog: 0,
          writeIndexed: 0,
          writeSkipped: 0,
          scanAndParse: 0,
          writeSuccess: 0,
          writeFailure: 0,
          scanLoop: 0,
          cleanup: 0,
          reconcile: 0,
          dirtyScope: 0,
          total: 0,
        },
        batchStats: {
          writeBatchSize: 1,
          successBatchCount: 0,
          failureBatchCount: 0,
        },
        tagStats: {
          directAssignedCount: 0,
          derivedAssignedCount: 0,
          avgDirectPerIndexedDocument: 0,
          avgDerivedPerIndexedDocument: 0,
        },
        skipStats: {
          skippedCount: 0,
          skippedByExtension: {},
          skipCatalogRecords: 0,
        },
      };
    };

    try {
      await runAffairsIndexerCommand(rootDir, "index");
      const runtimeStatusWrites = writeSpy.mock.calls.filter(([filePath]) => filePath === statusPath).length;
      const runtimeStatus = JSON.parse(fs.readFileSync(statusPath, "utf8")) as {
        progress?: {
          scannedCount?: number;
          unchangedCount?: number;
        };
      };

      expect(runtimeStatusWrites).toBeLessThan(10);
      expect(runtimeStatus.progress?.scannedCount).toBe(60);
      expect(runtimeStatus.progress?.unchangedCount).toBe(60);
    } finally {
      TextIndexer.prototype.index = originalIndex;
      writeSpy.mockRestore();
      if (originalHeartbeatMs === undefined) {
        delete process.env.CODINGNS_AFFAIRS_RUNTIME_HEARTBEAT_MS;
      } else {
        process.env.CODINGNS_AFFAIRS_RUNTIME_HEARTBEAT_MS = originalHeartbeatMs;
      }
      fs.rmSync(rootDir, { recursive: true, force: true });
    }
  });

  it("watch-touch 遇到 unchanged 文件时会跳过静态导出", async () => {
    const rootDir = fs.mkdtempSync(path.join(os.tmpdir(), "affairs-watch-touch-skip-export-"));
    const documentDir = path.join(rootDir, "notes");
    const documentPath = path.join(documentDir, "a.md");
    fs.mkdirSync(documentDir, { recursive: true });
    fs.writeFileSync(documentPath, "# a\n", "utf8");

    const { ExportBuilder } = await import("../../src/modules/affairs-indexer/core/src/services/export/export-builder.js");
    const exportSpy = vi.spyOn(ExportBuilder.prototype, "build");

    try {
      await runAffairsIndexerCommand(rootDir, "index");
      exportSpy.mockClear();

      const result = await runAffairsIndexerCommand(rootDir, "watch-touch", {
        targetPath: "notes/a.md",
        reason: "test_watch_touch_skip_export",
      });
      const payload = result.result as {
        exportSkipped?: boolean;
        exportResult?: unknown;
        indexResult?: {
          indexedCount?: number;
          unchangedCount?: number;
        };
      };

      expect(payload.indexResult?.indexedCount).toBe(0);
      expect(payload.indexResult?.unchangedCount).toBe(1);
      expect(payload.exportSkipped).toBe(true);
      expect(payload.exportResult).toBeNull();
      expect(exportSpy).not.toHaveBeenCalled();
    } finally {
      exportSpy.mockRestore();
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

  it("长时间导出时会持续刷新 runtime-status 的 updatedAt", async () => {
    const rootDir = fs.mkdtempSync(path.join(os.tmpdir(), "affairs-index-heartbeat-"));
    const documentPath = path.join(rootDir, "长导出文档.md");
    fs.writeFileSync(documentPath, "# 标题\n\n这是一个测试文档。\n", "utf8");
    const statusPath = path.join(rootDir, ".ai-index", "runtime-status.json");
    const originalHeartbeatMs = process.env.CODINGNS_AFFAIRS_RUNTIME_HEARTBEAT_MS;
    process.env.CODINGNS_AFFAIRS_RUNTIME_HEARTBEAT_MS = "50";

    const { ExportBuilder } = await import("../../src/modules/affairs-indexer/core/src/services/export/export-builder.js");
    const originalBuild = ExportBuilder.prototype.build;
    ExportBuilder.prototype.build = async function patchedBuild() {
      await new Promise((resolve) => setTimeout(resolve, 180));
      return {
        outputDir: path.join(rootDir, ".ai-index", "exports"),
        manifestPath: path.join(rootDir, ".ai-index", "exports", "manifest.json"),
        metaShardCount: 0,
        detailShardCount: 0,
        tagShardCount: 0,
        searchBucketCount: 0,
        relationGroupCount: 0,
        filesWritten: [],
        exportedAt: new Date().toISOString(),
      };
    };

    try {
      const pending = runAffairsIndexerCommand(rootDir, "index");

      let firstUpdatedAt = "";
      for (let attempt = 0; attempt < 20; attempt += 1) {
        if (fs.existsSync(statusPath)) {
          const payload = JSON.parse(fs.readFileSync(statusPath, "utf8")) as {
            status?: string;
            stage?: string;
            updatedAt?: string;
          };
          if (payload.status === "running" && payload.stage === "export" && payload.updatedAt) {
            firstUpdatedAt = payload.updatedAt;
            break;
          }
        }
        await new Promise((resolve) => setTimeout(resolve, 20));
      }

      expect(firstUpdatedAt).toBeTruthy();
      await new Promise((resolve) => setTimeout(resolve, 90));
      const secondPayload = JSON.parse(fs.readFileSync(statusPath, "utf8")) as {
        updatedAt?: string;
        stage?: string;
      };

      expect(secondPayload.stage).toBe("export");
      expect(secondPayload.updatedAt).toBeTruthy();
      expect(new Date(secondPayload.updatedAt!).getTime()).toBeGreaterThan(new Date(firstUpdatedAt).getTime());

      await pending;
    } finally {
      ExportBuilder.prototype.build = originalBuild;
      if (originalHeartbeatMs === undefined) {
        delete process.env.CODINGNS_AFFAIRS_RUNTIME_HEARTBEAT_MS;
      } else {
        process.env.CODINGNS_AFFAIRS_RUNTIME_HEARTBEAT_MS = originalHeartbeatMs;
      }
      fs.rmSync(rootDir, { recursive: true, force: true });
    }
  });

  it("普通 index 不会再冲掉文件夹绑定生成的 direct tags", async () => {
    const rootDir = fs.mkdtempSync(path.join(os.tmpdir(), "affairs-index-keep-direct-tags-"));
    const documentDir = path.join(rootDir, "客户A");
    const documentPath = path.join(documentDir, "合同.md");
    fs.mkdirSync(documentDir, { recursive: true });
    fs.writeFileSync(documentPath, "# 合同\n\n测试文档\n", "utf8");

    try {
      await runAffairsIndexerCommand(rootDir, "index");
      const dbPath = path.join(rootDir, ".ai-index", "catalog.db");
      const repository = new CatalogRepository(dbPath);
      const writer = new CatalogWriteRepository(dbPath);
      const tagId = writer.saveTagDefinition({
        path: "客户/合同",
        name: "合同",
        rootType: "客户",
        parentId: null,
        canonicalName: "合同",
        description: null,
        status: "active",
        createdBy: "test",
      }).id;
      writer.replaceFolderTagBindings(".", [tagId]);

      await new TagRecomputeService(createAffairsIndexerRuntimeConfig(rootDir)).run({
        scope: { kind: "folder", folderPath: "." },
      });

      const indexedDocument = repository.listExportDocuments().find((item) => item.path === "客户A/合同.md");
      expect(indexedDocument?.tags).toContain("客户/合同");

      await runAffairsIndexerCommand(rootDir, "index");

      const refreshedDocument = repository.listExportDocuments().find((item) => item.path === "客户A/合同.md");
      expect(refreshedDocument?.tags).toContain("客户/合同");
    } finally {
      fs.rmSync(rootDir, { recursive: true, force: true });
    }
  });

  it("文件改名后，手动文件标签会跟着迁到新路径", async () => {
    const rootDir = fs.mkdtempSync(path.join(os.tmpdir(), "affairs-index-manual-tag-rename-"));
    const sourceDir = path.join(rootDir, "客户A");
    const sourcePath = path.join(sourceDir, "合同.md");
    const renamedPath = path.join(sourceDir, "已签合同.md");
    fs.mkdirSync(sourceDir, { recursive: true });
    fs.writeFileSync(sourcePath, "# 合同\n\n这是客户A的合同。\n", "utf8");

    try {
      await runAffairsIndexerCommand(rootDir, "index");
      const dbPath = path.join(rootDir, ".ai-index", "catalog.db");
      const repository = new CatalogRepository(dbPath);
      const writer = new CatalogWriteRepository(dbPath);
      const sourceDocument = repository.getDocumentContext(undefined, "客户A/合同.md");
      expect(sourceDocument).toBeTruthy();

      const tagId = writer.saveTagDefinition({
        path: "客户/已确认",
        name: "已确认",
        rootType: "客户",
        parentId: null,
        canonicalName: "已确认",
        description: null,
        status: "active",
        createdBy: "test",
      }).id;
      writer.replaceManualDocumentTagBindings(sourceDocument!, [tagId]);
      await new TagRecomputeService(createAffairsIndexerRuntimeConfig(rootDir)).run({
        scope: { kind: "document", documentId: sourceDocument!.documentId },
      });

      fs.renameSync(sourcePath, renamedPath);
      await runAffairsIndexerCommand(rootDir, "index");

      const renamedDocument = repository.getDocumentContext(undefined, "客户A/已签合同.md");
      expect(renamedDocument).toBeTruthy();
      const renamedResolvedTags = repository.listResolvedDocumentTagsByDocumentIds([renamedDocument!.documentId]);
      expect(renamedResolvedTags.map((item) => `${item.path}:${item.sourceType}`)).toContain("客户/已确认:manual_document");
      const renamedBindings = repository.listManualDocumentTagBindingsByDocumentIds([renamedDocument!.documentId]);
      expect(renamedBindings.map((item) => item.tagPath)).toContain("客户/已确认");
    } finally {
      fs.rmSync(rootDir, { recursive: true, force: true });
    }
  });

  it("同内容新副本不会误继承别的文件的手动标签", async () => {
    const rootDir = fs.mkdtempSync(path.join(os.tmpdir(), "affairs-index-manual-tag-copy-"));
    const sourcePath = path.join(rootDir, "原件.md");
    const copyPath = path.join(rootDir, "副本.md");
    fs.writeFileSync(sourcePath, "# 同内容\n\n这是同一份内容。\n", "utf8");

    try {
      await runAffairsIndexerCommand(rootDir, "index");
      const dbPath = path.join(rootDir, ".ai-index", "catalog.db");
      const repository = new CatalogRepository(dbPath);
      const writer = new CatalogWriteRepository(dbPath);
      const sourceDocument = repository.getDocumentContext(undefined, "原件.md");
      expect(sourceDocument).toBeTruthy();

      const tagId = writer.saveTagDefinition({
        path: "客户/原件",
        name: "原件",
        rootType: "客户",
        parentId: null,
        canonicalName: "原件",
        description: null,
        status: "active",
        createdBy: "test",
      }).id;
      writer.replaceManualDocumentTagBindings(sourceDocument!, [tagId]);
      await new TagRecomputeService(createAffairsIndexerRuntimeConfig(rootDir)).run({
        scope: { kind: "document", documentId: sourceDocument!.documentId },
      });

      fs.copyFileSync(sourcePath, copyPath);
      await runAffairsIndexerCommand(rootDir, "index");

      const copiedDocument = repository.getDocumentContext(undefined, "副本.md");
      expect(copiedDocument).toBeTruthy();
      const copiedResolvedTags = repository.listResolvedDocumentTagsByDocumentIds([copiedDocument!.documentId]);
      expect(copiedResolvedTags.map((item) => item.path)).not.toContain("客户/原件");
      const copiedBindings = repository.listManualDocumentTagBindingsByDocumentIds([copiedDocument!.documentId]);
      expect(copiedBindings).toHaveLength(0);
    } finally {
      fs.rmSync(rootDir, { recursive: true, force: true });
    }
  });

  it("文件被删后重新出现，手动标签不会因为旧 document 删除而丢失", async () => {
    const rootDir = fs.mkdtempSync(path.join(os.tmpdir(), "affairs-index-manual-tag-restore-"));
    const sourcePath = path.join(rootDir, "原件.md");
    const restoredPath = path.join(rootDir, "恢复后.md");
    fs.writeFileSync(sourcePath, "# 合同\n\n这是待恢复的文档。\n", "utf8");

    try {
      await runAffairsIndexerCommand(rootDir, "index");
      const dbPath = path.join(rootDir, ".ai-index", "catalog.db");
      const repository = new CatalogRepository(dbPath);
      const writer = new CatalogWriteRepository(dbPath);
      const sourceDocument = repository.getDocumentContext(undefined, "原件.md");
      expect(sourceDocument).toBeTruthy();

      const tagId = writer.saveTagDefinition({
        path: "客户/恢复",
        name: "恢复",
        rootType: "客户",
        parentId: null,
        canonicalName: "恢复",
        description: null,
        status: "active",
        createdBy: "test",
      }).id;
      writer.replaceManualDocumentTagBindings(sourceDocument!, [tagId]);
      await new TagRecomputeService(createAffairsIndexerRuntimeConfig(rootDir)).run({
        scope: { kind: "document", documentId: sourceDocument!.documentId },
      });

      fs.unlinkSync(sourcePath);
      await runAffairsIndexerCommand(rootDir, "index");
      expect(repository.getDocumentContext(undefined, "原件.md")).toBeNull();

      fs.writeFileSync(restoredPath, "# 合同\n\n这是待恢复的文档。\n", "utf8");
      await runAffairsIndexerCommand(rootDir, "index");

      const restoredDocument = repository.getDocumentContext(undefined, "恢复后.md");
      expect(restoredDocument).toBeTruthy();
      const restoredResolvedTags = repository.listResolvedDocumentTagsByDocumentIds([restoredDocument!.documentId]);
      expect(restoredResolvedTags.map((item) => `${item.path}:${item.sourceType}`)).toContain("客户/恢复:manual_document");
      const restoredBindings = repository.listManualDocumentTagBindingsByDocumentIds([restoredDocument!.documentId]);
      expect(restoredBindings.map((item) => item.tagPath)).toContain("客户/恢复");
    } finally {
      fs.rmSync(rootDir, { recursive: true, force: true });
    }
  });
});
