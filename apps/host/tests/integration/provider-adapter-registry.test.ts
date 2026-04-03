import { describe, expect, it, vi } from "vitest";

import type { SessionHistoryService } from "../../src/modules/sessions/session-history-service.js";
import type { SessionLiveRuntimeService } from "../../src/modules/sessions/session-live-runtime-service.js";
import { RuntimePatrolProviderAdapter } from "../../src/modules/butler/provider-adapter-registry.js";

describe("RuntimePatrolProviderAdapter", () => {
  it("readPatrolResult 在 JSON 契约不稳定时仍能给出结构化结果", async () => {
    const adapter = new RuntimePatrolProviderAdapter(
      "codex",
      {
        startLiveSession: vi.fn(async () => {
          throw new Error("unused");
        }),
        subscribeRuntime: vi.fn(() => ({
          close: vi.fn()
        })),
        getSessionRuntime: vi.fn(async () => ({
          runningState: "completed"
        }))
      } as unknown as SessionLiveRuntimeService,
      {
        readRecentHistoryEnvelope: vi.fn(async () => ({
          messages: [
            {
              role: "assistant",
              kind: "text",
              content: [
                "巡视结论：当前分支存在高风险阻塞，测试未通过。",
                "建议：先修复失败测试，再补充回归用例。",
                "```json",
                "{",
                "  \"summary\": \"巡视发现阻塞\",",
                "  \"riskLevel\": \"HIGH\",",
                "  \"suggestions\": [\"修复测试\",],",
                "  \"progressState\": \"blocked\",",
                "  \"riskFlags\": [\"单测失败\"]",
                "}",
                "```"
              ].join("\n")
            }
          ]
        }))
      } as unknown as SessionHistoryService
    );

    const result = await adapter.readPatrolResult("session-1");

    expect(result.structured.summary).toBe("巡视发现阻塞");
    expect(result.structured.riskLevel).toBe("high");
    expect(result.structured.progressState).toBe("blocked");
    expect(result.structured.suggestions).toContain("修复测试");
    expect(result.structured.riskFlags).toContain("单测失败");
  });

  it("readPatrolResult 支持类 JSON（中文字段、单引号、未加引号 key）并去重建议", async () => {
    const adapter = new RuntimePatrolProviderAdapter(
      "codex",
      {
        startLiveSession: vi.fn(async () => {
          throw new Error("unused");
        }),
        subscribeRuntime: vi.fn(() => ({
          close: vi.fn()
        })),
        getSessionRuntime: vi.fn(async () => ({
          runningState: "completed"
        }))
      } as unknown as SessionLiveRuntimeService,
      {
        readRecentHistoryEnvelope: vi.fn(async () => ({
          messages: [
            {
              role: "assistant",
              kind: "text",
              content: [
                "```json",
                "{",
                "  总结: '本轮巡检已完成，主流程正常',",
                "  风险等级: '低',",
                "  建议: ['补充发布说明', '补充发布说明',],",
                "  下一步: ['合并 PR',],",
                "  progress: 'done',",
                "  风险项: []",
                "}",
                "```"
              ].join("\n")
            }
          ]
        }))
      } as unknown as SessionHistoryService
    );

    const result = await adapter.readPatrolResult("session-json-like");

    expect(result.structured.summary).toBe("本轮巡检已完成，主流程正常");
    expect(result.structured.riskLevel).toBe("low");
    expect(result.structured.progressState).toBe("done");
    expect(result.structured.suggestions).toEqual(["补充发布说明", "合并 PR"]);
    expect(result.structured.nextActions).toEqual(["合并 PR", "补充发布说明"]);
  });

  it("readPatrolResult 在无 JSON 输出时会从文本降级提取风险与建议", async () => {
    const adapter = new RuntimePatrolProviderAdapter(
      "codex",
      {
        startLiveSession: vi.fn(async () => {
          throw new Error("unused");
        }),
        subscribeRuntime: vi.fn(() => ({
          close: vi.fn()
        })),
        getSessionRuntime: vi.fn(async () => ({
          runningState: "completed"
        }))
      } as unknown as SessionLiveRuntimeService,
      {
        readRecentHistoryEnvelope: vi.fn(async () => ({
          messages: [
            {
              role: "assistant",
              kind: "text",
              content: [
                "巡检结论：当前主线被阻塞，CI failed。",
                "- 风险：集成测试失败导致无法发布",
                "- 建议：先修复 flaky 用例",
                "- 下一步：补一条回归测试",
                "- 建议：先修复 flaky 用例"
              ].join("\n")
            }
          ]
        }))
      } as unknown as SessionHistoryService
    );

    const result = await adapter.readPatrolResult("session-fallback");

    expect(result.structured.summary).toBe("巡检结论：当前主线被阻塞，CI failed。");
    expect(result.structured.riskLevel).toBe("high");
    expect(result.structured.progressState).toBe("blocked");
    expect(result.structured.riskFlags).toContain("集成测试失败导致无法发布");
    expect(result.structured.suggestions).toEqual(["先修复 flaky 用例", "补一条回归测试"]);
    expect(result.structured.nextActions).toEqual(["先修复 flaky 用例", "补一条回归测试"]);
  });

  it("waitForSessionTerminal 在 runtime 事件缺失时会通过轮询结束等待", async () => {
    const close = vi.fn();
    const getSessionRuntime = vi
      .fn()
      .mockResolvedValueOnce({ runningState: "running" })
      .mockResolvedValueOnce({ runningState: "completed" });
    const adapter = new RuntimePatrolProviderAdapter(
      "codex",
      {
        startLiveSession: vi.fn(async () => ({
          sessionId: "session-2",
          provider: "codex",
          providerSessionId: "provider-session-2",
          acceptedAt: "2026-04-02T00:00:00.000Z"
        })),
        subscribeRuntime: vi.fn(() => ({
          close
        })),
        getSessionRuntime
      } as unknown as SessionLiveRuntimeService,
      {
        readRecentHistoryEnvelope: vi.fn(async () => ({
          messages: []
        }))
      } as unknown as SessionHistoryService,
      {
        waitPollIntervalMs: 5,
        waitTimeoutMs: 1_000
      }
    );

    await adapter.startPatrolSession({
      workspaceId: "workspace-1",
      userId: "user-1",
      providerId: "codex",
      prompt: "巡视",
      model: null,
      reasoningLevel: null,
      permissionMode: null
    });
    await adapter.waitForSessionTerminal("session-2");

    expect(getSessionRuntime).toHaveBeenCalled();
    expect(close).toHaveBeenCalledTimes(1);
  });
});
