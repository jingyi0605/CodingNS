import { mkdirSync, mkdtempSync, rmSync, writeFileSync } from "node:fs";
import { tmpdir } from "node:os";
import { join } from "node:path";
import { describe, expect, it } from "vitest";
import { DeepSeekHarnessAdapter, deleteDeepSeekHarnessSessionFiles, mapHarnessEntries, mapHarnessEntry } from "../dist/index.js";

function transport() {
  const calls = [];
  const archivedSessionIds = new Set();
  return {
    calls,
    call: async (method, payload) => {
      calls.push({ method, payload });
      if (method === "workspace.create") return { workspace: { workspaceId: "w1" }, created: true };
      if (method === "session.create") return { sessionId: "h1" };
      if (method === "session.list") return { items: [{ sessionId: "h1", cwd: "C:/work", title: "测试", messageCount: 2 }] };
      if (method === "workspace.list") return { items: [], archivedSessionIds: [...archivedSessionIds] };
      if (method === "workspace.archiveSession") {
        archivedSessionIds.add(payload.sessionId);
        return { archivedSessionIds: [...archivedSessionIds] };
      }
      if (method === "session.history") return { events: [
        { event: { type: "user/message", seq: 1, time: Date.now(), data: { text: "你好" } } },
        { event: { type: "assistant/message", seq: 2, time: Date.now(), data: { text: "你好，我在。" } } },
        { event: { type: "tool/call", seq: 3, data: { callId: "c1", name: "read", input: { path: "a.txt" } } } },
        { event: { type: "tool/result", seq: 4, data: { callId: "c1", name: "read", output: "ok" } } }
      ] };
      if (method === "session.fork") return { sessionId: "h2" };
      if (method === "session.models" || method === "llm.models") return modelDirectory();
      return { accepted: true };
    },
    subscribe: () => ({ close() {} })
  };
}

function modelDirectory() {
  return {
    groups: [
      {
        id: "deepseek-official",
        name: "DeepSeek",
        models: [
          {
            id: "deepseek-v4-flash",
            name: "DeepSeek-V4-Flash",
            reasoning: {
              efforts: [{ id: "off" }, { id: "high" }, { id: "max" }],
              defaultEffort: "high"
            }
          },
          {
            id: "deepseek-v4-pro",
            name: "DeepSeek-V4-Pro",
            reasoning: {
              efforts: [{ id: "off" }, { id: "high" }, { id: "max" }],
              defaultEffort: "high"
            }
          }
        ]
      }
    ],
    failures: []
  };
}

