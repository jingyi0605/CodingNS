import { mkdtempSync, rmSync, writeFileSync } from "node:fs";
import os from "node:os";
import path from "node:path";

import { describe, expect, it } from "vitest";

import {
  CodexModelOptionsService,
  enrichCodexCapabilities
} from "../../src/modules/provider/codex-model-options.js";

describe("enrichCodexCapabilities", () => {
  it("会从 Codex app-server 读取可见模型，并补出 provider-default 选项", async () => {
    const root = mkdtempSync(path.join(os.tmpdir(), "codingns-codex-models-"));
    const commandPath = path.join(root, "codex-mock.js");

    writeFileSync(
      commandPath,
      `#!/usr/bin/env node
const readline = require("node:readline");
const rl = readline.createInterface({ input: process.stdin });
rl.on("line", (line) => {
  const request = JSON.parse(line);
  if (request.method === "initialize") {
    process.stdout.write(JSON.stringify({
      id: request.id,
      result: {
        userAgent: "mock",
        platformFamily: "unix",
        platformOs: "macos"
      }
    }) + "\\n");
    return;
  }
  if (request.method === "config/read") {
    process.stdout.write(JSON.stringify({
      id: request.id,
      result: {
        model: "gpt-5.4",
        model_reasoning_effort: "high"
      }
    }) + "\\n");
    return;
  }
  if (request.method === "model/list") {
    process.stdout.write(JSON.stringify({
      id: request.id,
      result: {
        data: [
          {
            model: "gpt-5.3-codex",
            displayName: "gpt-5.3-codex",
            hidden: false,
            supportedReasoningEfforts: [
              { reasoningEffort: "low" },
              { reasoningEffort: "medium" },
              { reasoningEffort: "high" },
              { reasoningEffort: "xhigh" }
            ]
          },
          {
            model: "gpt-5.4",
            displayName: "gpt-5.4",
            hidden: false,
            supportedReasoningEfforts: [
              { reasoningEffort: "low" },
              { reasoningEffort: "medium" },
              { reasoningEffort: "high" },
              { reasoningEffort: "xhigh" }
            ]
          },
          {
            model: "gpt-5.2-codex",
            displayName: "gpt-5.2-codex",
            hidden: false,
            supportedReasoningEfforts: [
              { reasoningEffort: "low" },
              { reasoningEffort: "medium" },
              { reasoningEffort: "high" },
              { reasoningEffort: "xhigh" }
            ]
          },
          {
            model: "gpt-5.1-codex-max",
            displayName: "gpt-5.1-codex-max",
            hidden: false,
            supportedReasoningEfforts: [
              { reasoningEffort: "low" },
              { reasoningEffort: "medium" },
              { reasoningEffort: "high" },
              { reasoningEffort: "xhigh" }
            ]
          },
          {
            model: "gpt-5.2",
            displayName: "gpt-5.2",
            hidden: false,
            supportedReasoningEfforts: [
              { reasoningEffort: "low" },
              { reasoningEffort: "medium" },
              { reasoningEffort: "high" },
              { reasoningEffort: "xhigh" }
            ]
          },
          {
            model: "gpt-5.1-codex-mini",
            displayName: "gpt-5.1-codex-mini",
            hidden: false,
            supportedReasoningEfforts: [
              { reasoningEffort: "medium" },
              { reasoningEffort: "high" }
            ]
          },
          {
            model: "gpt-5.1",
            displayName: "gpt-5.1",
            hidden: true,
            supportedReasoningEfforts: [
              { reasoningEffort: "low" },
              { reasoningEffort: "medium" },
              { reasoningEffort: "high" }
            ]
          },
          {
            model: "gpt-6",
            displayName: "gpt-6",
            hidden: false,
            supportedReasoningEfforts: [
              { reasoningEffort: "low" },
              { reasoningEffort: "medium" }
            ]
          }
        ],
        nextCursor: null
      }
    }) + "\\n");
  }
});
`,
      "utf8"
    );
    try {
      const service = new CodexModelOptionsService({
        commandPath
      });
      const capabilities = await enrichCodexCapabilities(
        {
          provider: "codex",
          canStartSession: true,
          canResumeSession: true,
          canSendMessage: true,
          supportsSubagents: true,
          supportsInterrupt: true,
          supportsStructuredToolCalls: true,
          supportsTokenUsage: true,
          supportsAttachments: true,
          supportsPermissionPrompt: true,
          supportsCheckpoint: false,
          limitations: []
        },
        service
      );

      expect(capabilities.defaultReasoningLevel).toBe("high");
      expect(capabilities.modelOptions).toEqual([
        {
          id: "provider-default",
          name: "跟随 CLI 默认模型",
          usesProviderDefault: true,
          supportedReasoningEfforts: ["low", "medium", "high", "xhigh"]
        },
        {
          id: "gpt-5.3-codex",
          name: "gpt-5.3-codex",
          supportedReasoningEfforts: ["low", "medium", "high", "xhigh"]
        },
        {
          id: "gpt-5.4",
          name: "gpt-5.4",
          supportedReasoningEfforts: ["low", "medium", "high", "xhigh"]
        },
        {
          id: "gpt-5.2-codex",
          name: "gpt-5.2-codex",
          supportedReasoningEfforts: ["low", "medium", "high", "xhigh"]
        },
        {
          id: "gpt-5.1-codex-max",
          name: "gpt-5.1-codex-max",
          supportedReasoningEfforts: ["low", "medium", "high", "xhigh"]
        },
        {
          id: "gpt-5.2",
          name: "gpt-5.2",
          supportedReasoningEfforts: ["low", "medium", "high", "xhigh"]
        },
        {
          id: "gpt-5.1-codex-mini",
          name: "gpt-5.1-codex-mini",
          supportedReasoningEfforts: ["medium", "high"]
        }
      ]);
    } finally {
      rmSync(root, { recursive: true, force: true });
    }
  });
});
