import { mkdirSync, mkdtempSync, readFileSync, rmSync, writeFileSync } from "node:fs";
import { tmpdir } from "node:os";
import path from "node:path";

import { afterEach, describe, expect, it } from "vitest";

import { resolveHostConfig } from "../../src/config/env.js";
import type { ModelPresetRuntimeConfigDto } from "../../src/modules/model-switch/cc-switch-adapter.js";
import { SessionProviderConfigService } from "../../src/modules/sessions/session-provider-config-service.js";
import {
  appendSessionProviderErrorContext,
  mapSessionProviderError
} from "../../src/modules/sessions/session-provider-error-mapper.js";

const tempDirs: string[] = [];

describe("SessionProviderConfigService", () => {
  afterEach(() => {
    while (tempDirs.length > 0) {
      const target = tempDirs.pop();

      if (target) {
        rmSync(target, { recursive: true, force: true });
      }
    }
  });

  it("Codex 会话级 preset 会覆盖默认 provider 配置，并把 auth 写入 runtime metadata", () => {
    const rootDir = mkdtempSync(path.join(tmpdir(), "codingns-session-provider-config-"));
    tempDirs.push(rootDir);

    const codexHomeDir = path.join(rootDir, ".codex");
    mkdirSync(codexHomeDir, { recursive: true });
    writeFileSync(
      path.join(codexHomeDir, "config.toml"),
      [
        "model = \"gpt-5.4\"",
        "model_provider = \"gmn\"",
        "",
        "[model_providers.gmn]",
        "name = \"gmn\"",
        "base_url = \"https://gmncode.cn\"",
        "wire_api = \"responses\"",
        "requires_openai_auth = true",
        ""
      ].join("\n"),
      "utf8"
    );
    writeFileSync(path.join(codexHomeDir, "auth.json"), "{\n  \"openai\": true\n}\n", "utf8");

    const config = resolveHostConfig({
      databasePath: path.join(rootDir, "host.sqlite"),
      codexHomeDir
    });
    const preset: ModelPresetRuntimeConfigDto = {
      id: "preset-api",
      name: "神风API",
      app: "codex",
      settingsConfig: {
        auth: {
          OPENAI_API_KEY: "sk-test-deepseek"
        },
        config: [
          "model_provider = \"api\"",
          "model = \"gpt-5-codex\"",
          "",
          "[model_providers.api]",
          "name = \"api\"",
          "base_url = \"https://api.shenfengwl.fun\"",
          "wire_api = \"responses\"",
          "requires_openai_auth = true"
        ].join("\n")
      }
    };
    const ccSwitchAdapter = {
      readPresetRuntimeConfig: () => preset
    };
    const service = new SessionProviderConfigService(
      config,
      ccSwitchAdapter as never
    );

    const binding = service.prepareSessionBinding({
      sessionId: "session-1",
      provider: "codex",
      providerConfigMode: "cc-switch-preset",
      providerPresetId: "preset-api"
    });

    expect(binding.providerConfigMode).toBe("cc-switch-preset");
    expect(binding.providerPresetId).toBe("preset-api");
    expect(binding.runtimeHomeDir).toBeTruthy();

    const runtimeHomeDir = binding.runtimeHomeDir!;
    const generatedConfig = readFileSync(path.join(runtimeHomeDir, "config.toml"), "utf8");
    const runtimeMetadata = JSON.parse(
      readFileSync(path.join(runtimeHomeDir, ".codingns-provider-runtime.json"), "utf8")
    ) as {
      runtimeEnv?: Record<string, string>;
    };

    expect(generatedConfig).toMatch(/^model_provider = "api"$/m);
    expect(generatedConfig).not.toMatch(/^model_provider = "gmn"$/m);
    expect(generatedConfig).toMatch(/^model = "gpt-5-codex"$/m);
    expect(generatedConfig).toContain("[model_providers.gmn]");
    expect(generatedConfig).toContain("[model_providers.api]");
    expect(runtimeMetadata.runtimeEnv).toMatchObject({
      OPENAI_API_KEY: "sk-test-deepseek"
    });

    const summary = service.describeBinding({
      provider: "codex",
      providerConfigMode: "cc-switch-preset",
      providerPresetId: "preset-api",
      runtimeHomeDir
    });
    const error = appendSessionProviderErrorContext(
      mapSessionProviderError(new Error("unexpected status 401 Unauthorized: INVALID_API_KEY")),
      summary
    );

    expect(summary.providerPresetName).toBe("神风API");
    expect(summary.modelProvider).toBe("api");
    expect(summary.model).toBe("gpt-5-codex");
    expect(summary.baseUrl).toBe("https://api.shenfengwl.fun");
    expect(summary.authEnvKeys).toEqual(["OPENAI_API_KEY"]);
    expect(error.message).toContain("会话部署:");
    expect(error.message).toContain("presetName=神风API");
    expect(error.message).toContain("modelProvider=api");
    expect(error.message).toContain("model=gpt-5-codex");
    expect(error.message).toContain("baseUrl=https://api.shenfengwl.fun");
    expect(error.message).toContain("authEnv=OPENAI_API_KEY");
  });

  it("Claude 会话在上一轮结束后切换 preset 时，会把 transcript 同步到新的 runtime home", () => {
    const rootDir = mkdtempSync(path.join(tmpdir(), "codingns-session-provider-config-"));
    tempDirs.push(rootDir);

    const claudeHomeDir = path.join(rootDir, ".claude");
    const workspaceSlug = "tmp-workspace";
    const providerSessionId = "claude-session-1";
    const sourceTranscriptPath = path.join(
      claudeHomeDir,
      "projects",
      workspaceSlug,
      `${providerSessionId}.jsonl`
    );

    mkdirSync(path.dirname(sourceTranscriptPath), { recursive: true });
    writeFileSync(
      path.join(claudeHomeDir, "settings.json"),
      JSON.stringify({
        permissions: {
          allow: ["Read"]
        }
      }, null, 2),
      "utf8"
    );
    writeFileSync(sourceTranscriptPath, "{\"type\":\"assistant\",\"message\":\"done\"}\n", "utf8");

    const config = resolveHostConfig({
      databasePath: path.join(rootDir, "host.sqlite"),
      claudeCodeHomeDir: claudeHomeDir
    });
    const preset: ModelPresetRuntimeConfigDto = {
      id: "preset-claude",
      name: "Claude 新配置",
      app: "claude-code",
      settingsConfig: {
        env: {
          ANTHROPIC_MODEL: "claude-sonnet-4-5"
        }
      }
    };
    const ccSwitchAdapter = {
      readPresetRuntimeConfig: () => preset
    };
    const service = new SessionProviderConfigService(
      config,
      ccSwitchAdapter as never
    );

    const binding = service.resolveSessionBinding({
      sessionId: "session-1",
      provider: "claude-code",
      existingBinding: {
        providerConfigMode: "global-default",
        providerPresetId: null,
        runtimeHomeDir: null,
        providerSessionId,
        rawStoreRef: sourceTranscriptPath
      },
      providerConfigMode: "cc-switch-preset",
      providerPresetId: "preset-claude"
    });

    expect(binding.providerConfigMode).toBe("cc-switch-preset");
    expect(binding.providerPresetId).toBe("preset-claude");
    expect(binding.runtimeHomeDir).toBeTruthy();

    const targetTranscriptPath = path.join(
      binding.runtimeHomeDir!,
      "projects",
      workspaceSlug,
      `${providerSessionId}.jsonl`
    );
    const generatedSettings = JSON.parse(
      readFileSync(path.join(binding.runtimeHomeDir!, "settings.json"), "utf8")
    ) as {
      permissions?: { allow?: string[] };
      env?: Record<string, string>;
    };

    expect(readFileSync(targetTranscriptPath, "utf8")).toBe("{\"type\":\"assistant\",\"message\":\"done\"}\n");
    expect(generatedSettings.permissions?.allow).toEqual(["Read"]);
    expect(generatedSettings.env?.ANTHROPIC_MODEL).toBe("claude-sonnet-4-5");
  });
});
