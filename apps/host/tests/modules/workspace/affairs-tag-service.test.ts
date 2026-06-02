import fs from "node:fs";
import os from "node:os";
import path from "node:path";
import { afterEach, beforeEach, describe, expect, it, vi } from "vitest";
import { AffairsTagService } from "../../../src/modules/workspace/affairs-tag-service.js";
import { HOST_TASK_TYPES } from "../../../src/modules/tasks/task-types.js";
import { initCatalog } from "../../../src/modules/affairs-indexer/core/src/sqlite/init-catalog.js";
import { CatalogRepository } from "../../../src/modules/affairs-indexer/core/src/repositories/catalog-repository.js";
import { CatalogWriteRepository } from "../../../src/modules/affairs-indexer/core/src/repositories/catalog-write-repository.js";
import { TagRecomputeService } from "../../../src/modules/affairs-indexer/core/src/services/tagging/tag-recompute-service.js";
import { createAffairsIndexerRuntimeConfig } from "../../../src/modules/affairs-indexer/internal-command-runner.js";
import { SimpleTagInferenceEngine } from "../../../src/modules/affairs-indexer/core/src/tagging/simple-tag-inference.js";

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
    writeBatchSize: 100,
    logLevel: "silent",
  });
  return rootDir;
}

describe("AffairsTagService", () => {
  let rootDir: string;
  let enqueue: ReturnType<typeof vi.fn>;

  afterEach(() => {
    vi.restoreAllMocks();
  });

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

    const child = service.saveTagDefinition("workspace-1", "user-1", {
      name: "正式合同",
      parentId: tag.id,
    });
    expect(child.path).toBe("客户合同/正式合同");
    expect(child.parentId).toBe(tag.id);
  });

  it("标签重算会合并手动标签、文件夹标签和系统派生标签", async () => {
    const document = addIndexedDocument("客户A/合同.md", "客户A 合同");
    const service = createService();
    const manualTag = service.saveTagDefinition("workspace-1", "user-1", {
      name: "人工确认",
    });
    const folderTag = service.saveTagDefinition("workspace-1", "user-1", {
      name: "目录继承",
    });
    service.saveDocumentTagBindings("workspace-1", "user-1", document.documentId, [manualTag.id]);
    service.saveFolderTagBindings("workspace-1", "user-1", ".", [folderTag.id]);
    await new TagRecomputeService(createAffairsIndexerRuntimeConfig(rootDir)).run({
      scope: { kind: "document", documentId: document.documentId },
    });

    const details = service.getDocumentTagDetails("workspace-1", "user-1", document.documentId);
    expect(details.manualTagIds).toContain(manualTag.id);
    expect(details.effectiveFolderBindings.map(item => item.tagId)).toContain(folderTag.id);
    expect(details.resolvedTags.map(item => `${item.path}:${item.sourceType}`)).toEqual(expect.arrayContaining([
      "人工确认:manual_document",
      "目录继承:folder_binding",
    ]));
  });

  it("文件夹标签变更时会走轻量重算，不再重新跑整套推理", async () => {
    const document = addIndexedDocument("客户A/合同.md", "客户A 合同");
    const service = createService();
    const folderTag = service.saveTagDefinition("workspace-1", "user-1", {
      name: "目录继承",
    });
    service.saveFolderTagBindings("workspace-1", "user-1", ".", [folderTag.id]);
    const inferSpy = vi.spyOn(SimpleTagInferenceEngine.prototype, "infer");

    await new TagRecomputeService(createAffairsIndexerRuntimeConfig(rootDir)).run({
      scope: { kind: "folder", folderPath: ".", mode: "folder_bindings_only" },
    });

    expect(inferSpy).not.toHaveBeenCalled();
    const details = service.getDocumentTagDetails("workspace-1", "user-1", document.documentId);
    expect(details.resolvedTags.map(item => `${item.path}:${item.sourceType}`)).toEqual(expect.arrayContaining([
      "目录继承:folder_binding",
    ]));
  });

  it("标签改名后重新跑标签重算与导出时不会再写入失效 tag_id，左侧标签树会看到新名称", async () => {
    const document = addIndexedDocument("售前/方案.md", "系统集成方案");
    const service = createService();
    const tag = service.saveTagDefinition("workspace-1", "user-1", {
      name: "系统集成",
      smartRules: [],
    });

    service.saveFolderTagBindings("workspace-1", "user-1", ".", [tag.id]);
    await new TagRecomputeService(createAffairsIndexerRuntimeConfig(rootDir)).run({
      scope: { kind: "folder", folderPath: ".", mode: "folder_bindings_only" },
    });

    service.saveTagDefinition("workspace-1", "user-1", {
      tagId: tag.id,
      name: "售前",
      smartRules: [],
    });

    await expect(new TagRecomputeService(createAffairsIndexerRuntimeConfig(rootDir)).run({
      scope: { kind: "full" },
    })).resolves.toMatchObject({
      scannedCount: 1,
    });

    const details = service.getDocumentTagDetails("workspace-1", "user-1", document.documentId);
    expect(details.resolvedTags.map(item => `${item.path}:${item.sourceType}`)).toEqual(expect.arrayContaining([
      "售前:folder_binding",
    ]));
    expect(details.resolvedTags.map(item => item.path)).not.toContain("系统集成");

    const manifest = JSON.parse(
      fs.readFileSync(path.join(rootDir, ".ai-index", "exports", "manifest.json"), "utf8"),
    ) as {
      entries?: { taxonomy?: string };
    };
    const taxonomyEntry = manifest.entries?.taxonomy ?? "taxonomy.json";
    const taxonomy = JSON.parse(
      fs.readFileSync(path.join(rootDir, ".ai-index", "exports", taxonomyEntry), "utf8"),
    ) as {
      nodes?: Array<{ path?: string; name?: string }>;
    };
    expect(taxonomy.nodes).toEqual(expect.arrayContaining([
      expect.objectContaining({
        path: "售前",
        name: "售前",
      }),
    ]));
    expect(taxonomy.nodes?.some((node) => node.path === "系统集成")).toBe(false);
  });

  it("清理 orphan tag 后，旧的 tagId cache 不会再导致后续写入 FK 失败", () => {
    const dbPath = path.join(rootDir, ".ai-index", "catalog.db");
    const writer = new CatalogWriteRepository(dbPath);
    const now = new Date().toISOString();

    const document = writer.upsertTextDocument(
      {
        relativePath: "售前/方案.md",
        fullPath: path.join(rootDir, "售前/方案.md"),
        name: "方案.md",
        extension: ".md",
        size: 128,
        mtime: now,
        ctime: now,
      },
      {
        title: "售前方案",
        text: "售前方案正文",
        summary: "售前方案",
        parser: "test",
      },
      [],
      [
        {
          tagPath: "系统集成/售前",
          source: "system_derived",
          confidence: 1,
          evidence: "first-pass",
          manualOverride: false,
        },
      ],
      now,
    );

    writer.recomputeDocumentTags([
      {
        documentId: document.documentId,
        tags: [],
        derivedTags: [],
      },
    ], now);
    writer.cleanupOrphanTags();

    expect(() => writer.upsertTextDocument(
      {
        relativePath: "售前/方案.md",
        fullPath: path.join(rootDir, "售前/方案.md"),
        name: "方案.md",
        extension: ".md",
        size: 256,
        mtime: now,
        ctime: now,
      },
      {
        title: "售前方案",
        text: "第二次写入",
        summary: "售前方案",
        parser: "test",
      },
      [],
      [
        {
          tagPath: "系统集成/售前",
          source: "system_derived",
          confidence: 1,
          evidence: "second-pass",
          manualOverride: false,
        },
      ],
      now,
    )).not.toThrow();

    const repository = new CatalogRepository(dbPath);
    expect(repository.listTagDefinitions(true).map(item => item.path)).toEqual(expect.arrayContaining([
      "系统集成",
      "系统集成/售前",
    ]));
  });

  it("大批量文档路径读取有效文件夹标签时不会再触发 SQLite 表达式树爆炸", () => {
    const service = createService();
    const folderTag = service.saveTagDefinition("workspace-1", "user-1", {
      name: "目录继承",
    });
    service.saveFolderTagBindings("workspace-1", "user-1", ".", [folderTag.id]);
    const repository = new CatalogRepository(path.join(rootDir, ".ai-index", "catalog.db"));
    const paths = Array.from({ length: 1205 }, (_, index) => `客户A/文件-${index}.md`);

    expect(() => repository.listEffectiveFolderTagBindingsForDocumentPaths(paths)).not.toThrow();
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

  it("删除父标签时会级联删除子标签和相关绑定", async () => {
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
    await new TagRecomputeService(createAffairsIndexerRuntimeConfig(rootDir)).run({
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
