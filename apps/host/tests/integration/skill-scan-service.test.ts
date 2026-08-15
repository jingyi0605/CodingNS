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

    const managedDirectory = createSkillDirectory(codexRoot, "team-helper", {
      "SKILL.md": "# Team Helper\n\n这是一个正常受管 skill。",
      "notes.txt": "managed"
    });
    createSkillDirectory(codexRoot, "codingns-assistant", {
      "SKILL.md": "# CodingNS Assistant\n\n这是错误落在公共目录里的助手专用 skill。"
    });
    createSkillDirectory(codexRoot, "local-helper", {
      "SKILL.md": "# Local Helper\n\n这是一个还没纳管的 skill。"
    });
    createSkillDirectory(codexRoot, "conflicted-skill", {
      "SKILL.md": "# Conflicted Skill\n\n当前机器上的内容已经变了。"
    });

    managedSkillRepository.upsert({
      id: "skill-managed-1",
      name: "Team Helper",
      scope: "workspace",
      directoryName: "team-helper",
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
      scope: "workspace",
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
      scope: "workspace",
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
        directoryPath: path.join(codexRoot, "team-helper"),
        directoryName: "team-helper",
        name: "Team Helper",
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
        directoryPath: path.join(codexRoot, "codingns-assistant"),
        directoryName: "codingns-assistant",
        name: "CodingNS Assistant",
        contentHash: computeSkillDirectoryHash(path.join(codexRoot, "codingns-assistant")),
        managementState: "conflicted",
        managedSkillId: null
      },
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
        targetCli: "codex",
        rootDir: codexRoot,
        code: "SKILL_RESERVED_FOR_ASSISTANT_RUNTIME",
        detail: "目录名保留给助手专用运行时资产，不能作为公共 skill 管理：codingns-assistant",
        directoryName: "codingns-assistant",
        directoryPath: path.join(codexRoot, "codingns-assistant"),
        managedSkillId: null
      },
      {
        targetCli: "gemini",
        rootDir: geminiRoot,
        code: "SKILL_TARGET_SKILL_MISSING",
        detail: "目标 CLI 缺少受管 skill：missing-on-gemini",
        directoryName: "missing-on-gemini",
        directoryPath: null,
        managedSkillId: "skill-missing-1"
      },
    ]);
    expect(result.scannedAt).toMatch(/^\d{4}-\d{2}-\d{2}T/);
  });

  it("目标 skill 根目录尚未创建时按空目录处理", () => {
    const tempDir = mkdtempSync(path.join(os.tmpdir(), "codingns-skill-empty-target-"));
    tempDirs.push(tempDir);
    const database = createDatabaseClient(":memory:");
    const missingTargetRoot = path.join(tempDir, "dsh-home", "skills");
    const service = new SkillManagerService(
      new ManagedSkillRepository(database.db),
      new SkillTargetBindingRepository(database.db),
      [createAdapter("deepseek-harness", missingTargetRoot)]
    );

    const result = service.scanSkills();

    database.close();

    expect(result).toMatchObject({
      managed: [],
      unmanaged: [],
      conflicted: [],
      diagnostics: []
    });
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

  it("概况接口会单独返回助手专用内置 Skill，即使公共目录里没有残留副本", () => {
    const tempDir = mkdtempSync(path.join(os.tmpdir(), "codingns-skill-overview-"));
    tempDirs.push(tempDir);
    const database = createDatabaseClient(":memory:");
    const codexRoot = path.join(tempDir, "codex-skills");

    mkdirSync(codexRoot, { recursive: true });

    const service = new SkillManagerService(
      new ManagedSkillRepository(database.db),
      new SkillTargetBindingRepository(database.db),
      [createAdapter("codex", codexRoot)]
    );

    const overview = service.getOverview();

    database.close();

    expect(overview.assistantRuntimeSkills).toEqual([
      expect.objectContaining({
        name: "codingns-assistant",
        directoryName: "codingns-assistant",
        usedByTargetCli: ["codex", "claude-code"]
      }),
      expect.objectContaining({
        name: "codingns-workspace-session",
        directoryName: "codingns-workspace-session",
        usedByTargetCli: ["codex", "claude-code"]
      })
    ]);
    expect(overview.assistantRuntimeSkills[0]?.sourcePath).toContain("builtin-skills/codingns-assistant");
    expect(overview.assistantRuntimeSkills[1]?.sourcePath).toContain("builtin-skills/codingns-workspace-session");
  });

  it("工作区会话 MCP 状态会使用仓库根目录解析 codingns.mjs，而不是误拼到 apps/host 下", () => {
    const tempDir = mkdtempSync(path.join(os.tmpdir(), "codingns-skill-mcp-status-"));
    tempDirs.push(tempDir);
    const database = createDatabaseClient(":memory:");
    const codexRoot = path.join(tempDir, "codex-skills");
    const workspaceRoot = path.join(tempDir, "workspace");
    const runtimeStorageRootDir = path.join(tempDir, "host-data");

    mkdirSync(codexRoot, { recursive: true });
    mkdirSync(workspaceRoot, { recursive: true });
    mkdirSync(runtimeStorageRootDir, { recursive: true });

    const service = new SkillManagerService(
      new ManagedSkillRepository(database.db),
      new SkillTargetBindingRepository(database.db),
      [createAdapter("codex", codexRoot)],
      {
        runtimeStorageRootDir,
        workspaceRootResolver: () => workspaceRoot
      }
    );

    const status = service.getWorkspaceSessionMcpStatus({
      workspaceId: "workspace-1",
      sessionId: "session-1"
    });

    database.close();

    expect(status.runtime.runtimeHomeDir).toBe(
      path.join(runtimeStorageRootDir, "workspace-session-runtime", "workspace-1", "session-1")
    );
    expect(status.commands.repoCodingnsWorkspaceMcpDetail).toContain("workspace-office");
    expect(status.commands.repoCodingnsWorkspaceMcpDetail).not.toContain("/apps/host/packages/codingns/bin/codingns.mjs");
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
