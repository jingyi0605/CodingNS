import { mkdtempSync, mkdirSync, writeFileSync } from "node:fs";
import os from "node:os";
import path from "node:path";

import { describe, expect, it } from "vitest";

import { AffairsLightweightSessionService } from "../../src/modules/workspace/affairs-lightweight-session-service.js";

describe("AffairsLightweightSessionService", () => {
  it("Claude 轻量会话会优先使用当前生效 provider 配置里的 runtimeEnv", async () => {
    const service = new AffairsLightweightSessionService(
      "/tmp/codingns-host-tests",
      {
        prepareSessionBinding: () => ({
          providerConfigMode: "cc-switch-preset",
          providerPresetId: "preset-claude-active",
          runtimeHomeDir: "/tmp/codingns-host-tests/runtime-home"
        }),
        resolveLaunchContext: () => ({
          runtimeHomeDir: "/tmp/codingns-host-tests/runtime-home",
          runtimeEnv: {
            ANTHROPIC_AUTH_TOKEN: "active-token-from-runtime",
            ANTHROPIC_BASE_URL: "https://anthropic-runtime.example",
            ANTHROPIC_MODEL: "claude-runtime-model"
          }
        })
      }
    );

    const runtime = await (service as any).readAnthropicRuntimeConfig({
      sessionId: "light-session-1",
      workspaceId: "workspace-1",
      provider: "claude-code",
      providerConfigMode: "cc-switch-preset",
      providerPresetId: "preset-claude-active"
    }, null);

    expect(runtime).toEqual({
      apiKey: "active-token-from-runtime",
      baseUrl: "https://anthropic-runtime.example",
      model: "claude-runtime-model"
    });
  });

  it("Claude 轻量会话会按 sourceWorkspaceId 推断最近真实工作区会话的模型", async () => {
    const hostRootDir = mkdtempSync(path.join(os.tmpdir(), "codingns-lightweight-host-"));
    const sourceWorkspaceId = "workspace-source-1";
    const affairsWorkspaceId = "affairs-global-workspace";
    const sessionId = "light-session-2";
    const runtimeSessionId = "runtime-session-1";
    const workspacePath = "/Users/jackson/Code/CodingNS";
    const transcriptDir = path.join(
      hostRootDir,
      "workspace-session-runtime",
      sourceWorkspaceId,
      runtimeSessionId,
      "projects",
      "-Users-jackson-Code-CodingNS"
    );
    mkdirSync(transcriptDir, { recursive: true });
    writeFileSync(
      path.join(transcriptDir, "provider-session.jsonl"),
      [
        JSON.stringify({
          type: "assistant",
          timestamp: "2026-06-12T07:18:27.772Z",
          cwd: workspacePath,
          message: {
            model: "claude-sonnet-4-6"
          }
        })
      ].join("\n"),
      "utf8"
    );

    const service = new AffairsLightweightSessionService(
      hostRootDir,
      {
        prepareSessionBinding: () => ({
          providerConfigMode: "global-default",
          providerPresetId: null,
          runtimeHomeDir: null
        }),
        resolveLaunchContext: () => ({
          runtimeHomeDir: null,
          runtimeEnv: {
            ANTHROPIC_AUTH_TOKEN: "active-token-from-runtime",
            ANTHROPIC_BASE_URL: "https://anthropic-runtime.example"
          }
        })
      },
      {
        getWorkspaceOrThrow: (workspaceId: string) => ({
          id: workspaceId,
          path: workspacePath
        })
      }
    );

    const runtime = await (service as any).readAnthropicRuntimeConfig({
      sessionId,
      workspaceId: affairsWorkspaceId,
      sourceWorkspaceId,
      provider: "claude-code",
      providerConfigMode: "global-default",
      providerPresetId: null
    }, null, "user-1");

    expect(runtime).toEqual({
      apiKey: "active-token-from-runtime",
      baseUrl: "https://anthropic-runtime.example",
      model: "claude-sonnet-4-6"
    });
  });
});
