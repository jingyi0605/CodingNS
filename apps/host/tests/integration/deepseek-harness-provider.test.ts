import { afterEach, describe, expect, it } from "vitest";

import { DeepSeekHarnessApiClient, DeepSeekHarnessRpcError } from "../../src/modules/sessions/deepseek-harness/deepseek-harness-api-client.js";
import { DeepSeekHarnessSessionBindingStore } from "../../src/modules/sessions/deepseek-harness/deepseek-harness-session-binding-store.js";
import { DeepSeekHarnessEventBridge } from "../../src/modules/sessions/deepseek-harness/deepseek-harness-event-bridge.js";
import { createTaskManager } from "../../src/modules/tasks/task-manager.js";
import { createClientRequest, parseHarnessServerResponse } from "../../src/modules/sessions/deepseek-harness/deepseek-harness-protocol.js";
import { createDeepSeekHarnessFakeServer, type DeepSeekHarnessFakeServer } from "../fixtures/deepseek-harness-fake-server.js";

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
    const watcher = bridge.watch("harness-1", (event) => {
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
});

describe("Harness RPC envelope", () => {
  it("使用稳定 client-request 格式", () => {
    expect(createClientRequest("session.create", { cwd: "C:/workspace" }, "rpc-1")).toEqual({ type: "client-request", rpcId: "rpc-1", method: "session.create", payload: { cwd: "C:/workspace" } });
  });
});
