import fs from "node:fs";
import os from "node:os";
import path from "node:path";
import { beforeEach, describe, expect, it, vi } from "vitest";
import { AffairsTagService } from "../../../src/modules/workspace/affairs-tag-service.js";
import { HOST_TASK_TYPES } from "../../../src/modules/tasks/task-types.js";
import { initCatalog } from "../../../src/modules/affairs-indexer/core/src/sqlite/init-catalog.js";
import { CatalogWriteRepository } from "../../../src/modules/affairs-indexer/core/src/repositories/catalog-write-repository.js";
import { TagRecomputeService } from "../../../src/modules/affairs-indexer/core/src/services/tagging/tag-recompute-service.js";
import { createAffairsIndexerRuntimeConfig } from "../../../src/modules/affairs-indexer/internal-command-runner.js";

function createRootDir() {
  const rootDir = fs.mkdtempSync(path.join(os.tmpdir(), "affairs-tag-service-"));
  fs.mkdirSync(path.join(rootDir, ".ai-index"), { recursive: true });
  initCatalog({
    rootDir,
    indexDir: path.join(rootDir, ".ai-index"),
    dbPath: path.join(rootDir, ".ai-index", "catalog.db"),
    exportDir: path.join(rootDir, ".ai-index", "exports"),
    configFilePath: path.join(rootDir, ".ai-index", "doc-semantic-index.config.json"),
    watchDebounceMs: 200,
    parserTimeoutMs: 30000,
    disabledParserExtensions: [],
    allowedExtensions: [".md"],
    tagRulesPath: path.join(rootDir, ".ai-index", "tag-rules.json"),
    writeBatchSize: 100,
    logLevel: "silent",
  });
  return rootDir;
}

