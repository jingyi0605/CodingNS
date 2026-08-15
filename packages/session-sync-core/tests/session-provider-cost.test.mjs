import { mkdirSync, mkdtempSync, rmSync, writeFileSync } from "node:fs";
import { tmpdir } from "node:os";
import { join } from "node:path";
import { describe, expect, it } from "vitest";

import {
  ClaudeCodeAdapter,
  CodexAdapter,
  DeepSeekHarnessAdapter,
  GeminiAdapter,
  LegnaCodeAdapter,
  DEFAULT_PROVIDER_PRICE_BOOK_VERSION
} from "../dist/index.js";

const billing = {
  billing: {
    billingStartedAt: "2026-08-16T00:00:00.000Z",
    pricingProfileId: "direct-api",
    priceBookVersion: DEFAULT_PROVIDER_PRICE_BOOK_VERSION
  }
};

describe("各 Provider 的模型归因和费用", () => {
  it("Claude 使用最终 assistant usage 的 model 计算费用", async () => {
    const root = mkdtempSync(join(tmpdir(), "codingns-claude-cost-"));
    const file = join(root, "session.jsonl");

    try {
      writeFileSync(file, JSON.stringify({
        type: "assistant",
        timestamp: "2026-08-16T00:00:01.000Z",
        message: {
          id: "assistant-1",
          model: "claude-sonnet-4-5",
          usage: {
            input_tokens: 100,
            cache_creation_input_tokens: 10,
            cache_read_input_tokens: 20,
            output_tokens: 30
          }
        }
      }));

      const stats = await new ClaudeCodeAdapter({ homeDir: root }).readSessionStats(
        "session-1",
        file,
        billing
      );

      expect(stats?.metrics.costUsd).toMatchObject({
        semantic: "priced-final-events",
        pricing: { kind: "catalog-estimate" }
      });
      expect(stats?.metrics.costUsd?.value).toBeGreaterThan(0);
    } finally {
      rmSync(root, { recursive: true, force: true });
    }
  });

  it("Legna 复用 Claude 兼容 usage，但按 legna-code 价格条目计费", async () => {
    const root = mkdtempSync(join(tmpdir(), "codingns-legna-cost-"));
    const file = join(root, "session.jsonl");

    try {
      writeFileSync(file, JSON.stringify({
        type: "assistant",
        timestamp: "2026-08-16T00:00:01.000Z",
        message: {
          id: "legna-assistant-1",
          model: "claude-sonnet-4-5",
          usage: {
            input_tokens: 100,
            cache_read_input_tokens: 20,
            output_tokens: 30
          }
        }
      }));

      const stats = await new LegnaCodeAdapter({ homeDir: root }).readSessionStats(
        "session-1",
        file,
        billing
      );

      expect(stats?.provider).toBe("legna-code");
      expect(stats?.metrics.costUsd).toMatchObject({
        semantic: "priced-final-events",
        pricing: { kind: "catalog-estimate", pricingProfileId: "direct-api" }
      });
    } finally {
      rmSync(root, { recursive: true, force: true });
    }
  });

  it("Codex 只有基线、turn model 和终态齐全时才按累计快照差值计费", async () => {
    const root = mkdtempSync(join(tmpdir(), "codingns-codex-cost-"));
    const file = join(root, "session.jsonl");
    const record = (timestamp, type, payload) => JSON.stringify({ timestamp, type, payload });

    try {
      writeFileSync(file, [
        record("2026-08-15T23:59:00.000Z", "event_msg", {
          type: "token_count",
          info: { total_token_usage: { input_tokens: 100, cached_input_tokens: 20, output_tokens: 10 } }
        }),
        JSON.stringify({
          timestamp: "2026-08-16T00:00:00.500Z",
          type: "turn_context",
          payload: { turn_id: "turn-1", model: "gpt-5.3-codex" }
        }),
        record("2026-08-16T00:00:01.000Z", "event_msg", {
          type: "token_count",
          info: {
            total_token_usage: {
              input_tokens: 200,
              cached_input_tokens: 70,
              output_tokens: 40
            }
          }
        }),
        record("2026-08-16T00:00:02.000Z", "event_msg", {
          type: "task_complete",
          turn_id: "turn-1"
        })
      ].join("\n"));

      const stats = await new CodexAdapter({ homeDir: root }).readSessionStats(
        "session-1",
        file,
        billing
      );

      expect(stats?.metrics.costUsd).toMatchObject({
        semantic: "priced-final-events",
        pricing: { kind: "catalog-estimate" }
      });
    } finally {
      rmSync(root, { recursive: true, force: true });
    }
  });

  it("Codex 的并发 turn 无法可靠拆分累计快照时隐藏费用", async () => {
    const root = mkdtempSync(join(tmpdir(), "codingns-codex-concurrent-cost-"));
    const file = join(root, "session.jsonl");
    const record = (timestamp, type, payload) => JSON.stringify({ timestamp, type, payload });

    try {
      writeFileSync(file, [
        record("2026-08-15T23:59:00.000Z", "event_msg", {
          type: "token_count",
          info: { total_token_usage: { input_tokens: 100, output_tokens: 10 } }
        }),
        record("2026-08-16T00:00:00.500Z", "event_msg", {
          type: "task_started",
          turn_id: "turn-1"
        }),
        JSON.stringify({
          timestamp: "2026-08-16T00:00:00.600Z",
          type: "turn_context",
          payload: { turn_id: "turn-1", model: "gpt-5.3-codex" }
        }),
        record("2026-08-16T00:00:01.000Z", "event_msg", {
          type: "token_count",
          info: {
            total_token_usage: { input_tokens: 200, output_tokens: 30 },
            turn_id: "turn-1"
          }
        }),
        record("2026-08-16T00:00:01.100Z", "event_msg", {
          type: "task_started",
          turn_id: "turn-2"
        }),
        JSON.stringify({
          timestamp: "2026-08-16T00:00:01.200Z",
          type: "turn_context",
          payload: { turn_id: "turn-2", model: "gpt-5.3-codex" }
        }),
        record("2026-08-16T00:00:02.000Z", "event_msg", {
          type: "token_count",
          info: {
            total_token_usage: { input_tokens: 300, output_tokens: 50 },
            turn_id: "turn-2"
          }
        }),
        record("2026-08-16T00:00:03.000Z", "event_msg", {
          type: "task_complete",
          turn_id: "turn-1"
        }),
        record("2026-08-16T00:00:04.000Z", "event_msg", {
          type: "task_complete",
          turn_id: "turn-2"
        })
      ].join("\n"));

      const stats = await new CodexAdapter({ homeDir: root }).readSessionStats(
        "session-1",
        file,
        billing
      );

      expect(stats?.metrics.costUsd).toBeUndefined();
    } finally {
      rmSync(root, { recursive: true, force: true });
    }
  });

  it("Gemini 重写消息时保留最终 model 和 tokens", async () => {
    const root = mkdtempSync(join(tmpdir(), "codingns-gemini-cost-"));
    const chatDir = join(root, "tmp", "hash", "chats");
    const file = join(chatDir, "session-1.json");

    try {
      mkdirSync(chatDir, { recursive: true });
      writeFileSync(file, JSON.stringify({
        sessionId: "session-1",
        workspacePath: "/workspace/demo",
        messages: [{
          id: "assistant-1",
          model: "gemini-2.5-flash",
          timestamp: "2026-08-16T00:00:01.000Z",
          tokens: { input: 100, output: 20, cached: 10, thoughts: 2, total: 122 }
        }]
      }));

      const stats = await new GeminiAdapter({ homeDir: root, listSessions: async () => [] }).readSessionStats(
        "session-1",
        "gemini://session/session-1",
        billing
      );

      expect(stats?.metrics.costUsd).toMatchObject({
        semantic: "priced-final-events",
        pricing: { kind: "catalog-estimate" }
      });
    } finally {
      rmSync(root, { recursive: true, force: true });
    }
  });

  it("Harness 在同一次 history 响应中折叠原始 model、usage 和 turn/end", async () => {
    const events = [
      { event: { type: "request/header", seq: 1, time: "2026-08-16T00:00:00.100Z", data: { turn: 1, step: 1, model: "deepseek-v4-flash" } } },
      { event: { type: "assistant/message", seq: 2, time: "2026-08-16T00:00:01.000Z", data: { turn: 1, step: 1, message: { model: "deepseek-v4-flash", usage: { inputTokens: 100, outputTokens: 20 } } } } },
      { event: { type: "turn/end", seq: 3, time: "2026-08-16T00:00:02.000Z", data: { turn: 1, reason: { kind: "completed" } } } }
    ];
    const adapter = new DeepSeekHarnessAdapter({
      transport: {
        call: async () => ({
          events,
          projections: {
            asOfSeq: 3,
            values: {
              sessionStats: { turns: 1, steps: 1 },
              tokenUsage: { uncachedInputTokens: 100, outputTokens: 20 }
            }
          }
        }),
        subscribe: () => ({ close() {} })
      }
    });

    const stats = await adapter.readSessionStats("harness-1", "harness://harness-1", billing);

    expect(stats?.metrics.costUsd).toMatchObject({
      semantic: "priced-final-events",
      pricing: { kind: "catalog-estimate" }
    });
  });

  it("Harness 读取真实 message.source.model，并要求 usage 具备可识别终态", async () => {
    const events = [
      {
        event: {
          type: "request/header",
          seq: 1,
          time: "2026-08-16T00:00:00.100Z",
          data: {
            header: {
              config: {
                provider: "deepseek-official",
                model: "deepseek-v4-flash"
              }
            }
          }
        }
      },
      {
        event: {
          type: "turn/start",
          seq: 2,
          time: "2026-08-16T00:00:00.200Z",
          data: { turn: 1 }
        }
      },
      {
        event: {
          type: "assistant/message",
          seq: 3,
          time: "2026-08-16T00:00:01.000Z",
          data: {
            turn: 1,
            step: 1,
            message: {
              source: {
                kind: "model",
                provider: "deepseek-official",
                model: "deepseek-v4-flash"
              }
            },
            usage: { inputTokens: 100, outputTokens: 20 }
          }
        }
      },
      {
        event: {
          type: "turn/end",
          seq: 4,
          time: "2026-08-16T00:00:02.000Z",
          data: { turn: 1, reason: { kind: "aborted" } }
        }
      },
      {
        event: {
          type: "turn/start",
          seq: 5,
          time: "2026-08-16T00:00:03.000Z",
          data: { turn: 2 }
        }
      },
      {
        event: {
          type: "assistant/message",
          seq: 6,
          time: "2026-08-16T00:00:04.000Z",
          data: {
            turn: 2,
            step: 1,
            message: {
              source: {
                kind: "model",
                provider: "deepseek-official",
                model: "deepseek-v4-flash"
              }
            },
            usage: { inputTokens: 100, outputTokens: 20 }
          }
        }
      },
      {
        event: {
          type: "turn/end",
          seq: 7,
          time: "2026-08-16T00:00:05.000Z",
          data: { turn: 2, reason: { kind: "completed" } }
        }
      }
    ];
    const adapter = new DeepSeekHarnessAdapter({
      transport: {
        call: async () => ({
          events,
          projections: {
            asOfSeq: 7,
            values: {
              sessionStats: { turns: 2, steps: 2 },
              tokenUsage: { uncachedInputTokens: 200, outputTokens: 40 }
            }
          }
        }),
        subscribe: () => ({ close() {} })
      }
    });

    const stats = await adapter.readSessionStats("harness-1", "harness://harness-1", billing);

    expect(stats?.metrics.costUsd?.value).toBeCloseTo(0.000098, 10);
  });
});
