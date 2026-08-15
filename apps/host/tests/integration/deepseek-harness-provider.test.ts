import { existsSync, mkdirSync, mkdtempSync, rmSync, writeFileSync } from "node:fs";
import { tmpdir } from "node:os";
import { join } from "node:path";
import { afterEach, describe, expect, it, vi } from "vitest";

import { DeepSeekHarnessAdapter, type ProviderRuntimeEventSink, type ProviderRuntimeRunRequest } from "@codingns/session-sync-core";

import { DeepSeekHarnessApiClient, DeepSeekHarnessRpcError } from "../../src/modules/sessions/deepseek-harness/deepseek-harness-api-client.js";
import { DeepSeekHarnessSessionBindingStore } from "../../src/modules/sessions/deepseek-harness/deepseek-harness-session-binding-store.js";
import { DeepSeekHarnessEventBridge } from "../../src/modules/sessions/deepseek-harness/deepseek-harness-event-bridge.js";
import { DeepSeekHarnessRuntimeAdapter } from "../../src/modules/sessions/deepseek-harness/deepseek-harness-runtime-adapter.js";
import { createTaskManager } from "../../src/modules/tasks/task-manager.js";
import { createClientRequest, parseHarnessServerResponse } from "../../src/modules/sessions/deepseek-harness/deepseek-harness-protocol.js";
import { createDeepSeekHarnessFakeServer, type DeepSeekHarnessFakeServer } from "../fixtures/deepseek-harness-fake-server.js";

async function waitForMessageCount(messages: readonly unknown[], minimum: number): Promise<void> {
  const deadline = Date.now() + 2_000;

  while (messages.length < minimum) {
    if (Date.now() >= deadline) {
      throw new Error(`等待流式消息超时，期望至少 ${minimum} 条，实际 ${messages.length} 条`);
    }
    await new Promise((resolve) => setTimeout(resolve, 10));
  }
}

