import { afterEach, describe, expect, it, vi } from "vitest";

import type { ProviderRuntimeEventSink, ProviderRuntimeRunRequest } from "@codingns/session-sync-core";

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
    const created = await client.createSession("C:\\workspace");
    expect(created.sessionId).toBe("harness-1");
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
        model: null,
        reasoningLevel: null,
        permissionMode: "ask",
        providerPrompt: null,
        attachments: []
      }
    };
    fake.setPromptHandler((sessionId) => {
      fake?.emitMux({ type: "session/event", sessionId, event: { type: "assistant/message", seq: 1, data: { text: "模型已完成" } } });
      fake?.emitHost({ type: "host/session-status", sessionId, running: false });
    });

    const launch = await adapter.startSession(request, sink);
    await expect(launch.completed).resolves.toBeUndefined();
    expect(events).toContainEqual(expect.objectContaining({ type: "message", message: expect.objectContaining({ content: "模型已完成" }) }));
    expect(events).toContainEqual(expect.objectContaining({ type: "status", status: "completed" }));
  });
});

describe("Harness RPC envelope", () => {
  it("使用稳定 client-request 格式", () => {
    expect(createClientRequest("session.create", { cwd: "C:/workspace" }, "rpc-1")).toEqual({ type: "client-request", rpcId: "rpc-1", method: "session.create", payload: { cwd: "C:/workspace" } });
  });
});
