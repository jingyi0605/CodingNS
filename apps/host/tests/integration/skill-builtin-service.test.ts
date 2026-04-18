import { existsSync, mkdirSync, mkdtempSync, readFileSync, rmSync, writeFileSync } from "node:fs";
import os from "node:os";
import path from "node:path";

import { afterEach, describe, expect, it } from "vitest";

import { SkillManagerService } from "../../src/modules/skills/skill-manager-service.js";
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

describe("SkillManagerService.ensureBuiltinSkill", () => {
  it("会用内置 skill 更新 SSOT，并强制覆盖 Codex 与 Claude Code 目录", () => {
    const tempDir = mkdtempSync(path.join(os.tmpdir(), "codingns-skill-builtin-"));
    tempDirs.push(tempDir);
    const database = createDatabaseClient(":memory:");
    const managedSkillRepository = new ManagedSkillRepository(database.db);
    const skillTargetBindingRepository = new SkillTargetBindingRepository(database.db);
    const ssotRootDir = path.join(tempDir, "skill-ssot");
    const builtinRoot = path.join(tempDir, "builtin");
    const codexRoot = path.join(tempDir, "codex-skills");
    const claudeRoot = path.join(tempDir, "claude-skills");

    mkdirSync(builtinRoot, { recursive: true });
    mkdirSync(codexRoot, { recursive: true });
    mkdirSync(claudeRoot, { recursive: true });

    const builtinPath = createSkillDirectory(builtinRoot, "host-shared-helper", {
      "SKILL.md": "# Host Shared Helper\n\n这是新的内置版本。",
      "references/cli-workflow.md": "# cli\n"
    });

    managedSkillRepository.upsert({
      id: "skill-host-shared-helper",
      name: "Host Shared Helper",
      directoryName: "host-shared-helper",
      sourceType: "local-import",
      sourcePath: "/tmp/legacy-skill",
      contentHash: "legacy-hash",
      managedState: "active",
      createdAt: "2026-04-14T12:00:00.000Z",
      updatedAt: "2026-04-14T12:00:00.000Z"
    });
    createSkillDirectory(codexRoot, "host-shared-helper", {
      "SKILL.md": "# Host Shared Helper\n\n这是旧目录内容。",
      "references/cli-workflow.md": "# old\n"
    });

    const service = new SkillManagerService(
      managedSkillRepository,
      skillTargetBindingRepository,
      [
        createAdapter("codex", codexRoot),
        createAdapter("claude-code", claudeRoot)
      ],
      {
        ssotRootDir,
        now: () => "2026-04-16T10:00:00.000Z"
      }
    );

    const result = service.ensureBuiltinSkill({
      sourcePath: builtinPath,
      targetCli: ["codex", "claude-code"]
    });

    database.close();

    expect(result.skill.sourceType).toBe("builtin");
    expect(result.skill.sourcePath).toBe(path.resolve(builtinPath));
    expect(result.targetResults).toEqual([
      {
        targetCli: "codex",
        targetDir: path.join(codexRoot, "host-shared-helper"),
        syncStatus: "synced",
        lastSyncedAt: "2026-04-16T10:00:00.000Z",
        errorCode: null,
        errorDetail: null
      },
      {
        targetCli: "claude-code",
        targetDir: path.join(claudeRoot, "host-shared-helper"),
        syncStatus: "synced",
        lastSyncedAt: "2026-04-16T10:00:00.000Z",
        errorCode: null,
        errorDetail: null
      }
    ]);
    expect(existsSync(path.join(ssotRootDir, "host-shared-helper", "SKILL.md"))).toBe(true);
    expect(readFileSync(path.join(codexRoot, "host-shared-helper", "SKILL.md"), "utf8")).toContain(
      "新的内置版本"
    );
    expect(readFileSync(path.join(claudeRoot, "host-shared-helper", "SKILL.md"), "utf8")).toContain(
      "新的内置版本"
    );
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