describe("DeepSeek Harness Web API", () => {
  let fake: DeepSeekHarnessFakeServer | null = null;

  afterEach(async () => {
    await fake?.close();
    fake = null;
  });

  it("校验 envelope、rpcId 和业务错误", async () => {
    fake = await createDeepSeekHarnessFakeServer();
    const client = new DeepSeekHarnessApiClient({ baseUrl: fake.baseUrl });
    await expect(client.describe()).resolves.toMatchObject({ version: "0.1.0-rc.5" });
    await expect(client.call("unknown.error", {})).rejects.toMatchObject({ code: "HARNESS_RPC_BUSINESS_ERROR" });
    await expect(client.call("bad-rpc", {})).rejects.toBeInstanceOf(DeepSeekHarnessRpcError);
    expect(() => parseHarnessServerResponse({ type: "server-response", rpcId: "other", result: { ok: true, value: {} } }, "expected")).toThrow("HARNESS_RPC_PROTOCOL_ERROR");
  });

  it("支持创建、历史、取消和下行 mux/host 夹具", async () => {
    fake = await createDeepSeekHarnessFakeServer();
    const client = new DeepSeekHarnessApiClient({ baseUrl: fake.baseUrl });
    const workspace = await client.createWorkspace("C:\\workspace");
    expect(workspace).toMatchObject({ workspace: { workspaceId: "workspace-1", path: "C:\\workspace" }, created: true });
    const created = await client.createSession({ workspaceId: workspace.workspace.workspaceId });
    expect(created.sessionId).toBe("harness-1");
    await expect(client.models(created.sessionId)).resolves.toEqual(
      expect.objectContaining({
        groups: expect.arrayContaining([
          expect.objectContaining({
            id: "deepseek-official",
            models: expect.arrayContaining([expect.objectContaining({ id: "deepseek-v4-flash" })])
          })
        ])
      })
    );
    await expect(client.readHistory(created.sessionId)).resolves.toMatchObject({ events: [] });
    await expect(client.cancel(created.sessionId)).resolves.toEqual({ accepted: true });
    const mux: unknown[] = [];
    const host: unknown[] = [];
    const closeMux = await client.subscribe("/api/events.mux", (event) => mux.push(event));
    const closeHost = await client.subscribe("/api/events.host", (event) => host.push(event));
    fake.emitMux({ type: "session/event", sessionId: created.sessionId, event: { type: "assistant/message", seq: 1, data: { text: "完成" } } });
    fake.emitHost({ type: "host/session-status", sessionId: created.sessionId, running: false });
    await new Promise((resolve) => setTimeout(resolve, 20));
    closeMux();
    closeHost();
    expect(mux).toHaveLength(1);
    expect(host).toHaveLength(1);
  });

  it("删除会话会清理 JSONL 目录，并让 sidecar 不再发现已归档会话", async () => {
    fake = await createDeepSeekHarnessFakeServer();
    const client = new DeepSeekHarnessApiClient({ baseUrl: fake.baseUrl });
    const workspace = await client.createWorkspace("C:\\workspace");
    const created = await client.createSession({ workspaceId: workspace.workspace.workspaceId });
    const dshHomeDir = mkdtempSync(join(tmpdir(), "codingns-dsh-delete-"));
    const sessionDir = join(dshHomeDir, "sessions", "--C-workspace--", created.sessionId);
    mkdirSync(sessionDir, { recursive: true });
    writeFileSync(join(sessionDir, "session.jsonl"), "fixture");
    const adapter = new DeepSeekHarnessAdapter({ transport: client, dshHomeDir, harnessVersion: "0.1.0-rc.5" });

    await expect(adapter.deleteSession(created.sessionId, "harness://0.1.0-rc.5/harness-1")).resolves.toBeUndefined();
    expect(existsSync(sessionDir)).toBe(false);
    expect(fake.archivedSessionIds.has(created.sessionId)).toBe(true);
    await expect(adapter.detectSessions("C:\\workspace")).resolves.toEqual([]);

    rmSync(dshHomeDir, { recursive: true, force: true });
  });

  it("不允许越过用户和 workspace 绑定边界", async () => {
    const store = new DeepSeekHarnessSessionBindingStore({
      resolve: async (workspaceId, userId) => workspaceId === "w1" && userId === "u1" ? { workspacePath: "C:\\work", userId } : null
    });
    await expect(store.create({ codingnsSessionId: "c1", harnessSessionId: "h1", userId: "u1", workspaceId: "w1", workspacePath: "C:\\work\\child", harnessVersion: "0.1.0-rc.5" })).resolves.toMatchObject({ workspacePath: "c:/work" });
    await expect(store.resolveByCodingnsSession("u2", "c1")).rejects.toThrow("HARNESS_WORKSPACE_FORBIDDEN");
    await expect(store.create({ codingnsSessionId: "c2", harnessSessionId: "h1", userId: "u2", workspaceId: "w2", workspacePath: "C:\\other", harnessVersion: "0.1.0-rc.5" })).rejects.toThrow("HARNESS_SESSION_BINDING_CONFLICT");
  });

  it("对重复事件去重，并在断线后先从 history 补齐", async () => {
    fake = await createDeepSeekHarnessFakeServer();
    const client = new DeepSeekHarnessApiClient({ baseUrl: fake.baseUrl });
    const bridge = new DeepSeekHarnessEventBridge({ taskManager: createTaskManager(), client });
    const seen: number[] = [];
    const watcher = await bridge.watch("harness-1", (event) => {
      if (event.type === "message" && event.message) seen.push(event.message.sequence);
    });
    await new Promise((resolve) => setTimeout(resolve, 20));
    fake.emitMux({ type: "session/event", sessionId: "harness-1", event: { type: "assistant/message", seq: 1, data: { text: "一" } } });
    fake.emitMux({ type: "session/event", sessionId: "harness-1", event: { type: "assistant/message", seq: 1, data: { text: "重复" } } });
    await new Promise((resolve) => setTimeout(resolve, 20));
    fake.sessions.set("harness-1", { cwd: "C:/work", events: [{ type: "assistant/message", seq: 2, data: { text: "二" } }] });
    fake.closeMuxClients();
    fake.closeHostClients();
    await new Promise((resolve) => setTimeout(resolve, 150));
    watcher.close();
    await bridge.close();
    expect(seen).toEqual([1, 2]);
  });

  it("event bridge 在已有 mux/history 水位上保留原始模型、usage 和 turn/end", async () => {
    fake = await createDeepSeekHarnessFakeServer();
    const client = new DeepSeekHarnessApiClient({ baseUrl: fake.baseUrl });
    const bridge = new DeepSeekHarnessEventBridge({ taskManager: createTaskManager(), client });
    const raw: Array<{ type: string; sequence: number; data: Record<string, unknown> }> = [];
    const watcher = await bridge.watch("harness-raw", (event) => {
      if (event.type !== "raw") {
        return;
      }

      const record = event.event as { type?: string; data?: Record<string, unknown> };
      raw.push({
        type: record.type ?? "",
        sequence: event.sequence,
        data: record.data ?? {}
      });
    });

    await new Promise((resolve) => setTimeout(resolve, 20));
    fake.emitMux({
      type: "session/event",
      sessionId: "harness-raw",
      event: {
        type: "request/header",
        seq: 1,
        data: { turn: 1, step: 2, model: "deepseek-v4-pro" }
      }
    });
    fake.emitMux({
      type: "session/event",
      sessionId: "harness-raw",
      event: {
        type: "assistant/message",
        seq: 2,
        data: {
          turn: 1,
          step: 2,
          message: {
            model: "deepseek-v4-pro",
            usage: { inputTokens: 100, outputTokens: 20 }
          }
        }
      }
    });
    fake.emitMux({
      type: "session/event",
      sessionId: "harness-raw",
      event: {
        type: "turn/end",
        seq: 3,
        data: { turn: 1, reason: { kind: "completed" } }
      }
    });
    await waitForMessageCount(raw, 3);
    watcher.close();
    await bridge.close();

    expect(raw).toEqual([
      { type: "request/header", sequence: 1, data: { turn: 1, step: 2, model: "deepseek-v4-pro" } },
      {
        type: "assistant/message",
        sequence: 2,
        data: {
          turn: 1,
          step: 2,
          message: {
            model: "deepseek-v4-pro",
            usage: { inputTokens: 100, outputTokens: 20 }
          }
        }
      },
      { type: "turn/end", sequence: 3, data: { turn: 1, reason: { kind: "completed" } } }
    ]);
  });

  it("不会把 question/resolved 当成新的问题请求", async () => {
    fake = await createDeepSeekHarnessFakeServer();
    const client = new DeepSeekHarnessApiClient({ baseUrl: fake.baseUrl });
    const bridge = new DeepSeekHarnessEventBridge({ taskManager: createTaskManager(), client });
    const interactionEvents: Array<{ type: string; payload: unknown }> = [];
    const watcher = await bridge.watch("harness-question-events", (event) => {
      if (event.type === "question") {
        interactionEvents.push({ type: event.type, payload: event.payload });
      }
    });

    await new Promise((resolve) => setTimeout(resolve, 20));
    fake.emitMux({
      type: "question/requested",
      sessionId: "harness-question-events",
      questions: [{ id: "mode", question: "选择模式", options: [{ label: "快速" }] }]
    }, "question-rpc-1");
    fake.emitMux({
      type: "question/resolved",
      sessionId: "harness-question-events",
      questionRpcId: "question-rpc-1",
      outcome: "answered"
    }, "question-resolved-frame");
    await new Promise((resolve) => setTimeout(resolve, 20));
    watcher.close();
    await bridge.close();

    expect(interactionEvents).toHaveLength(1);
    expect(interactionEvents[0]?.payload).toMatchObject({ type: "question/requested" });
  });

  it("忽略没有正文的助手状态事件，避免产生空白对话项", async () => {
    fake = await createDeepSeekHarnessFakeServer();
    const client = new DeepSeekHarnessApiClient({ baseUrl: fake.baseUrl });
    const bridge = new DeepSeekHarnessEventBridge({ taskManager: createTaskManager(), client });
    const seen: Array<{ sequence: number; content: string }> = [];
    const watcher = await bridge.watch("harness-empty-message", (event) => {
      if (event.type === "message" && event.message) {
        seen.push({ sequence: event.message.sequence, content: event.message.content });
      }
    });

    await new Promise((resolve) => setTimeout(resolve, 20));
    fake.emitMux({ type: "session/event", sessionId: "harness-empty-message", event: { type: "assistant/started", seq: 1, data: {} } });
    fake.emitMux({ type: "session/event", sessionId: "harness-empty-message", event: { type: "assistant/message", seq: 2, data: { text: "正常回复" } } });
    await new Promise((resolve) => setTimeout(resolve, 20));
    watcher.close();
    await bridge.close();

    expect(seen).toEqual([{ sequence: 2, content: "正常回复" }]);
  });

  it("按真实 DSH 工具事件只发出一组配对的写入调用和结果", async () => {
    fake = await createDeepSeekHarnessFakeServer();
    const client = new DeepSeekHarnessApiClient({ baseUrl: fake.baseUrl });
    const bridge = new DeepSeekHarnessEventBridge({ taskManager: createTaskManager(), client });
    const seen: Array<{
      kind: string;
      callId: string;
      name: string;
      content: string;
      output: string | null;
      status: string;
    }> = [];
    const watcher = await bridge.watch("harness-tools", (event) => {
      if (event.type !== "message" || event.message.kind === "text") {
        return;
      }

      seen.push({
        kind: event.message.kind,
        callId: event.message.toolCall?.callId ?? "",
        name: event.message.toolCall?.name ?? "",
        content: event.message.content,
        output: event.message.toolCall?.output ?? null,
        status: event.message.toolCall?.status ?? ""
      });
    });

    await new Promise((resolve) => setTimeout(resolve, 20));
    fake.emitMux({
      type: "session/event",
      sessionId: "harness-tools",
      event: {
        type: "assistant/message",
        seq: 1,
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
    });
    fake.emitMux({
      type: "session/event",
      sessionId: "harness-tools",
      event: {
        type: "tool/call",
        seq: 2,
        data: {
          callId: "call-write-1",
          name: "write",
          arguments: '{"file_path":"data/小说.md","content":"正文"}'
        }
      }
    });
    fake.emitMux({
      type: "session/event",
      sessionId: "harness-tools",
      event: {
        type: "tool/result",
        seq: 3,
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
    });
    await waitForMessageCount(seen, 2);
    watcher.close();
    await bridge.close();

    expect(seen).toEqual([
      {
        kind: "tool_call",
        callId: "call-write-1",
        name: "write",
        content: '{"file_path":"data/小说.md","content":"正文"}',
        output: null,
        status: "running"
      },
      {
        kind: "tool_result",
        callId: "call-write-1",
        name: "",
        content: "Created file",
        output: "Created file",
        status: "completed"
      }
    ]);
  });

  it("流式累积思考和正文，并用最终消息覆盖同一消息身份", async () => {
    fake = await createDeepSeekHarnessFakeServer();
    const client = new DeepSeekHarnessApiClient({ baseUrl: fake.baseUrl });
    const bridge = new DeepSeekHarnessEventBridge({ taskManager: createTaskManager(), client });
    const seen: Array<{ messageId: string; kind: string; content: string; rawRef: string }> = [];
    const watcher = await bridge.watch("harness-stream", (event) => {
      if (event.type === "message") {
        seen.push({
          messageId: event.message.messageId,
          kind: event.message.kind,
          content: event.message.content,
          rawRef: event.message.rawRef
        });
      }
    });

    await new Promise((resolve) => setTimeout(resolve, 20));
    fake.emitMux({ type: "session/event", sessionId: "harness-stream", event: { type: "assistant/chunk", seq: 1, data: { turn: 7, step: 2, chunk: { type: "block-start", index: 0, blockType: "reasoning" } } } });
    fake.emitMux({ type: "session/event", sessionId: "harness-stream", event: { type: "assistant/chunk", seq: 2, data: { turn: 7, step: 2, chunk: { type: "reasoning-delta", index: 0, text: "先" } } } });
    await waitForMessageCount(seen, 1);
    fake.emitMux({ type: "session/event", sessionId: "harness-stream", event: { type: "assistant/chunk", seq: 3, data: { turn: 7, step: 2, chunk: { type: "reasoning-delta", index: 0, text: "分析" } } } });
    await waitForMessageCount(seen, 2);
    fake.emitMux({ type: "session/event", sessionId: "harness-stream", event: { type: "assistant/chunk", seq: 4, data: { turn: 7, step: 2, chunk: { type: "block-start", index: 1, blockType: "text" } } } });
    fake.emitMux({ type: "session/event", sessionId: "harness-stream", event: { type: "assistant/chunk", seq: 5, data: { turn: 7, step: 2, chunk: { type: "text-delta", index: 1, text: "答" } } } });
    await waitForMessageCount(seen, 3);
    fake.emitMux({ type: "session/event", sessionId: "harness-stream", event: { type: "assistant/chunk", seq: 6, data: { turn: 7, step: 2, chunk: { type: "text-delta", index: 1, text: "复" } } } });
    await waitForMessageCount(seen, 4);
    fake.emitMux({ type: "session/event", sessionId: "harness-stream", event: { type: "assistant/message", seq: 7, data: { turn: 7, step: 2, message: { content: [{ type: "reasoning", text: "先分析" }, { type: "text", text: "答复" }] } } } });
    await waitForMessageCount(seen, 6);
    watcher.close();
    await bridge.close();

    const thinking = seen.filter((message) => message.kind === "thinking");
    const text = seen.filter((message) => message.kind === "text");
    expect(thinking.map((message) => message.content)).toEqual(["先", "先分析", "先分析"]);
    expect(text.map((message) => message.content)).toEqual(["答", "答复", "答复"]);
    expect(new Set(thinking.map((message) => message.messageId)).size).toBe(1);
    expect(new Set(text.map((message) => message.messageId)).size).toBe(1);
    expect(new Set(seen.map((message) => message.messageId)).size).toBe(2);
    expect(thinking[0]?.rawRef).toBe("harness://harness-stream/message/turn-7-step-2/part/thinking-0?part=0");
    expect(text[0]?.rawRef).toBe("harness://harness-stream/message/turn-7-step-2/part/text-1?part=1");
  });

  it("在订阅就绪后再提交 prompt，不丢失快速完成的模型输出", async () => {
    fake = await createDeepSeekHarnessFakeServer();
    const client = new DeepSeekHarnessApiClient({ baseUrl: fake.baseUrl });
    const adapter = new DeepSeekHarnessRuntimeAdapter(async () => client, createTaskManager());
    const events: Array<Parameters<ProviderRuntimeEventSink["emit"]>[0]> = [];
    const sink: ProviderRuntimeEventSink = {
      emit: async (event) => { events.push(event); },
      updateSessionBinding: vi.fn()
    };
    const request: ProviderRuntimeRunRequest = {
      sessionId: "codingns-1",
      workspaceId: "workspace-1",
      workspacePath: "C:\\workspace",
      provider: "deepseek-harness",
      providerSessionId: null,
      rawStoreRef: null,
      options: {
        content: "对话测试",
        clientRequestId: null,
        model: "deepseek-official:deepseek-v4-pro",
        reasoningLevel: "off",
        permissionMode: "ask",
        providerPrompt: null,
        attachments: []
      }
    };
    fake.setPromptHandler((sessionId) => {
      fake?.emitMux({ type: "session/event", sessionId, event: { type: "assistant/message", seq: 1, data: { text: "模型已完成" } } });
      fake?.emitMux({ type: "session/event", sessionId, event: { type: "turn/end", seq: 2, data: { turn: 1, reason: { kind: "completed" } } } });
      fake?.emitHost({ type: "host/session-status", sessionId, running: false });
    });

    const launch = await adapter.startSession(request, sink);
    await expect(launch.completed).resolves.toBeUndefined();
    expect(fake.calls.slice(0, 2)).toEqual([
      { method: "workspace.create", payload: { path: "C:\\workspace" } },
      { method: "session.create", payload: { workspaceId: "workspace-1" } }
    ]);
    expect(fake.calls).toContainEqual({
      method: "session.selectModel",
      payload: {
        sessionId: "harness-1",
        provider: "deepseek-official",
        model: "deepseek-v4-pro",
        reasoningEffort: "off"
      }
    });
    expect(events).toContainEqual(expect.objectContaining({ type: "message", message: expect.objectContaining({ content: "模型已完成" }) }));
    expect(events).toContainEqual(expect.objectContaining({ type: "complete", status: "completed" }));
  });

  it("上一轮已结束时不会沿用旧句柄提交下一轮，避免漏建下行订阅", async () => {
    fake = await createDeepSeekHarnessFakeServer();
    const client = new DeepSeekHarnessApiClient({ baseUrl: fake.baseUrl });
    const adapter = new DeepSeekHarnessRuntimeAdapter(async () => client, createTaskManager());
    const events: Array<Parameters<ProviderRuntimeEventSink["emit"]>[0]> = [];
    const sink: ProviderRuntimeEventSink = {
      emit: async (event) => { events.push(event); },
      updateSessionBinding: vi.fn()
    };
    const request: ProviderRuntimeRunRequest = {
      sessionId: "codingns-two-turns",
      workspaceId: "workspace-1",
      workspacePath: "C:\\workspace",
      provider: "deepseek-harness",
      providerSessionId: null,
      rawStoreRef: null,
      options: {
        content: "第一轮",
        clientRequestId: null,
        model: "deepseek-official:deepseek-v4-pro",
        reasoningLevel: "off",
        permissionMode: "ask",
        providerPrompt: null,
        attachments: []
      }
    };
    let turn = 0;
    fake.setPromptHandler((sessionId) => {
      turn += 1;
      const sequence = (turn - 1) * 2 + 1;
      fake?.emitMux({ type: "session/event", sessionId, event: { type: "assistant/message", seq: sequence, data: { turn, text: `第 ${turn} 轮回复` } } });
      fake?.emitMux({ type: "session/event", sessionId, event: { type: "turn/end", seq: sequence + 1, data: { turn, reason: { kind: "completed" } } } });
      fake?.emitHost({ type: "host/session-status", sessionId, running: false });
    });

    const first = await adapter.startSession(request, sink);
    await expect(first.completed).resolves.toBeUndefined();
    await expect(first.submitDuringRun!(request.options)).rejects.toThrow("SESSION_NOT_RUNNING");

    const second = await adapter.continueSession({ ...request, providerSessionId: first.providerSessionId }, sink);
    await expect(second.completed).resolves.toBeUndefined();

    expect(turn).toBe(2);
    expect(events).toContainEqual(expect.objectContaining({ type: "message", message: expect.objectContaining({ content: "第 1 轮回复" }) }));
    expect(events).toContainEqual(expect.objectContaining({ type: "message", message: expect.objectContaining({ content: "第 2 轮回复" }) }));
  });

  it("不会把 Harness 的 running=false 误判为成功", async () => {
    fake = await createDeepSeekHarnessFakeServer();
    const client = new DeepSeekHarnessApiClient({ baseUrl: fake.baseUrl });
    const adapter = new DeepSeekHarnessRuntimeAdapter(async () => client, createTaskManager());
    const events: Array<Parameters<ProviderRuntimeEventSink["emit"]>[0]> = [];
    const sink: ProviderRuntimeEventSink = {
      emit: async (event) => { events.push(event); },
      updateSessionBinding: vi.fn()
    };
    const request: ProviderRuntimeRunRequest = {
      sessionId: "codingns-failed",
      workspaceId: "workspace-1",
      workspacePath: "C:\\workspace",
      provider: "deepseek-harness",
      providerSessionId: null,
      rawStoreRef: null,
      options: {
        content: "触发失败终态",
        clientRequestId: null,
        model: "deepseek-official:deepseek-v4-pro",
        reasoningLevel: "off",
        permissionMode: "ask",
        providerPrompt: null,
        attachments: []
      }
    };
    fake.setPromptHandler((sessionId) => {
      fake?.emitMux({
        type: "session/event",
        sessionId,
        event: {
          type: "turn/end",
          seq: 1,
          data: { turn: 1, reason: { kind: "failed", code: "MODEL_FAILED", message: "模型执行失败" } }
        }
      });
      fake?.emitHost({ type: "host/session-status", sessionId, running: false });
    });

    const launch = await adapter.startSession(request, sink);
    await expect(launch.completed).resolves.toBeUndefined();

    expect(events).toContainEqual(expect.objectContaining({
      type: "error",
      status: "failed",
      errorCode: "MODEL_FAILED",
      detail: "模型执行失败"
    }));
    expect(events).not.toContainEqual(expect.objectContaining({
      type: "status",
      status: "completed"
    }));
  });
});

describe("Harness RPC envelope", () => {
  it("使用稳定 client-request 格式", () => {
    expect(createClientRequest("session.create", { cwd: "C:/workspace" }, "rpc-1")).toEqual({ type: "client-request", rpcId: "rpc-1", method: "session.create", payload: { cwd: "C:/workspace" } });
  });
});