describe("DeepSeekHarnessAdapter", () => {
  it("只发现当前 workspace，并暴露受限能力矩阵", async () => {
    const t = transport();
    const adapter = new DeepSeekHarnessAdapter({ transport: t, harnessVersion: "0.1.0-rc.5" });
    await expect(adapter.detectSessions("C:/work")).resolves.toHaveLength(1);
    const capabilities = adapter.getProviderCapabilities();
    expect(capabilities.provider).toBe("deepseek-harness");
    expect(capabilities.canResumeSession).toBe(false);
    expect(capabilities.supportsSessionDelete).toBe(true);
    expect(capabilities.supportsSessionDiff).toBe(false);
    await expect(adapter.readSessionTitle("h1")).resolves.toBe("测试");
  });

  it("创建会话前先登记 DSH workspace，并用 workspaceId 归属会话", async () => {
    const t = transport();
    const adapter = new DeepSeekHarnessAdapter({ transport: t, harnessVersion: "0.1.0-rc.5" });

    await expect(adapter.startSession("C:/work", {})).resolves.toMatchObject({
      session: { providerSessionId: "h1", workspacePath: "C:/work" }
    });
    expect(t.calls.slice(-2)).toEqual([
      { method: "workspace.create", payload: { path: "C:/work" } },
      { method: "session.create", payload: { workspaceId: "w1" } }
    ]);
  });

  it("会话级 fork 使用原生 session.fork，不能误传 atSeq", async () => {
    const t = transport();
    const adapter = new DeepSeekHarnessAdapter({ transport: t, harnessVersion: "0.1.0-rc.5" });

    await expect(adapter.forkSession("h1", "C:/work", {
      rawStoreRef: "harness://v/h1",
      sourceType: "session"
    })).resolves.toMatchObject({
      session: { providerSessionId: "h2", parentProviderSessionId: "h1" },
      forkMethod: "native_session_fork"
    });
    expect(t.calls.at(-1)).toEqual({
      method: "session.fork",
      payload: { sessionId: "h1" }
    });
  });

  it("消息级 fork 会从历史消息 ID 反查 Harness sequence", async () => {
    const t = transport();
    const adapter = new DeepSeekHarnessAdapter({ transport: t, harnessVersion: "0.1.0-rc.5" });
    const history = await adapter.readSessionHistory("h1", "harness://v/h1", null, 50);
    const sourceMessageId = history.messages.find((message) => message.content === "你好，我在。")?.messageId;

    await expect(adapter.forkSession("h1", "C:/work", {
      rawStoreRef: "harness://v/h1",
      sourceType: "message",
      sourceMessageId
    })).resolves.toMatchObject({
      session: { providerSessionId: "h2" },
      forkMethod: "native_session_fork",
      forkSourceType: "message"
    });
    expect(t.calls.at(-1)).toEqual({
      method: "session.fork",
      payload: { sessionId: "h1", atSeq: 2 }
    });
  });

  it("Fork 元数据按继承的标准消息数计算，不把 Harness seq 当成消息数", async () => {
    const calls = [];
    const events = [
      { event: { type: "user/message", seq: 10, time: Date.now(), data: { text: "问题" } } },
      { event: { type: "assistant/message", seq: 11, time: Date.now(), data: { text: "回答" } } },
      { event: { type: "turn/end", seq: 12, time: Date.now(), data: { reason: { kind: "completed" } } } }
    ];
    const t = {
      calls,
      call: async (method, payload) => {
        calls.push({ method, payload });
        if (method === "session.history") return { events, hasMore: false };
        if (method === "session.fork") return { sessionId: "h2" };
        return { accepted: true };
      },
      subscribe: () => ({ close() {} })
    };
    const adapter = new DeepSeekHarnessAdapter({ transport: t, harnessVersion: "0.1.0-rc.5" });
    const history = await adapter.readSessionHistory("h1", "harness://v/h1", null, 50);
    const sourceMessageId = history.messages.find((message) => message.content === "回答")?.messageId;

    await expect(adapter.forkSession("h1", "C:/work", {
      rawStoreRef: "harness://v/h1",
      sourceType: "message",
      sourceMessageId
    })).resolves.toMatchObject({
      session: { providerSessionId: "h2", messageCount: 2 },
      inheritedPrefixMessageCount: 2
    });
    expect(calls.at(-1)).toEqual({
      method: "session.fork",
      payload: { sessionId: "h1", atSeq: 11 }
    });
  });

  it("消息级 fork 找不到 CodingNS 消息时返回明确错误", async () => {
    const adapter = new DeepSeekHarnessAdapter({ transport: transport(), harnessVersion: "0.1.0-rc.5" });

    await expect(adapter.forkSession("h1", "C:/work", {
      rawStoreRef: "harness://v/h1",
      sourceType: "message",
      sourceMessageId: "missing-message"
    })).rejects.toThrow("FORK_SOURCE_MESSAGE_NOT_FOUND");
  });

  it("删除会话时归档 sidecar 会话并清理 zstd JSONL 目录", async () => {
    const t = transport();
    const dshHomeDir = mkdtempSync(join(tmpdir(), "codingns-dsh-delete-"));
    const sessionDir = join(dshHomeDir, "sessions", "--C-work--", "h1");
    mkdirSync(sessionDir, { recursive: true });
    writeFileSync(join(sessionDir, "session.jsonl.zstd"), "fixture");
    writeFileSync(join(sessionDir, "metadata.json"), "{}");
    const adapter = new DeepSeekHarnessAdapter({
      transport: t,
      harnessVersion: "0.1.0-rc.5",
      dshHomeDir
    });

    await expect(adapter.deleteSession("h1", "harness://v/h1")).resolves.toBeUndefined();
    expect(t.calls.slice(-3)).toEqual([
      { method: "session.list", payload: {} },
      { method: "session.cancel", payload: { sessionId: "h1" } },
      { method: "workspace.archiveSession", payload: { sessionId: "h1" } }
    ]);
    expect(() => deleteDeepSeekHarnessSessionFiles("h1", { dshHomeDir })).toThrow("PROVIDER_SESSION_NOT_FOUND");
    rmSync(dshHomeDir, { recursive: true, force: true });
  });

  it("未传环境映射时读取进程 DSH_HOME，并清理未指定工作区的 JSONL 会话", () => {
    const dshHomeDir = mkdtempSync(join(tmpdir(), "codingns-dsh-env-delete-"));
    const sessionDir = join(dshHomeDir, "sessions", "_no-cwd", "h-env");
    const previousDshHome = process.env.DSH_HOME;

    try {
      process.env.DSH_HOME = dshHomeDir;
      mkdirSync(sessionDir, { recursive: true });
      writeFileSync(join(sessionDir, "session.jsonl"), "fixture");

      expect(deleteDeepSeekHarnessSessionFiles("h-env")).toEqual([
        expect.objectContaining({ sessionDir })
      ]);
      expect(() => deleteDeepSeekHarnessSessionFiles("h-env")).toThrow("PROVIDER_SESSION_NOT_FOUND");
    } finally {
      if (previousDshHome === undefined) delete process.env.DSH_HOME;
      else process.env.DSH_HOME = previousDshHome;
      rmSync(dshHomeDir, { recursive: true, force: true });
    }
  });

  it("读取 DSH 模型目录，并保留 provider、模型和思考强度", async () => {
    const t = transport();
    const adapter = new DeepSeekHarnessAdapter({ transport: t, harnessVersion: "0.1.0-rc.5" });

    await expect(adapter.getSessionCapabilities("h1")).resolves.toMatchObject({
      modelOptions: [
        {
          id: "deepseek-official:deepseek-v4-flash",
          name: "DeepSeek-V4-Flash",
          supportedReasoningEfforts: ["off", "high", "max"],
          defaultReasoningEffort: "high"
        },
        {
          id: "deepseek-official:deepseek-v4-pro",
          name: "DeepSeek-V4-Pro",
          supportedReasoningEfforts: ["off", "high", "max"],
          defaultReasoningEffort: "high"
        }
      ]
    });
    expect(t.calls.at(-1)).toEqual({ method: "session.models", payload: { sessionId: "h1" } });

    const providerCapabilities = await adapter.getSessionCapabilities("");
    expect(providerCapabilities.modelOptions).toContainEqual(
      expect.objectContaining({ id: "deepseek-official:deepseek-v4-flash" })
    );
    expect(t.calls.at(-1)).toEqual({ method: "llm.models", payload: {} });
  });

  it("按 turn/end 的真实原因恢复成功、失败和中断状态", async () => {
    const cases = [
      { kind: "completed", state: "completed", errorCode: null, detail: null },
      { kind: "failed", state: "failed", errorCode: "HARNESS_TURN_FAILED", detail: "模型执行失败" },
      { kind: "interrupted", state: "interrupted", errorCode: null, detail: null }
    ];

    for (const testCase of cases) {
      const adapter = new DeepSeekHarnessAdapter({
        transport: {
          call: async (method) => {
            if (method === "session.list") {
              return {
                items: [{
                  sessionId: "h1",
                  cwd: "C:/work",
                  running: false,
                  updatedAt: "2026-08-15T02:22:31.000Z"
                }]
              };
            }

            if (method === "session.history") {
              return {
                events: [{
                  event: {
                    type: "turn/end",
                    seq: 12,
                    time: "2026-08-15T02:22:33.000Z",
                    data: {
                      turn: 5,
                      reason: {
                        kind: testCase.kind,
                        ...(testCase.detail ? { message: testCase.detail } : {})
                      }
                    }
                  }
                }]
              };
            }

            return { accepted: true };
          },
          subscribe: () => ({ close() {} })
        }
      });

      await expect(adapter.readSessionActivity("h1", "harness://h1")).resolves.toMatchObject({
        runningState: testCase.state,
        confidence: "authoritative",
        observedAt: "2026-08-15T02:22:33.000Z",
        errorCode: testCase.errorCode,
        detail: testCase.detail,
        runId: "5"
      });
    }
  });

  it("使用 Harness sequence cursor 分页，不再把通用 index cursor 传回 DSH", async () => {
    const calls = [];
    const adapter = new DeepSeekHarnessAdapter({
      transport: {
        call: async (method, payload) => {
          calls.push({ method, payload });

          if (method === "session.history") {
            return {
              events: [
                { event: { type: "user/message", seq: 10, time: "2026-08-15T02:20:00.000Z", data: { text: "第一条" } } },
                { event: { type: "assistant/message", seq: 11, time: "2026-08-15T02:20:01.000Z", data: { text: "第二条" } } },
                { event: { type: "turn/end", seq: 12, time: "2026-08-15T02:20:02.000Z", data: { reason: { kind: "completed" } } } }
              ],
              hasMore: true
            };
          }

          return { accepted: true };
        },
        subscribe: () => ({ close() {} })
      }
    });

    const firstPage = await adapter.readSessionHistory("h1", "harness://h1", null, 2, "backward");
    expect(firstPage.messages.map((message) => message.sequence)).toEqual([10, 11]);
    expect(firstPage.nextCursor).not.toBeNull();

    await adapter.readSessionHistory("h1", "harness://h1", firstPage.nextCursor, 2, "backward");
    expect(calls.filter((call) => call.method === "session.history")).toEqual([
      { method: "session.history", payload: { sessionId: "h1", maxMessages: 2 } },
      { method: "session.history", payload: { sessionId: "h1", beforeSeq: 10, maxMessages: 2 } }
    ]);
  });

  it("把消息、工具调用和工具结果转换成标准消息", () => {
    const message = mapHarnessEntry("h1", "harness://v/h1", { event: { type: "tool/result", seq: 4, data: { callId: "c1", name: "read", output: "ok" } } }, 0);
    expect(message).toMatchObject({ role: "tool", kind: "tool_result", sequence: 4, toolCall: { callId: "c1", status: "completed" } });
  });

  it("按真实 DSH 协议忽略 assistant 内嵌工具块，并用独立事件配对调用和结果", () => {
    const assistantMessages = mapHarnessEntries("h1", "harness://v/h1", {
      event: {
        type: "assistant/message",
        seq: 10,
        data: {
          turn: 2,
          step: 3,
          message: {
            content: [{
              type: "tool-call",
              id: "call-write-1",
              name: "write",
              arguments: '{"file_path":"data/小说.md","content":"正文"}'
            }]
          }
        }
      }
    }, 0);
    const call = mapHarnessEntry("h1", "harness://v/h1", {
      event: {
        type: "tool/call",
        seq: 11,
        data: {
          callId: "call-write-1",
          name: "write",
          arguments: '{"file_path":"data/小说.md","content":"正文"}'
        }
      }
    }, 0);
    const result = mapHarnessEntry("h1", "harness://v/h1", {
      event: {
        type: "tool/result",
        seq: 12,
        data: {
          message: {
            source: { kind: "tool", callId: "call-write-1" },
            content: [{
              type: "tool-result",
              toolCallId: "call-write-1",
              content: [{ type: "text", text: "Created file" }],
              isError: false
            }]
          }
        }
      }
    }, 0);

    expect(assistantMessages).toEqual([]);
    expect(call).toMatchObject({
      kind: "tool_call",
      toolCall: {
        callId: "call-write-1",
        name: "write",
        input: '{"file_path":"data/小说.md","content":"正文"}'
      }
    });
    expect(result).toMatchObject({
      kind: "tool_result",
      content: "Created file",
      toolCall: {
        callId: "call-write-1",
        output: "Created file",
        error: null,
        status: "completed"
      }
    });
  });

  it("把 DSH 注入的工作区规则和运行时快照标记为 system 消息", () => {
    const rules = mapHarnessEntry("h1", "harness://v/h1", {
      event: {
        type: "user/message",
        seq: 8,
        data: {
          content: [{ type: "text", text: "<system-reminder>规则</system-reminder>" }],
          source: { kind: "agent-instructions" }
        }
      }
    }, 0);
    const runtimeContext = mapHarnessEntry("h1", "harness://v/h1", {
      event: {
        type: "user/message",
        seq: 9,
        data: {
          content: [{ type: "text", text: "Current runtime context. This snapshot supersedes earlier runtime-context snapshots." }],
          source: {
            kind: "plugin",
            plugin: "@deepseek-ai/dsh-system-prompt",
            form: "snapshot"
          }
        }
      }
    }, 0);

    expect(rules).toMatchObject({ role: "system", kind: "text" });
    expect(runtimeContext).toMatchObject({ role: "system", kind: "text" });
  });

  it("把最终 assistant message 的思考和正文拆成稳定消息", () => {
    const messages = mapHarnessEntries("h1", "harness://v/h1", {
      event: {
        type: "assistant/message",
        seq: 9,
        data: {
          turn: 3,
          step: 2,
          message: {
            content: [
              { type: "reasoning", text: "先分析需求。" },
              { type: "text", text: "这是正式回复。" }
            ]
          }
        }
      }
    }, 0);

    expect(messages).toEqual([
      expect.objectContaining({ role: "assistant", kind: "thinking", content: "先分析需求。", sequence: 9, rawRef: "harness://v/h1/message/turn-3-step-2/part/thinking-0?part=0" }),
      expect.objectContaining({ role: "assistant", kind: "text", content: "这是正式回复。", sequence: 9, rawRef: "harness://v/h1/message/turn-3-step-2/part/text-1?part=1" })
    ]);
    expect(messages[0]?.messageId).not.toBe(messages[1]?.messageId);
  });

  it("直接转发 Harness history 尾页的原生统计 projection", async () => {
    const adapter = new DeepSeekHarnessAdapter({
      transport: {
        call: async (method) => {
          if (method !== "session.history") throw new Error(`unexpected method: ${method}`);
          return {
            events: [],
            projections: {
              asOfSeq: 88,
              values: {
                sessionStats: {
                  turns: 2,
                  steps: 3,
                  llmMs: 1200,
                  toolMs: 0,
                  ttftMs: 180,
                  ttftSteps: 2,
                  decodeMs: 700,
                  decodeTokens: 42
                },
                tokenUsage: {
                  uncachedInputTokens: 1000,
                  outputTokens: 80,
                  cacheReadTokens: 200,
                  cacheWriteTokens: 50
                },
                contextPressure: {
                  pressureTokens: 9500,
                  projectedTokens: 9818,
                  contextWindow: 1_000_000
                }
              }
            }
          };
        },
        subscribe: () => ({ close() {} })
      }
    });

    const stats = await adapter.readSessionStats("h1", "harness://v/h1");
    const contextUsage = await adapter.readContextUsage("h1", "harness://v/h1");

    expect(stats?.metrics.turns).toMatchObject({
      value: 2,
      source: "provider-projection",
      semantic: "cumulative",
      watermark: { kind: "source-sequence", value: "88" }
    });
    expect(stats?.metrics.inputTokens?.value).toBe(1250);
    expect(stats?.metrics.uncachedInputTokens?.value).toBe(1000);
    expect(stats?.metrics.toolMs?.value).toBe(0);
    expect(stats?.metrics.cacheWriteTokens?.value).toBe(50);
    expect(stats?.metrics.cacheHitRate).toMatchObject({
      value: 16,
      source: "derived-provider-metrics",
      semantic: "derived-ratio",
      watermark: { kind: "source-sequence", value: "88" }
    });
    expect(contextUsage).toMatchObject({
      provider: "deepseek-harness",
      promptTokens: 9818,
      contextWindow: 1_000_000,
      usageRatio: 0.009818,
      source: "provider-runtime",
      contextWindowSource: "provider-runtime",
      modelId: null,
      isEstimated: true
    });
    expect(contextUsage).not.toHaveProperty("uncachedInputTokens");
    expect(contextUsage).not.toHaveProperty("cachedInputTokens");
  });

  it.each([
    ["缺少下一请求压力", { contextWindow: 1_000_000 }],
    ["缺少上下文上限", { projectedTokens: 9818 }],
    ["上下文上限为零", { projectedTokens: 9818, contextWindow: 0 }]
  ])("原生 contextPressure %s 时不伪造上下文占用", async (_caseName, contextPressure) => {
    const adapter = new DeepSeekHarnessAdapter({
      transport: {
        call: async (method) => {
          if (method !== "session.history") throw new Error(`unexpected method: ${method}`);
          return { events: [], projections: { values: { contextPressure } } };
        },
        subscribe: () => ({ close() {} })
      }
    });

    await expect(adapter.readContextUsage("h1", "harness://v/h1")).resolves.toBeNull();
  });
});
