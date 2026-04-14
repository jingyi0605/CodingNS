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

describe("SkillManagerService.addManagedSkill", () => {
  it("会把本地 skill 纳入 SSOT，并只同步到指定目标 CLI", () => {
    const tempDir = mkdtempSync(path.join(os.tmpdir(), "codingns-skill-add-"));
    tempDirs.push(tempDir);
    const database = createDatabaseClient(":memory:");
    const ssotRootDir = path.join(tempDir, "skill-ssot");
    const sourceRoot = path.join(tempDir, "sources");
    const codexRoot = path.join(tempDir, "codex-skills");
    const geminiRoot = path.join(tempDir, "gemini-skills");

    mkdirSync(sourceRoot, { recursive: true });
    mkdirSync(codexRoot, { recursive: true });
    mkdirSync(geminiRoot, { recursive: true });

    const sourcePath = createSkillDirectory(sourceRoot, "team-helper", {
      "SKILL.md": "# Team Helper\n\n这是给团队用的新 skill。",
      "notes/usage.txt": "hello"
    });
    const service = new SkillManagerService(
      new ManagedSkillRepository(database.db),
      new SkillTargetBindingRepository(database.db),
      [createAdapter("codex", codexRoot), createAdapter("gemini", geminiRoot)],
      {
        ssotRootDir,
        now: () => "2026-04-14T13:00:00.000Z",
        createId: () => "skill-team-helper"
      }
    );

    const result = service.addManagedSkill({
      sourcePath,
      targetCli: ["codex"],
      sourceType: "local-import"
    });

    database.close();

    expect(result.skill).toEqual({
      id: "skill-team-helper",
      name: "Team Helper",
      directoryName: "team-helper",
      sourceType: "local-import",
      sourcePath: path.resolve(sourcePath),
      contentHash: computeSkillDirectoryHash(sourcePath),
      managedState: "active",
      createdAt: "2026-04-14T13:00:00.000Z",
      updatedAt: "2026-04-14T13:00:00.000Z"
    });
    expect(result.targetResults).toEqual([
      {
        targetCli: "codex",
        targetDir: path.join(codexRoot, "team-helper"),
        syncStatus: "synced",
        lastSyncedAt: "2026-04-14T13:00:00.000Z",
        errorCode: null,
        errorDetail: null
      }
    ]);
    expect(result.bindings).toEqual([
      {
        skillId: "skill-team-helper",
        targetCli: "codex",
        enabled: true,
        syncStatus: "synced",
        lastSyncedAt: "2026-04-14T13:00:00.000Z",
        lastErrorCode: null,
        lastErrorDetail: null
      }
    ]);
    expect(existsSync(path.join(ssotRootDir, "team-helper", "SKILL.md"))).toBe(true);
    expect(existsSync(path.join(codexRoot, "team-helper", "SKILL.md"))).toBe(true);
    expect(existsSync(path.join(geminiRoot, "team-helper"))).toBe(false);
    expect(readFileSync(path.join(codexRoot, "team-helper", "SKILL.md"), "utf8")).toContain("Team Helper");
  });

  it("遇到目标目录同名不同内容时会标记冲突，但不会覆盖其他目标", () => {
    const tempDir = mkdtempSync(path.join(os.tmpdir(), "codingns-skill-conflict-"));
    tempDirs.push(tempDir);
    const database = createDatabaseClient(":memory:");
    const managedSkillRepository = new ManagedSkillRepository(database.db);
    const skillTargetBindingRepository = new SkillTargetBindingRepository(database.db);
    const ssotRootDir = path.join(tempDir, "skill-ssot");
    const sourceRoot = path.join(tempDir, "sources");
    const codexRoot = path.join(tempDir, "codex-skills");
    const geminiRoot = path.join(tempDir, "gemini-skills");

    mkdirSync(sourceRoot, { recursive: true });
    mkdirSync(codexRoot, { recursive: true });
    mkdirSync(geminiRoot, { recursive: true });

    const sourcePath = createSkillDirectory(sourceRoot, "shared-helper", {
      "SKILL.md": "# Shared Helper\n\n这是新的统一版本。"
    });
    const codexTargetPath = createSkillDirectory(codexRoot, "shared-helper", {
      "SKILL.md": "# Shared Helper\n\n这是旧版本，内容不同。"
    });
    const originalCodexContent = readFileSync(path.join(codexTargetPath, "SKILL.md"), "utf8");
    const service = new SkillManagerService(
      managedSkillRepository,
      skillTargetBindingRepository,
      [createAdapter("codex", codexRoot), createAdapter("gemini", geminiRoot)],
      {
        ssotRootDir,
        now: () => "2026-04-14T13:10:00.000Z",
        createId: () => "skill-shared-helper"
      }
    );

    const result = service.addManagedSkill({
      sourcePath,
      targetCli: ["codex", "gemini"],
      sourceType: "local-import"
    });

    const storedSkill = managedSkillRepository.findById("skill-shared-helper");
    const bindings = skillTargetBindingRepository.listBySkillId("skill-shared-helper");

    database.close();

    expect(storedSkill?.directoryName).toBe("shared-helper");
    expect(result.targetResults).toEqual([
      {
        targetCli: "codex",
        targetDir: path.join(codexRoot, "shared-helper"),
        syncStatus: "conflicted",
        lastSyncedAt: null,
        errorCode: "SKILL_NAME_CONFLICT",
        errorDetail: "目标 CLI 目录里已存在同名 skill，且内容与受管 skill 不一致"
      },
      {
        targetCli: "gemini",
        targetDir: path.join(geminiRoot, "shared-helper"),
        syncStatus: "synced",
        lastSyncedAt: "2026-04-14T13:10:00.000Z",
        errorCode: null,
        errorDetail: null
      }
    ]);
    expect(bindings).toEqual([
      {
        skillId: "skill-shared-helper",
        targetCli: "codex",
        enabled: true,
        syncStatus: "conflicted",
        lastSyncedAt: null,
        lastErrorCode: "SKILL_NAME_CONFLICT",
        lastErrorDetail: "目标 CLI 目录里已存在同名 skill，且内容与受管 skill 不一致"
      },
      {
        skillId: "skill-shared-helper",
        targetCli: "gemini",
        enabled: true,
        syncStatus: "synced",
        lastSyncedAt: "2026-04-14T13:10:00.000Z",
        lastErrorCode: null,
        lastErrorDetail: null
      }
    ]);
    expect(readFileSync(path.join(codexRoot, "shared-helper", "SKILL.md"), "utf8")).toBe(originalCodexContent);
    expect(readFileSync(path.join(geminiRoot, "shared-helper", "SKILL.md"), "utf8")).toContain("新的统一版本");
  });

  it("同名受管 skill 内容不一致时会直接拒绝", () => {
    const tempDir = mkdtempSync(path.join(os.tmpdir(), "codingns-skill-existing-"));
    tempDirs.push(tempDir);
    const database = createDatabaseClient(":memory:");
    const managedSkillRepository = new ManagedSkillRepository(database.db);
    const skillTargetBindingRepository = new SkillTargetBindingRepository(database.db);
    const ssotRootDir = path.join(tempDir, "skill-ssot");
    const sourceRoot = path.join(tempDir, "sources");
    const codexRoot = path.join(tempDir, "codex-skills");

    mkdirSync(sourceRoot, { recursive: true });
    mkdirSync(codexRoot, { recursive: true });

    const sourcePath = createSkillDirectory(sourceRoot, "same-name", {
      "SKILL.md": "# Same Name\n\n这是当前来源。"
    });
    managedSkillRepository.upsert({
      id: "skill-existing",
      name: "Same Name",
      directoryName: "same-name",
      sourceType: "local-import",
      sourcePath: "/tmp/old",
      contentHash: "other-hash",
      managedState: "active",
      createdAt: "2026-04-14T12:00:00.000Z",
      updatedAt: "2026-04-14T12:00:00.000Z"
    });
    const service = new SkillManagerService(
      managedSkillRepository,
      skillTargetBindingRepository,
      [createAdapter("codex", codexRoot)],
      {
        ssotRootDir,
        now: () => "2026-04-14T13:20:00.000Z",
        createId: () => "skill-new"
      }
    );

    expect(() =>
      service.addManagedSkill({
        sourcePath,
        targetCli: ["codex"],
        sourceType: "local-import"
      })
    ).toThrowError("已存在同名受管 skill，且内容与当前来源目录不一致");
    expect(skillTargetBindingRepository.listBySkillId("skill-existing")).toEqual([]);
    expect(existsSync(path.join(ssotRootDir, "same-name"))).toBe(false);

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