describe("AffairsTagService", () => {
  let rootDir: string;
  let enqueue: ReturnType<typeof vi.fn>;

  beforeEach(() => {
    rootDir = createRootDir();
    enqueue = vi.fn((taskType: string) => ({
      taskId: `task-${taskType}`,
      taskType,
      key: "workspace-1",
      executionLane: "helper_process",
      deduped: false,
      promise: Promise.resolve({ ok: true }),
      cancel: vi.fn(),
    }));
  });

  function createService() {
    return new AffairsTagService(
      { getWorkspaceOrThrow: vi.fn(() => ({ id: "workspace-1" })) } as never,
      {
        findByWorkspaceIdAndUserId: vi.fn(() => ({
          affairsLibraryRootPath: rootDir,
          affairsLibraryEnabled: true,
        })),
      } as never,
      { resolvePreviewFile: vi.fn(() => ({ exists: true })) } as never,
      {
        has: vi.fn(() => false),
        register: vi.fn(),
        enqueue,
      } as never,
    );
  }

  function addIndexedDocument(relativePath: string, title: string) {
    const writer = new CatalogWriteRepository(path.join(rootDir, ".ai-index", "catalog.db"));
    const now = new Date().toISOString();
    return writer.upsertTextDocument(
      {
        relativePath,
        fullPath: path.join(rootDir, relativePath),
        name: path.basename(relativePath),
        extension: path.extname(relativePath),
        size: 128,
        mtime: now,
        ctime: now,
      },
      {
        title,
        text: title,
        summary: title,
        parser: "test",
      },
      [],
      [],
      now,
    );
  }

  it("可以创建标签并读取详情", () => {
    const service = createService();

    const tag = service.saveTagDefinition("workspace-1", "user-1", {
      name: "客户合同",
    });

    expect(tag.name).toBe("客户合同");
    expect(tag.path).toBe("客户合同");

    const detail = service.getTagDetail("workspace-1", "user-1", tag.id);
    expect(detail.id).toBe(tag.id);
    expect(detail.rules).toEqual([]);

    const child = service.saveTagDefinition("workspace-1", "user-1", {
      name: "正式合同",
      parentId: tag.id,
    });
    expect(child.path).toBe("客户合同/正式合同");
    expect(child.parentId).toBe(tag.id);
  });

  it("可以导入推荐批次并创建标签树", () => {
    addIndexedDocument("客户A/合同.md", "客户A 合同");
    addIndexedDocument("客户A/验收.md", "客户A 验收");
    addIndexedDocument("客户B/合同.md", "客户B 合同");
    const service = createService();

    const created = service.createRecommendationBatch("workspace-1", "user-1");
    expect(created.batch.status).toBe("draft");
    expect(created.batch.items?.length).toBeGreaterThanOrEqual(2);

    const customerAItem = created.batch.items?.find((item) => item.proposedPath === "推荐/客户A");
    expect(customerAItem).toBeTruthy();

    const result = service.applyRecommendationBatch("workspace-1", "user-1", created.batch.id, {
      items: created.batch.items?.map((item) => ({
        itemId: item.id,
        selected: item.id === customerAItem?.id,
      })) ?? [],
    });

    expect(result.batch.status).toBe("applied");
    expect(result.batch.items?.find((item) => item.id === customerAItem?.id)?.status).toBe("accepted");
    expect(result.createdTags.map((item) => item.path)).toEqual(expect.arrayContaining(["推荐", "推荐/客户A"]));
    expect(enqueue).toHaveBeenCalledWith(
      HOST_TASK_TYPES.affairsLibraryTagExportRefresh,
      expect.objectContaining({
        source: "affairs_tag.apply_recommendation_batch",
      }),
    );
    expect(() => service.applyRecommendationBatch("workspace-1", "user-1", created.batch.id)).toThrow(/只有草稿批次可以导入/);
  });

  it("可以放弃推荐批次并拒绝全部推荐项", () => {
    addIndexedDocument("客户A/合同.md", "客户A 合同");
    const service = createService();

    const created = service.createRecommendationBatch("workspace-1", "user-1");
    const discarded = service.discardRecommendationBatch("workspace-1", "user-1", created.batch.id);

    expect(discarded.status).toBe("discarded");
    expect(discarded.items?.length).toBeGreaterThan(0);
    expect(discarded.items?.every((item) => item.status === "rejected")).toBe(true);
    expect(() => service.discardRecommendationBatch("workspace-1", "user-1", created.batch.id)).toThrow(/只有草稿批次可以放弃/);
  });

  it("标签重算会合并手动标签、文件夹标签和数据库规则标签", () => {
    const document = addIndexedDocument("客户A/合同.md", "客户A 合同");
    const service = createService();
    const manualTag = service.saveTagDefinition("workspace-1", "user-1", {
      name: "人工确认",
    });
    const folderTag = service.saveTagDefinition("workspace-1", "user-1", {
      name: "目录继承",
    });
    const ruleTag = service.saveTagDefinition("workspace-1", "user-1", {
      name: "规则命中",
    });

    service.saveDocumentTagBindings("workspace-1", "user-1", document.documentId, [manualTag.id]);
    service.saveFolderTagBindings("workspace-1", "user-1", ".", [folderTag.id]);
    service.saveTagRules("workspace-1", "user-1", ruleTag.id, [
      {
        enabled: true,
        ruleType: "keyword",
        scope: ["path", "title", "summary", "body"],
        matcher: { keywords: ["客户A"], pathIncludes: [] },
        minScore: 0.2,
        priority: 0,
        source: "user",
      },
    ]);

    new TagRecomputeService(createAffairsIndexerRuntimeConfig(rootDir)).run({
      scope: { kind: "document", documentId: document.documentId },
    });

    const details = service.getDocumentTagDetails("workspace-1", "user-1", document.documentId);
    expect(details.manualTagIds).toContain(manualTag.id);
    expect(details.effectiveFolderBindings.map(item => item.tagId)).toContain(folderTag.id);
    expect(details.resolvedTags.map(item => `${item.path}:${item.sourceType}`)).toEqual(expect.arrayContaining([
      "人工确认:manual_document",
      "目录继承:folder_binding",
      "规则命中:rule_match",
    ]));
  });

  it("读取根目录标签详情时显式支持 folderPath=.", () => {
    const resolvePreviewFile = vi.fn(() => ({ exists: true }));
    const service = new AffairsTagService(
      { getWorkspaceOrThrow: vi.fn(() => ({ id: "workspace-1" })) } as never,
      {
        findByWorkspaceIdAndUserId: vi.fn(() => ({
          affairsLibraryRootPath: rootDir,
          affairsLibraryEnabled: true,
        })),
      } as never,
      { resolvePreviewFile } as never,
      {
        has: vi.fn(() => false),
        register: vi.fn(),
        enqueue,
      } as never,
    );
    const folderTag = service.saveTagDefinition("workspace-1", "user-1", {
      name: "根目录标签",
    });
    service.saveFolderTagBindings("workspace-1", "user-1", ".", [folderTag.id]);

    const details = service.getFolderTagDetails("workspace-1", "user-1", ".");

    expect(details.folderPath).toBe(".");
    expect(details.exists).toBe(true);
    expect(details.bindingTagIds).toEqual([folderTag.id]);
    expect(resolvePreviewFile).not.toHaveBeenCalled();
  });

  it("读取普通目录标签详情时仍沿用目录解析", () => {
    fs.mkdirSync(path.join(rootDir, "客户A"), { recursive: true });
    const resolvePreviewFile = vi.fn(() => ({ exists: true }));
    const service = new AffairsTagService(
      { getWorkspaceOrThrow: vi.fn(() => ({ id: "workspace-1" })) } as never,
      {
        findByWorkspaceIdAndUserId: vi.fn(() => ({
          affairsLibraryRootPath: rootDir,
          affairsLibraryEnabled: true,
        })),
      } as never,
      { resolvePreviewFile } as never,
      {
        has: vi.fn(() => false),
        register: vi.fn(),
        enqueue,
      } as never,
    );

    service.getFolderTagDetails("workspace-1", "user-1", "客户A");

    expect(resolvePreviewFile).toHaveBeenCalledWith("workspace-1", "user-1", "客户A", {
      mustExist: false,
      kind: "directory",
    });
  });

  it("删除父标签时会级联删除子标签和相关绑定", () => {
    const document = addIndexedDocument("客户A/合同.md", "客户A 合同");
    const service = createService();
    const rootTag = service.saveTagDefinition("workspace-1", "user-1", {
      name: "客户",
    });
    const childTag = service.saveTagDefinition("workspace-1", "user-1", {
      name: "合同",
      parentId: rootTag.id,
    });

    service.saveDocumentTagBindings("workspace-1", "user-1", document.documentId, [childTag.id]);
    service.saveFolderTagBindings("workspace-1", "user-1", ".", [rootTag.id]);
    service.saveTagRules("workspace-1", "user-1", childTag.id, [
      {
        enabled: true,
        ruleType: "keyword",
        scope: ["path", "title"],
        matcher: { keywords: ["合同"] },
        minScore: 0.2,
        priority: 0,
        source: "user",
      },
    ]);

    new TagRecomputeService(createAffairsIndexerRuntimeConfig(rootDir)).run({
      scope: { kind: "document", documentId: document.documentId },
    });

    const result = service.deleteTagDefinition("workspace-1", "user-1", rootTag.id);
    expect(result.deletedTagIds).toEqual(expect.arrayContaining([rootTag.id, childTag.id]));
    expect(result.deletedTagIds).toHaveLength(2);
    expect(result.deletedPaths).toEqual(["客户", "客户/合同"]);
    expect(enqueue).toHaveBeenCalledWith(
      HOST_TASK_TYPES.affairsLibraryTagExportRefresh,
      expect.objectContaining({
        source: "affairs_tag.delete_tag_definition",
      }),
    );

    expect(() => service.getTagDetail("workspace-1", "user-1", rootTag.id)).toThrow(/标签不存在/);
    expect(() => service.getTagDetail("workspace-1", "user-1", childTag.id)).toThrow(/标签不存在/);
    const details = service.getDocumentTagDetails("workspace-1", "user-1", document.documentId);
    expect(details.manualTagIds).toEqual([]);
    expect(details.effectiveFolderBindings).toEqual([]);
    expect(details.resolvedTags.map(item => item.path)).not.toEqual(expect.arrayContaining(["客户", "客户/合同"]));
  });
});
