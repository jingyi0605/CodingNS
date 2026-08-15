import { createServer, type IncomingMessage, type Server, type ServerResponse } from "node:http";
import { randomUUID } from "node:crypto";
import { WebSocketServer, type WebSocket } from "ws";

import type { HarnessClientRequest, HarnessServerResponse, HarnessMuxFrame, HarnessHostFrame } from "../../src/modules/sessions/deepseek-harness/deepseek-harness-protocol.js";

export interface DeepSeekHarnessFakeServer {
  baseUrl: string;
  calls: Array<{ method: string; payload: unknown }>;
  workspaces: Map<string, { workspaceId: string; path: string }>;
  sessions: Map<string, { cwd: string; workspaceId?: string; events: Array<Record<string, unknown>> }>;
  archivedSessionIds: Set<string>;
  setPromptHandler(handler: ((sessionId: string) => void) | null): void;
  emitMux(frame: HarnessMuxFrame, rpcId?: string): void;
  emitHost(frame: HarnessHostFrame, rpcId?: string): void;
  closeMuxClients(): void;
  closeHostClients(): void;
  close(): Promise<void>;
}

/** 不访问真实模型和用户目录的协议夹具，覆盖成功、业务错误、坏 rpcId 和断线。 */
export async function createDeepSeekHarnessFakeServer(options: { port?: number; version?: string } = {}): Promise<DeepSeekHarnessFakeServer> {
  const calls: Array<{ method: string; payload: unknown }> = [];
  const workspaces = new Map<string, { workspaceId: string; path: string }>();
  const sessions = new Map<string, { cwd: string; workspaceId?: string; events: Array<Record<string, unknown>> }>();
  const archivedSessionIds = new Set<string>();
  const muxClients = new Set<WebSocket>();
  const hostClients = new Set<WebSocket>();
  let promptHandler: ((sessionId: string) => void) | null = null;
  const httpServer = createServer((request, response) => {
    void handleRequest(request, response, calls, workspaces, sessions, archivedSessionIds, options.version ?? "0.1.0-rc.5", (sessionId) => promptHandler?.(sessionId));
  });
  const muxServer = new WebSocketServer({ noServer: true });
  const hostServer = new WebSocketServer({ noServer: true });

  muxServer.on("connection", (socket) => { muxClients.add(socket); socket.once("close", () => muxClients.delete(socket)); });
  hostServer.on("connection", (socket) => { hostClients.add(socket); socket.once("close", () => hostClients.delete(socket)); });
  httpServer.on("upgrade", (request, socket, head) => {
    const pathname = new URL(request.url ?? "/", "http://127.0.0.1").pathname;
    if (pathname === "/api/events.mux") {
      muxServer.handleUpgrade(request, socket, head, (client) => muxServer.emit("connection", client, request));
      return;
    }
    if (pathname === "/api/events.host") {
      hostServer.handleUpgrade(request, socket, head, (client) => hostServer.emit("connection", client, request));
      return;
    }
    socket.destroy();
  });

  await new Promise<void>((resolve) => httpServer.listen(options.port ?? 0, "127.0.0.1", () => resolve()));
  const address = httpServer.address();
  const port = typeof address === "object" && address ? address.port : 0;
  const send = (clients: Set<WebSocket>, frame: unknown, rpcId = randomUUID()) => {
    const body = JSON.stringify({ type: "server-request", rpcId, method: "events.push", payload: frame });
    for (const client of clients) if (client.readyState === client.OPEN) client.send(body);
  };

  return {
    baseUrl: `http://127.0.0.1:${port}`,
    calls,
    workspaces,
    sessions,
    archivedSessionIds,
    setPromptHandler: (handler) => { promptHandler = handler; },
    emitMux: (frame, rpcId) => send(muxClients, frame, rpcId),
    emitHost: (frame, rpcId) => send(hostClients, frame, rpcId),
    closeMuxClients: () => { for (const client of muxClients) client.close(); },
    closeHostClients: () => { for (const client of hostClients) client.close(); },
    close: async () => {
      for (const socket of [...muxClients, ...hostClients]) socket.close();
      muxServer.close();
      hostServer.close();
      await new Promise<void>((resolve) => httpServer.close(() => resolve()));
    }
  };
}

async function handleRequest(
  request: IncomingMessage,
  response: ServerResponse,
  calls: Array<{ method: string; payload: unknown }>,
  workspaces: Map<string, { workspaceId: string; path: string }>,
  sessions: Map<string, { cwd: string; workspaceId?: string; events: Array<Record<string, unknown>> }>,
  archivedSessionIds: Set<string>,
  version: string,
  onPrompt: (sessionId: string) => void
): Promise<void> {
  if (request.method !== "POST") { response.writeHead(405).end(); return; }
  const pathname = new URL(request.url ?? "/", "http://127.0.0.1").pathname;
  const body = await readBody(request);
  const parsed = JSON.parse(body) as HarnessClientRequest | { type: "client-response"; rpcId: string };
  if (pathname === "/api/respond") { response.writeHead(200, { "content-type": "application/json" }).end(JSON.stringify({ accepted: true })); return; }
  if (!parsed || parsed.type !== "client-request") { response.writeHead(400).end(); return; }
  const requestBody = parsed;
  calls.push({ method: requestBody.method, payload: requestBody.payload });
  const result = dispatch(requestBody.method, requestBody.payload, workspaces, sessions, archivedSessionIds, version, onPrompt);
  const envelope: HarnessServerResponse = { type: "server-response", rpcId: requestBody.rpcId === "bad-rpc" ? "wrong-rpc" : requestBody.rpcId, result };
  response.writeHead(200, { "content-type": "application/json" }).end(JSON.stringify(envelope));
}

