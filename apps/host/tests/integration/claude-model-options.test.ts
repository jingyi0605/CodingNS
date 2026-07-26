import { mkdtempSync, mkdirSync, rmSync, writeFileSync } from "node:fs";
import os from "node:os";
import path from "node:path";

import { describe, expect, it, vi } from "vitest";

import {
  ClaudeModelOptionsService,
  enrichClaudeCapabilities,
  enrichClaudeCapabilitiesWithDiscovery
} from "../../src/modules/provider/claude-model-options.js";

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
          inRunInputMode: "streaming_guidance",
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

  it("会通过 Claude 初始化协议返回当前配置可见的完整模型列表", async () => {
    const root = mkdtempSync(path.join(os.tmpdir(), "codingns-claude-model-probe-"));
    const commandPath = path.join(root, "fake-claude.cjs");
    const claudeHomeDir = path.join(root, ".claude");

    mkdirSync(claudeHomeDir, { recursive: true });
    writeFileSync(
      commandPath,
      [
        "process.stdin.resume();",
        "process.stdin.on('end', () => {",
        "  process.stdout.write(JSON.stringify({",
        "    type: 'control_response',",
        "    response: {",
        "      subtype: 'success',",
        "      request_id: 'codingns-model-discovery',",
        "      response: { models: [",
        "        { value: 'default', displayName: 'Default (recommended)', supportedEffortLevels: ['low', 'high'] },",
        "        { value: 'opus[1m]', displayName: 'Opus' },",
        "        { value: 'sonnet', displayName: 'Sonnet' },",
        "        { value: 'sonnet[1m]', displayName: 'Sonnet (1M context)' },",
        "        { value: 'haiku', displayName: 'Haiku' }",
        "      ] }",
        "    }",
        "  }) + '\\n');",
        "});",
        ""
      ].join("\n"),
      "utf8"
    );

    try {
      const service = new ClaudeModelOptionsService({
        commandPath,
        timeoutMs: 2_000
      });
      const snapshot = await service.readSnapshot({ claudeHomeDir });

      expect(snapshot.modelOptions).toEqual([
        {
          id: "provider-default",
          name: "Default (recommended)",
          usesProviderDefault: true,
          supportedReasoningEfforts: ["low", "high"]
        },
        {
          id: "opus[1m]",
          name: "Opus",
          usesProviderDefault: undefined,
          supportedReasoningEfforts: undefined
        },
        {
          id: "sonnet",
          name: "Sonnet",
          usesProviderDefault: undefined,
          supportedReasoningEfforts: undefined
        },
        {
          id: "sonnet[1m]",
          name: "Sonnet (1M context)",
          usesProviderDefault: undefined,
          supportedReasoningEfforts: undefined
        },
        {
          id: "haiku",
          name: "Haiku",
          usesProviderDefault: undefined,
          supportedReasoningEfforts: undefined
        }
      ]);
    } finally {
      rmSync(root, { recursive: true, force: true });
    }
  });

  it("自定义 Anthropic 地址会把上游完整目录与 Claude CLI 别名合并", async () => {
    const root = mkdtempSync(path.join(os.tmpdir(), "codingns-claude-model-catalog-"));
    const commandPath = path.join(root, "fake-claude.cjs");
    const claudeHomeDir = path.join(root, ".claude");

    mkdirSync(claudeHomeDir, { recursive: true });
    writeFakeClaudeCommand(commandPath, [
      { value: "default", displayName: "Default" },
      { value: "sonnet", displayName: "Sonnet" }
    ]);
    const fetchImpl = vi.fn(async (..._args: Parameters<typeof fetch>) => new Response(
      JSON.stringify({
        data: [
          { id: "claude-opus-4-8", display_name: "Claude Opus 4.8" },
          { id: "claude-sonnet-5" }
        ]
      }),
      {
        status: 200,
        headers: {
          "content-type": "application/json"
        }
      }
    ));

    try {
      const service = new ClaudeModelOptionsService({
        commandPath,
        timeoutMs: 2_000,
        fetchImpl
      });
      const snapshot = await service.readSnapshot({
        claudeHomeDir,
        runtimeEnv: {
          ANTHROPIC_BASE_URL: "https://gateway.example/v1",
          ANTHROPIC_AUTH_TOKEN: "test-token"
        }
      });

      expect(snapshot.modelOptions).toEqual([
        {
          id: "provider-default",
          name: "Default",
          usesProviderDefault: true,
          supportedReasoningEfforts: undefined
        },
        {
          id: "sonnet",
          name: "Sonnet",
          usesProviderDefault: undefined,
          supportedReasoningEfforts: undefined
        },
        {
          id: "claude-opus-4-8",
          name: "Claude Opus 4.8"
        },
        {
          id: "claude-sonnet-5",
          name: "claude-sonnet-5"
        }
      ]);
      expect(fetchImpl).toHaveBeenCalledTimes(1);
      const [requestUrl, requestInit] = fetchImpl.mock.calls[0]!;
      expect(requestUrl).toBe("https://gateway.example/v1/models");
      expect(requestInit?.headers).toMatchObject({
        authorization: "Bearer test-token",
        "x-api-key": "test-token",
        "anthropic-version": "2023-06-01"
      });
    } finally {
      rmSync(root, { recursive: true, force: true });
    }
  });

  it("上游模型目录失败时保留 Claude CLI 模型列表", async () => {
    const root = mkdtempSync(path.join(os.tmpdir(), "codingns-claude-model-catalog-fallback-"));
    const commandPath = path.join(root, "fake-claude.cjs");
    const claudeHomeDir = path.join(root, ".claude");

    mkdirSync(claudeHomeDir, { recursive: true });
    writeFakeClaudeCommand(commandPath, [
      { value: "default", displayName: "Default" },
      { value: "haiku", displayName: "Haiku" }
    ]);

    try {
      const service = new ClaudeModelOptionsService({
        commandPath,
        timeoutMs: 2_000,
        fetchImpl: vi.fn(async () => new Response("Not Found", { status: 404 }))
      });
      const snapshot = await service.readSnapshot({
        claudeHomeDir,
        runtimeEnv: {
          ANTHROPIC_BASE_URL: "https://gateway.example"
        }
      });

      expect(snapshot.modelOptions.map((model) => model.id)).toEqual([
        "provider-default",
        "haiku"
      ]);
    } finally {
      rmSync(root, { recursive: true, force: true });
    }
  });

  it("Claude CLI 探测失败时仍可使用自定义上游模型目录", async () => {
    const root = mkdtempSync(path.join(os.tmpdir(), "codingns-claude-model-cli-fallback-"));
    const commandPath = path.join(root, "failing-claude.cjs");
    const claudeHomeDir = path.join(root, ".claude");

    mkdirSync(claudeHomeDir, { recursive: true });
    writeFileSync(commandPath, "process.exit(1);\n", "utf8");

    try {
      const service = new ClaudeModelOptionsService({
        commandPath,
        timeoutMs: 2_000,
        fetchImpl: vi.fn(async () => new Response(
          JSON.stringify({ data: [{ id: "grok-4.5" }] }),
          { status: 200 }
        ))
      });
      const snapshot = await service.readSnapshot({
        claudeHomeDir,
        runtimeEnv: {
          ANTHROPIC_BASE_URL: "https://gateway.example/anthropic"
        }
      });

      expect(snapshot.modelOptions).toEqual([
        {
          id: "provider-default",
          name: "跟随 CLI 默认模型",
          usesProviderDefault: true
        },
        {
          id: "grok-4.5",
          name: "grok-4.5"
        }
      ]);
    } finally {
      rmSync(root, { recursive: true, force: true });
    }
  });

  it("动态探测失败时会回退，并保留配置中的完整 Claude 模型 ID", async () => {
    const root = mkdtempSync(path.join(os.tmpdir(), "codingns-claude-model-fallback-"));
    const claudeHomeDir = path.join(root, ".claude");

    mkdirSync(claudeHomeDir, { recursive: true });
    writeFileSync(
      path.join(claudeHomeDir, "settings.json"),
      JSON.stringify({
        env: {
          ANTHROPIC_MODEL: "claude-sonnet-4-6"
        }
      }),
      "utf8"
    );

    try {
      const capabilities = await enrichClaudeCapabilitiesWithDiscovery(
        createClaudeCapabilities(),
        { claudeHomeDir },
        {
          readSnapshot: vi.fn().mockRejectedValue(new Error("probe failed"))
        }
      );

      expect(capabilities.modelOptions).toContainEqual({
        id: "claude-sonnet-4-6",
        name: "claude-sonnet-4-6"
      });
      expect(capabilities.limitations).toContain(
        "当前无法读取 Claude Code 完整模型列表，暂时显示默认别名和配置中声明的模型。"
      );
    } finally {
      rmSync(root, { recursive: true, force: true });
    }
  });
});

function createClaudeCapabilities() {
  return {
    provider: "claude-code" as const,
    canStartSession: true,
    canResumeSession: true,
    canSendMessage: true,
    inRunInputMode: "streaming_guidance" as const,
    supportsSubagents: true,
    supportsInterrupt: false,
    supportsStructuredToolCalls: true,
    supportsTokenUsage: true,
    supportsAttachments: true,
    supportsPermissionPrompt: true,
    supportsCheckpoint: false,
    modelOptions: [],
    limitations: []
  };
}

function writeFakeClaudeCommand(
  commandPath: string,
  models: Array<Record<string, unknown>>
): void {
  const output = `${JSON.stringify({
    type: "control_response",
    response: {
      subtype: "success",
      request_id: "codingns-model-discovery",
      response: { models }
    }
  })}\n`;

  writeFileSync(
    commandPath,
    [
      "process.stdin.resume();",
      "process.stdin.on('end', () => {",
      `  process.stdout.write(${JSON.stringify(output)});`,
      "});",
      ""
    ].join("\n"),
    "utf8"
  );
}
