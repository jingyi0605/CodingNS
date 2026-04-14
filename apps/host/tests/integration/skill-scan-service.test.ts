import { mkdirSync, mkdtempSync, rmSync, writeFileSync } from "node:fs";
import os from "node:os";
import path from "node:path";

import { afterEach, describe, expect, it } from "vitest";

import { SkillManagerService, computeSkillDirectoryHash } from "../../src/modules/skills/skill-manager-service.js";
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

describe("SkillManagerService.scanSkills", () => {
  it("会返回受管、未纳管、冲突和诊断四类结果", () => {
    const tempDir = mkdtempSync(path.join(os.tmpdir(), "codingns-skill-scan-"));
    tempDirs.push(tempDir);
    const database = createDatabaseClient(":memory:");
    const managedSkillRepository = new ManagedSkillRepository(database.db);
    const skillTargetBindingRepository = new SkillTargetBindingRepository(database.db);
    const codexRoot = path.join(tempDir, "codex-skills");
    const geminiRoot = path.join(tempDir, "gemini-skills");
    const missingOpenCodeRoot = path.join(tempDir, "opencode-skills-missing");

    mkdirSync(codexRoot, { recursive: true });
    mkdirSync(geminiRoot, { recursive: true });

    const managedDirectory = createSkillDirectory(codexRoot, "codingns-assistant", {
      "SKILL.md": "# CodingNS Assistant\n\n帮助你接管 CodingNS 项目。",
      "notes.txt": "managed"
    });
    createSkillDirectory(codexRoot, "local-helper", {
      "SKILL.md": "# Local Helper\n\n这是一个还没纳管的 skill。"
    });
    createSkillDirectory(codexRoot, "conflicted-skill", {
      "SKILL.md": "# Conflicted Skill\n\n当前机器上的内容已经变了。"
    });

    managedSkillRepository.upsert({
      id: "skill-managed-1",
      name: "CodingNS Assistant",
      directoryName: "codingns-assistant",
      sourceType: "builtin",
      sourcePath: null,
      contentHash: computeSkillDirectoryHash(managedDirectory),
      managedState: "active",
      createdAt: "2026-04-14T12:00:00.000Z",
      updatedAt: "2026-04-14T12:00:00.000Z"
    });
    managedSkillRepository.upsert({
      id: "skill-conflicted-1",
      name: "Conflicted Skill",
      directoryName: "conflicted-skill",
      sourceType: "managed-copy",
      sourcePath: null,
      contentHash: "expected-other-hash",
      managedState: "active",
      createdAt: "2026-04-14T12:05:00.000Z",
      updatedAt: "2026-04-14T12:05:00.000Z"
    });
    managedSkillRepository.upsert({
      id: "skill-missing-1",
      name: "Missing On Gemini",
      directoryName: "missing-on-gemini",
      sourceType: "managed-copy",
      sourcePath: null,
      contentHash: "hash-missing",
      managedState: "active",
      createdAt: "2026-04-14T12:10:00.000Z",
      updatedAt: "2026-04-14T12:10:00.000Z"
    });

    skillTargetBindingRepository.upsert({
      skillId: "skill-managed-1",
      targetCli: "codex",
      enabled: true,
      syncStatus: "synced",
      lastSyncedAt: "2026-04-14T12:01:00.000Z",
      lastErrorCode: null,
      lastErrorDetail: null
    });
    skillTargetBindingRepository.upsert({
      skillId: "skill-conflicted-1",
      targetCli: "codex",
      enabled: true,
      syncStatus: "conflicted",
      lastSyncedAt: null,
      lastErrorCode: "SKILL_HASH_DRIFT",
      lastErrorDetail: null
    });
    skillTargetBindingRepository.upsert({
      skillId: "skill-missing-1",
      targetCli: "gemini",
      enabled: true,
      syncStatus: "pending",
      lastSyncedAt: null,
      lastErrorCode: null,
      lastErrorDetail: null
    });

    const service = new SkillManagerService(
      managedSkillRepository,
      skillTargetBindingRepository,
      [
        createAdapter("codex", codexRoot),
        createAdapter("gemini", geminiRoot),
        createAdapter("opencode", missingOpenCodeRoot)
      ]
    );

    const result = service.scanSkills();

    database.close();

    expect(result.managed).toEqual([
      {
        targetCli: "codex",
        directoryPath: path.join(codexRoot, "codingns-assistant"),
        directoryName: "codingns-assistant",
        name: "CodingNS Assistant",
        contentHash: computeSkillDirectoryHash(managedDirectory),
        managementState: "managed",
        managedSkillId: "skill-managed-1"
      }
    ]);
    expect(result.unmanaged).toEqual([
      {
        targetCli: "codex",
        directoryPath: path.join(codexRoot, "local-helper"),
        directoryName: "local-helper",
        name: "Local Helper",
        contentHash: computeSkillDirectoryHash(path.join(codexRoot, "local-helper")),
        managementState: "unmanaged",
        managedSkillId: null
      }
    ]);
    expect(result.conflicted).toEqual([
      {
        targetCli: "codex",
        directoryPath: path.join(codexRoot, "conflicted-skill"),
        directoryName: "conflicted-skill",
        name: "Conflicted Skill",
        contentHash: computeSkillDirectoryHash(path.join(codexRoot, "conflicted-skill")),
        managementState: "conflicted",
        managedSkillId: "skill-conflicted-1"
      }
    ]);
    expect(result.diagnostics).toEqual([
      {
        targetCli: "gemini",
        rootDir: geminiRoot,
        code: "SKILL_TARGET_SKILL_MISSING",
        detail: "目标 CLI 缺少受管 skill：missing-on-gemini",
        directoryName: "missing-on-gemini",
        directoryPath: null,
        managedSkillId: "skill-missing-1"
      },
      {
        targetCli: "opencode",
        rootDir: missingOpenCodeRoot,
        code: "SKILL_TARGET_ROOT_MISSING",
        detail: "目标 skill 根目录不存在",
        directoryName: null,
        directoryPath: null,
        managedSkillId: null
      }
    ]);
    expect(result.scannedAt).toMatch(/^\d{4}-\d{2}-\d{2}T/);
  });

  it("按目标过滤扫描，并在目标不受支持时直接拒绝", () => {
    const tempDir = mkdtempSync(path.join(os.tmpdir(), "codingns-skill-scan-filter-"));
    tempDirs.push(tempDir);
    const database = createDatabaseClient(":memory:");
    const codexRoot = path.join(tempDir, "codex-skills");

    mkdirSync(codexRoot, { recursive: true });
    createSkillDirectory(codexRoot, "codex-only", {
      "SKILL.md": "# Codex Only\n\n只存在于 Codex 根目录。"
    });

    const service = new SkillManagerService(
      new ManagedSkillRepository(database.db),
      new SkillTargetBindingRepository(database.db),
      [createAdapter("codex", codexRoot)]
    );

    expect(service.scanSkills({ targetCli: ["codex"] }).unmanaged).toEqual([
      {
        targetCli: "codex",
        directoryPath: path.join(codexRoot, "codex-only"),
        directoryName: "codex-only",
        name: "Codex Only",
        contentHash: computeSkillDirectoryHash(path.join(codexRoot, "codex-only")),
        managementState: "unmanaged",
        managedSkillId: null
      }
    ]);
    expect(() => service.scanSkills({ targetCli: ["gemini"] })).toThrowError(
      "存在不受支持的 skill 目标"
    );

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