function dispatch(
  method: string,
  payload: unknown,
  workspaces: Map<string, { workspaceId: string; path: string }>,
  sessions: Map<string, { cwd: string; workspaceId?: string; events: Array<Record<string, unknown>> }>,
  archivedSessionIds: Set<string>,
  version: string,
  onPrompt: (sessionId: string) => void
): { ok: true; value: unknown } | { ok: false; error: { code: string; message: string } } {
  const input = (payload && typeof payload === "object" ? payload : {}) as Record<string, unknown>;
  if (method === "host.describe") return { ok: true, value: { version } };
  if (method === "workspace.create") {
    const workspacePath = typeof input.path === "string" ? input.path : ".";
    const existing = workspaces.get(workspacePath);
    if (existing) return { ok: true, value: { workspace: { workspaceId: existing.workspaceId, path: existing.path }, created: false } };
    const workspace = { workspaceId: `workspace-${workspaces.size + 1}`, path: workspacePath };
    workspaces.set(workspacePath, workspace);
    return { ok: true, value: { workspace, created: true } };
  }
  if (method === "session.create") {
    const sessionId = `harness-${sessions.size + 1}`;
    const workspaceId = typeof input.workspaceId === "string" ? input.workspaceId : undefined;
    const workspace = workspaceId
      ? [...workspaces.values()].find((item) => item.workspaceId === workspaceId)
      : undefined;
    sessions.set(sessionId, {
      cwd: workspace?.path ?? (typeof input.cwd === "string" ? input.cwd : "."),
      ...(workspaceId ? { workspaceId } : {}),
      events: []
    });
    return { ok: true, value: { sessionId } };
  }
  if (method === "session.list") {
    return { ok: true, value: { items: [...sessions].map(([sessionId, value]) => ({ sessionId, cwd: value.cwd, ...(value.workspaceId ? { workspaceId: value.workspaceId } : {}), messageCount: value.events.length })) } };
  }
  if (method === "workspace.list") {
    return { ok: true, value: { items: [...workspaces.values()].map((workspace) => ({ workspaceId: workspace.workspaceId, path: workspace.path })), archivedSessionIds: [...archivedSessionIds] } };
  }
  if (method === "session.history") {
    const session = sessions.get(String(input.sessionId));
    if (!session) return { ok: false, error: { code: "session-not-found", message: "session not found" } };
    return { ok: true, value: { events: session.events.map((event) => ({ event })), hasMore: false } };
  }
  if (method === "session.prompt") {
    onPrompt(String(input.sessionId));
    return { ok: true, value: { accepted: true } };
  }
  if (method === "session.cancel" || method === "session.updateQueue") return { ok: true, value: { accepted: true } };
  if (method === "workspace.archiveSession") {
    archivedSessionIds.add(String(input.sessionId ?? ""));
    return { ok: true, value: { archivedSessionIds: [...archivedSessionIds] } };
  }
  if (method === "session.fork") return { ok: true, value: { sessionId: `harness-${sessions.size + 1}` } };
  if (method === "session.models" || method === "llm.models") {
    return {
      ok: true,
      value: {
        groups: [
          {
            id: "deepseek-official",
            name: "DeepSeek",
            models: [
              {
                id: "deepseek-v4-flash",
                name: "DeepSeek-V4-Flash",
                reasoning: {
                  efforts: [{ id: "off", name: "Off" }, { id: "high", name: "High" }, { id: "max", name: "Max" }],
                  defaultEffort: "high"
                }
              },
              {
                id: "deepseek-v4-pro",
                name: "DeepSeek-V4-Pro",
                reasoning: {
                  efforts: [{ id: "off", name: "Off" }, { id: "high", name: "High" }, { id: "max", name: "Max" }],
                  defaultEffort: "high"
                }
              }
            ]
          }
        ],
        failures: []
      }
    };
  }
  if (method === "session.selectModel") return { ok: true, value: { accepted: true } };
  if (method === "unknown.error") return { ok: false, error: { code: "internal", message: "fake business error" } };
  return { ok: false, error: { code: "bad-request", message: `unknown method ${method}` } };
}

function readBody(request: IncomingMessage): Promise<string> {
  return new Promise((resolve, reject) => {
    const chunks: Buffer[] = [];
    request.on("data", (chunk: Buffer) => chunks.push(chunk));
    request.on("end", () => resolve(Buffer.concat(chunks).toString("utf8")));
    request.on("error", reject);
  });
}
