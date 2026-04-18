import { cpSync, existsSync, mkdirSync, mkdtempSync, rmSync, writeFileSync } from "node:fs";
import os from "node:os";
import path from "node:path";

import { afterEach, describe, expect, it } from "vitest";

import { cleanupLegacyAssistantRuntimeSkillCopies } from "../../src/modules/skills/assistant-runtime-skill-cleanup.js";
import type { SkillTargetAdapter } from "../../src/modules/skills/skill-target-adapter.js";

const tempDirs: string[] = [];

afterEach(() => {
  while (tempDirs.length > 0) {
    const tempDir = tempDirs.pop();

    if (tempDir) {
      rmSync(tempDir, { recursive: true, force: true });
    }
  }
});

describe("cleanupLegacyAssistantRuntimeSkillCopies", () => {
  it("会删除公共 skill 根目录里的旧官方助手副本", () => {
    const tempDir = mkdtempSync(path.join(os.tmpdir(), "codingns-assistant-skill-cleanup-"));
    tempDirs.push(tempDir);
    const codexRoot = path.join(tempDir, "codex-skills");
    const builtinSkillPath = path.join(process.cwd(), "src/modules/skills/builtin-skills/codingns-assistant");
    const targetPath = path.join(codexRoot, "codingns-assistant");

    mkdirSync(codexRoot, { recursive: true });
    cpSync(builtinSkillPath, targetPath, { recursive: true });

    const result = cleanupLegacyAssistantRuntimeSkillCopies([
      createAdapter("codex", codexRoot)
    ]);

    expect(result).toEqual([
      {
        targetCli: "codex",
        targetPath,
        status: "removed_legacy_copy",
        detail: "检测到旧官方副本，启动时已自动清理"
      }
    ]);
    expect(existsSync(targetPath)).toBe(false);
  });

  it("会保留用户改动过的助手目录，避免误删", () => {
    const tempDir = mkdtempSync(path.join(os.tmpdir(), "codingns-assistant-skill-cleanup-"));
    tempDirs.push(tempDir);
    const claudeRoot = path.join(tempDir, "claude-skills");
    const builtinSkillPath = path.join(process.cwd(), "src/modules/skills/builtin-skills/codingns-assistant");
    const targetPath = path.join(claudeRoot, "codingns-assistant");

    mkdirSync(claudeRoot, { recursive: true });
    cpSync(builtinSkillPath, targetPath, { recursive: true });
    writeFileSync(path.join(targetPath, "notes.md"), "user changed", "utf8");

    const result = cleanupLegacyAssistantRuntimeSkillCopies([
      createAdapter("claude-code", claudeRoot)
    ]);

    expect(result).toEqual([
      {
        targetCli: "claude-code",
        targetPath,
        status: "kept_drifted_copy",
        detail: "检测到用户改动过的保留目录，已保留原目录并继续诊断"
      }
    ]);
    expect(existsSync(targetPath)).toBe(true);
  });
});

function createAdapter(targetCli: SkillTargetAdapter["targetCli"], rootDir: string): SkillTargetAdapter {
  return {
    targetCli,
    resolveRootDir: () => rootDir
  };
}
