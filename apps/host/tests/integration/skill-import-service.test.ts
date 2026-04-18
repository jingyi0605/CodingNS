import { existsSync, mkdirSync, mkdtempSync, readFileSync, rmSync, writeFileSync } from "node:fs";
import os from "node:os";
import path from "node:path";

import { afterEach, describe, expect, it } from "vitest";

import {
  SkillManagerService,
  computeSkillDirectoryHash
} from "../../src/modules/skills/skill-manager-service.js";
import type { SkillTargetAdapter } from "../../src/modules/skills/skill-target-adapter.js";
import { ManagedSkillRepository } from "../../src/storage/repositories/managed-skill-repository.js";
import { SkillTargetBindingRepository } from "../../src/storage/repositories/skill-target-binding-repository.js";
import { createDatabaseClient } from "../../src/storage/sqlite/client.js";

const tempDirs: string[] = [];

afterEach(() => {
  while (tempDirs.length > 0) {
    const tempDir = tempDirs.pop();

    if (tempDir) {
      rmSync(tempDir, { recursive: true, force: true });
    }
  }
});

describe("SkillManagerService.importUnmanagedSkill", () => {
  it("会把未纳管 skill 导入 SSOT，并绑定来源目标和附加目标", () => {
    const tempDir = mkdtempSync(path.join(os.tmpdir(), "codingns-skill-import-"));
    tempDirs.push(tempDir);
    const database = createDatabaseClient(":memory:");
    const managedSkillRepository = new ManagedSkillRepository(database.db);
    const skillTargetBindingRepository = new SkillTargetBindingRepository(database.db);
    const ssotRootDir = path.join(tempDir, "skill-ssot");
    const codexRoot = path.join(tempDir, "codex-skills");
    const geminiRoot = path.join(tempDir, "gemini-skills");

    mkdirSync(codexRoot, { recursive: true });
    mkdirSync(geminiRoot, { recursive: true });

    const codexPath = createSkillDirectory(codexRoot, "legacy-helper", {
      "SKILL.md": "# Legacy Helper\n\n这是 Codex 里的旧 skill。"
    });
    createSkillDirectory(geminiRoot, "legacy-helper", {
      "SKILL.md": "# Legacy Helper\n\n这是 Codex 里的旧 skill。"
    });
    const contentHash = computeSkillDirectoryHash(codexPath);
    const service = new SkillManagerService(
      managedSkillRepository,
      skillTargetBindingRepository,
      [createAdapter("codex", codexRoot), createAdapter("gemini", geminiRoot)],
      {
        ssotRootDir,
        now: () => "2026-04-14T14:00:00.000Z",
        createId: () => "skill-legacy-helper"
      }
    );

    const result = service.importUnmanagedSkill({
      targetCli: "codex",
      directoryPath: codexPath,
      expectedContentHash: contentHash,
      additionalTargetCli: ["gemini"]
    });

    database.close();

    expect(result.skill).toEqual({
      id: "skill-legacy-helper",
      name: "Legacy Helper",
      directoryName: "legacy-helper",
      sourceType: "managed-copy",
      sourcePath: path.resolve(codexPath),
      contentHash,
      managedState: "active",
      createdAt: "2026-04-14T14:00:00.000Z",
      updatedAt: "2026-04-14T14:00:00.000Z"
    });
    expect(result.bindings).toEqual([
      {
        skillId: "skill-legacy-helper",
        targetCli: "codex",
        enabled: true,
        syncStatus: "synced",
        lastSyncedAt: "2026-04-14T14:00:00.000Z",
        lastErrorCode: null,
        lastErrorDetail: null
      },
      {
        skillId: "skill-legacy-helper",
        targetCli: "gemini",
        enabled: true,
        syncStatus: "synced",
        lastSyncedAt: "2026-04-14T14:00:00.000Z",
        lastErrorCode: null,
        lastErrorDetail: null
      }
    ]);
    expect(existsSync(path.join(ssotRootDir, "legacy-helper", "SKILL.md"))).toBe(true);
    expect(readFileSync(path.join(ssotRootDir, "legacy-helper", "SKILL.md"), "utf8")).toContain("Legacy Helper");
  });

  it("来源目录内容变化时会拒绝导入", () => {
    const tempDir = mkdtempSync(path.join(os.tmpdir(), "codingns-skill-import-drift-"));
    tempDirs.push(tempDir);
    const database = createDatabaseClient(":memory:");
    const ssotRootDir = path.join(tempDir, "skill-ssot");
    const codexRoot = path.join(tempDir, "codex-skills");

    mkdirSync(codexRoot, { recursive: true });

    const codexPath = createSkillDirectory(codexRoot, "drifted-helper", {
      "SKILL.md": "# Drifted Helper\n\n第一次扫描时的内容。"
    });
    const originalHash = computeSkillDirectoryHash(codexPath);

    writeFileSync(
      path.join(codexPath, "SKILL.md"),
      "# Drifted Helper\n\n后来内容变了。",
      "utf8"
    );

    const service = new SkillManagerService(
      new ManagedSkillRepository(database.db),
      new SkillTargetBindingRepository(database.db),
      [createAdapter("codex", codexRoot)],
      {
        ssotRootDir,
        now: () => "2026-04-14T14:10:00.000Z",
        createId: () => "skill-drifted-helper"
      }
    );

    expect(() =>
      service.importUnmanagedSkill({
        targetCli: "codex",
        directoryPath: codexPath,
        expectedContentHash: originalHash
      })
    ).toThrowError("导入来源目录内容已经变化，请重新扫描后再导入");
    expect(existsSync(path.join(ssotRootDir, "drifted-helper"))).toBe(false);

    database.close();
  });

  it("保留给助手运行时的目录名不能作为公共 skill 导入", () => {
    const tempDir = mkdtempSync(path.join(os.tmpdir(), "codingns-skill-import-reserved-"));
    tempDirs.push(tempDir);
    const database = createDatabaseClient(":memory:");
    const ssotRootDir = path.join(tempDir, "skill-ssot");
    const codexRoot = path.join(tempDir, "codex-skills");

    mkdirSync(codexRoot, { recursive: true });

    const codexPath = createSkillDirectory(codexRoot, "codingns-assistant", {
      "SKILL.md": "# CodingNS Assistant\n\n这是历史残留。"
    });
    const service = new SkillManagerService(
      new ManagedSkillRepository(database.db),
      new SkillTargetBindingRepository(database.db),
      [createAdapter("codex", codexRoot)],
      {
        ssotRootDir
      }
    );

    expect(() =>
      service.importUnmanagedSkill({
        targetCli: "codex",
        directoryPath: codexPath,
        expectedContentHash: computeSkillDirectoryHash(codexPath)
      })
    ).toThrowError("目录名保留给助手专用运行时资产");
    expect(existsSync(path.join(ssotRootDir, "codingns-assistant"))).toBe(false);

    database.close();
  });
});

function createSkillDirectory(
  rootDir: string,
  directoryName: string,
  files: Record<string, string>
): string {
  const directoryPath = path.join(rootDir, directoryName);

  mkdirSync(directoryPath, { recursive: true });

  for (const [relativePath, content] of Object.entries(files)) {
    const absolutePath = path.join(directoryPath, relativePath);

    mkdirSync(path.dirname(absolutePath), { recursive: true });
    writeFileSync(absolutePath, content, "utf8");
  }

  return directoryPath;
}

function createAdapter(targetCli: SkillTargetAdapter["targetCli"], rootDir: string): SkillTargetAdapter {
  return {
    targetCli,
    resolveRootDir: () => rootDir
  };
}
