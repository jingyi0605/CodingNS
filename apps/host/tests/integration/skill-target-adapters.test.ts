import path from "node:path";

import { describe, expect, it } from "vitest";

import type { HostConfig } from "../../src/config/env.js";
import {
  ClaudeCodeSkillTargetAdapter,
  CodexSkillTargetAdapter,
  DeepSeekHarnessSkillTargetAdapter,
  GeminiSkillTargetAdapter,
  OpenCodeSkillTargetAdapter,
  createDefaultSkillTargetAdapters,
  resolveSkillTargetLocation
} from "../../src/modules/skills/skill-target-adapter.js";

describe("SkillTargetAdapter", () => {
  it("会把 Claude、Codex、Gemini、DeepSeek Harness 的 skill 根目录解析到各自 home 下", () => {
    const config = {
      claudeCodeHomeDir: "/tmp/claude-home",
      codexHomeDir: "/tmp/codex-home",
      geminiHomeDir: "/tmp/gemini-home",
      deepseekHarnessHomeDir: "/tmp/dsh-home"
    } satisfies Pick<HostConfig, "claudeCodeHomeDir" | "codexHomeDir" | "geminiHomeDir" | "deepseekHarnessHomeDir">;

    expect(new ClaudeCodeSkillTargetAdapter(config).resolveRootDir()).toBe(
      path.resolve("/tmp/claude-home", "skills")
    );
    expect(new CodexSkillTargetAdapter(config).resolveRootDir()).toBe(
      path.resolve("/tmp/codex-home", "skills")
    );
    expect(new GeminiSkillTargetAdapter(config).resolveRootDir()).toBe(
      path.resolve("/tmp/gemini-home", "skills")
    );
    expect(new DeepSeekHarnessSkillTargetAdapter(config).resolveRootDir()).toBe(
      path.resolve("/tmp/dsh-home", "skills")
    );
  });

  it("默认适配器集合允许按目标 CLI 获取 skill 根目录", () => {
    const config = {
      claudeCodeHomeDir: "/tmp/claude-home",
      codexHomeDir: "/tmp/codex-home",
      geminiHomeDir: "/tmp/gemini-home",
      deepseekHarnessHomeDir: "/tmp/dsh-home"
    } satisfies Pick<HostConfig, "claudeCodeHomeDir" | "codexHomeDir" | "geminiHomeDir" | "deepseekHarnessHomeDir">;
    const adapters = createDefaultSkillTargetAdapters(config);

    expect(resolveSkillTargetLocation(adapters, "codex")).toEqual({
      targetCli: "codex",
      rootDir: path.resolve("/tmp/codex-home", "skills")
    });
    expect(resolveSkillTargetLocation(adapters, "deepseek-harness")).toEqual({
      targetCli: "deepseek-harness",
      rootDir: path.resolve("/tmp/dsh-home", "skills")
    });
  });

  it("遇到不受支持的目标会直接拒绝", () => {
    const adapters = [new OpenCodeSkillTargetAdapter()];

    expect(() =>
      resolveSkillTargetLocation(
        adapters,
        "gemini"
      )
    ).toThrowError("SKILL_TARGET_NOT_SUPPORTED");
  });
});
