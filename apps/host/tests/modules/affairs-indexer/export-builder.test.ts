import fs from "node:fs";
import os from "node:os";
import path from "node:path";

import { afterEach, describe, expect, it, vi } from "vitest";

import type { RuntimeConfig } from "../../../src/modules/affairs-indexer/contracts/src/index.js";
import type { FileScanResult } from "../../../src/modules/affairs-indexer/core/src/scanner/file-scanner.js";
import { CatalogWriteRepository } from "../../../src/modules/affairs-indexer/core/src/repositories/catalog-write-repository.js";
import { initCatalog } from "../../../src/modules/affairs-indexer/core/src/sqlite/init-catalog.js";
import { ExportBuilder } from "../../../src/modules/affairs-indexer/core/src/services/export/export-builder.js";
import { SearchIndexBuilder } from "../../../src/modules/affairs-indexer/core/src/services/search/search-index-builder.js";

function createConfig(): RuntimeConfig {
  const rootDir = fs.mkdtempSync(path.join(os.tmpdir(), "affairs-export-builder-"));
  const indexDir = path.join(rootDir, ".ai-index");
  const config: RuntimeConfig = {
    rootDir,
    indexDir,
    dbPath: path.join(indexDir, "catalog.db"),
    exportDir: path.join(indexDir, "exports"),
    configFilePath: path.join(indexDir, "doc-semantic-index.config.json"),
    watchDebounceMs: 200,
    parserTimeoutMs: 30000,
    disabledParserExtensions: [],
    allowedExtensions: [".md"],
    includedHiddenPaths: [],
    writeBatchSize: 100,
    maxIndexConcurrency: 1,
    logLevel: "silent",
  };
  initCatalog(config);
  return config;
}

function addIndexedDocument(config: RuntimeConfig, relativePath: string, title: string): { documentId: string } {
  const now = new Date().toISOString();
  fs.mkdirSync(path.dirname(path.join(config.rootDir, relativePath)), { recursive: true });
  fs.writeFileSync(path.join(config.rootDir, relativePath), `# ${title}\n`, "utf8");

  const file: FileScanResult = {
    relativePath,
    fullPath: path.join(config.rootDir, relativePath),
    name: path.basename(relativePath),
    extension: path.extname(relativePath),
    size: Buffer.byteLength(title),
    mtime: now,
    ctime: now,
  };

  return new CatalogWriteRepository(config.dbPath).upsertTextDocument(
    file,
    {
      title,
      summary: title,
      text: title,
      parser: "test",
    },
    [
      {
        tagPath: "项目/测试",
        confidence: 1,
        source: "test",
        evidence: "测试数据",
      },
    ],
    [],
    now,
  );
}

describe("ExportBuilder 搜索索引导出", () => {
  afterEach(() => {
    vi.restoreAllMocks();
  });

  it("小范围增量变更会复用旧搜索索引，避免删除单文件触发全量搜索重建", async () => {
    const config = createConfig();
    try {
      addIndexedDocument(config, "notes/a.md", "第一份文档");
      addIndexedDocument(config, "notes/b.md", "第二份文档");

      const firstResult = await new ExportBuilder(config).build();
      const previousSearchManifestPath = path.join(config.exportDir, "search", "manifest.json");
      const previousSearchManifest = fs.readFileSync(previousSearchManifestPath, "utf8");
      const searchSpy = vi.spyOn(SearchIndexBuilder.prototype, "build");

      const secondResult = await new ExportBuilder(config).build({
        dirtyScope: {
          trigger: "incremental",
          changedPaths: ["notes/b.md"],
          deletedPaths: ["notes/b.md"],
          dirtyDirectories: ["notes"],
          dirtyTagPaths: [],
          dirtyMetaShards: [],
          dirtyDetailShards: [],
          dirtyPostingBuckets: [],
          dirtyRelations: [],
        },
        reason: "test_deleted_file_incremental",
        targetPath: "notes/b.md",
      });

      expect(searchSpy).not.toHaveBeenCalled();
      expect(secondResult.searchBucketCount).toBe(firstResult.searchBucketCount);
      expect(fs.readFileSync(previousSearchManifestPath, "utf8")).toBe(previousSearchManifest);
      expect(secondResult.filesWritten.some(filePath => filePath.includes(`${path.sep}search${path.sep}`))).toBe(false);
    } finally {
      fs.rmSync(config.rootDir, { recursive: true, force: true });
    }
  });

  it("全量导出仍然会重建搜索索引", async () => {
    const config = createConfig();
    try {
      addIndexedDocument(config, "notes/a.md", "第一份文档");
      const searchSpy = vi.spyOn(SearchIndexBuilder.prototype, "build");

      await new ExportBuilder(config).build();

      expect(searchSpy).toHaveBeenCalledTimes(1);
    } finally {
      fs.rmSync(config.rootDir, { recursive: true, force: true });
    }
  });

  it("搜索索引构建前会清理上次残留的临时文件", async () => {
    const config = createConfig();
    try {
      addIndexedDocument(config, "notes/a.md", "第一份文档");
      const staleTempFile = path.join(config.exportDir, "search", ".tmp", "stale.terms.ndjson");
      fs.mkdirSync(path.dirname(staleTempFile), { recursive: true });
      fs.writeFileSync(staleTempFile, "{\"term\":\"旧数据\",\"document_id\":\"doc_stale\"}\n", "utf8");

      await new SearchIndexBuilder(config).build({ reason: "test_clean_stale_search_tmp" });

      expect(fs.existsSync(staleTempFile)).toBe(false);
    } finally {
      fs.rmSync(config.rootDir, { recursive: true, force: true });
    }
  });
});
