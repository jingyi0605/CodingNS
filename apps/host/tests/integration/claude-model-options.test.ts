import { mkdtempSync, mkdirSync, rmSync, writeFileSync } from "node:fs";
import os from "node:os";
import path from "node:path";

import { describe, expect, it } from "vitest";

import { enrichClaudeCapabilities } from "../../src/modules/provider/claude-model-options.js";

describe("enrichClaudeCapabilities", () => {
  it("会把工作区里的 Claude 自定义模型补进能力列表", () => {
    const root = mkdtempSync(path.join(os.tmpdir(), "codingns-claude-models-"));
    const claudeHomeDir = path.join(root, "home", ".claude");
    const workspacePath = path.join(root, "workspace");

    mkdirSync(claudeHomeDir, { recursive: true });
    mkdirSync(path.join(workspacePath, ".claude"), { recursive: true });
    writeFileSync(
      path.join(claudeHomeDir, "settings.json"),
      JSON.stringify(
        {
          env: {
            ANTHROPIC_MODEL: "claude-sonnet-4-6"
          }
        },
        null,
        2
      )
    );
    writeFileSync(
      path.join(workspacePath, ".claude", "settings.json"),
      JSON.stringify(
        {
          env: {
            ANTHROPIC_MODEL: "kimi-k2.5",
            ANTHROPIC_DEFAULT_SONNET_MODEL: "kimi-k2.5",
            ANTHROPIC_DEFAULT_OPUS_MODEL: "kimi-k2.5",
            ANTHROPIC_DEFAULT_HAIKU_MODEL: "kimi-k2.5"
          }
        },
        null,
        2
      )
    );

    try {
      const capabilities = enrichClaudeCapabilities(
        {
          provider: "claude-code",
          canStartSession: true,
          canResumeSession: true,
          canSendMessage: true,
          supportsSubagents: true,
          supportsInterrupt: false,
          supportsStructuredToolCalls: true,
          supportsTokenUsage: true,
          supportsAttachments: true,
          supportsPermissionPrompt: true,
          supportsCheckpoint: false,
          modelOptions: [],
          limitations: []
        },
        {
          claudeHomeDir,
          workspacePath
        }
      );

      expect(capabilities.modelOptions).toEqual([
        {
          id: "provider-default",
          name: "跟随 CLI 默认模型（当前：kimi-k2.5）",
          usesProviderDefault: true
        },
        {
          id: "sonnet",
          name: "Sonnet（当前：kimi-k2.5）"
        },
        {
          id: "opus",
          name: "Opus（当前：kimi-k2.5）"
        },
        {
          id: "haiku",
          name: "Haiku（当前：kimi-k2.5）"
        },
        {
          id: "kimi-k2.5",
          name: "kimi-k2.5"
        }
      ]);
    } finally {
      rmSync(root, { recursive: true, force: true });
    }
  });
});
