import { createServer, type IncomingMessage } from "node:http";
import type { AddressInfo } from "node:net";

import WebSocket, { WebSocketServer } from "ws";
import { afterEach, describe, expect, it, vi } from "vitest";

import type { AuthContext } from "../../src/modules/auth/auth-service.js";
import type { PeerHostService } from "../../src/modules/peer-host/peer-host-service.js";
import { HostWsProxyService } from "../../src/modules/peer-host/host-ws-proxy-service.js";
import type { WsAuthGuard } from "../../src/ws/ws-auth-guard.js";
import type { PeerHostRecord } from "../../src/types/domain.js";

const closeables: Array<() => Promise<void>> = [];
const sockets: WebSocket[] = [];

describe("Peer HOST WebSocket 终端代理", () => {
  afterEach(async () => {
    for (const socket of sockets.splice(0)) {
      socket.close();
      socket.terminate();
    }

    while (closeables.length > 0) {
      await closeables.pop()?.();
    }
  });

  it("允许本机终端 WebSocket 消息通过 Peer HOST 代理双向转发", async () => {
    const remote = await createRemoteWsServer();
    const receivedByRemote: string[] = [];
    let remoteQueryToken: string | null = null;

    remote.wss.on("connection", (socket, request) => {
      remoteQueryToken = new URL(request.url ?? "/ws", remote.baseUrl).searchParams.get(
        "access_token",
      );

      socket.on("message", (raw) => {
        const message = JSON.parse(raw.toString()) as { type: string };
        receivedByRemote.push(message.type);

        if (receivedByRemote.length === 3) {
          sendRemoteTerminalEvents(socket);
        }
      });
    });

    const clearSession = vi.fn();
    const proxy = new HostWsProxyService(
      createAuthGuardStub(),
      createPeerHostServiceStub(remote.baseUrl, clearSession),
    );
    const proxyServer = createServer();
    proxyServer.on("upgrade", (request, socket, head) => {
      if (!proxy.handleUpgrade(request, socket, head)) {
        socket.destroy();
      }
    });
    closeables.push(() => closeServer(proxyServer));
    await listen(proxyServer);

    const proxyPort = (proxyServer.address() as AddressInfo).port;
    const client = new WebSocket(
      `ws://127.0.0.1:${proxyPort}/api/host-proxy/hosts/peer-1/ws?access_token=current-token`,
    );
    sockets.push(client);

    await waitForOpen(client);
    const receivedByClientPromise = collectMessages(client, 8);
    client.send(JSON.stringify({ type: "terminal.subscribe", terminalId: "terminal-1" }));
    client.send(
      JSON.stringify({
        type: "terminal.input",
        terminalId: "terminal-1",
        content: "pwd\n",
        clientTraceId: "trace-1",
      }),
    );
    client.send(
      JSON.stringify({
        type: "terminal.resize",
        terminalId: "terminal-1",
        cols: 120,
        rows: 32,
      }),
    );

    const receivedByClient = await receivedByClientPromise;

    expect(remoteQueryToken).toBe("target-token");
    expect(receivedByRemote).toEqual([
      "terminal.subscribe",
      "terminal.input",
      "terminal.resize",
    ]);
    expect(receivedByClient.map((message) => message.type)).toEqual([
      "terminal.subscribed",
      "terminal.backfill",
      "terminal.output",
      "terminal.status",
      "terminal.exit",
      "terminal.error",
      "terminal.input.accepted",
      "terminal.resize.accepted",
    ]);
    expect(clearSession).not.toHaveBeenCalled();
  });
});

async function createRemoteWsServer(): Promise<{
  baseUrl: string;
  wss: WebSocketServer;
}> {
  const server = createServer();
  const wss = new WebSocketServer({ noServer: true });

  server.on("upgrade", (request, socket, head) => {
    const pathname = new URL(request.url ?? "/", "http://127.0.0.1").pathname;

    if (pathname !== "/ws") {
      socket.destroy();
      return;
    }

    wss.handleUpgrade(request, socket, head, (client) => {
      wss.emit("connection", client, request);
    });
  });
  closeables.push(() => closeWss(wss));
  closeables.push(() => closeServer(server));
  await listen(server);

  const port = (server.address() as AddressInfo).port;
  return {
    baseUrl: `http://127.0.0.1:${port}`,
    wss,
  };
}

function sendRemoteTerminalEvents(socket: WebSocket): void {
  const terminal = {
    id: "terminal-1",
    status: "running",
    processId: 123,
    statusDetail: null,
  };

  for (const event of [
    { type: "terminal.subscribed", terminalId: "terminal-1" },
    {
      type: "terminal.backfill",
      terminalId: "terminal-1",
      truncated: false,
      cursorReset: false,
      latestCursor: null,
      chunks: [],
    },
    {
      type: "terminal.output",
      terminalId: "terminal-1",
      chunk: {
        terminalId: "terminal-1",
        cursor: "cursor-1",
        stream: "stdout",
        content: "ok",
        timestamp: new Date().toISOString(),
      },
    },
    { type: "terminal.status", terminal },
    { type: "terminal.exit", terminalId: "terminal-1", requestedClose: false, terminal },
    {
      type: "terminal.error",
      terminalId: "terminal-1",
      error_code: "REMOTE_TERMINAL_ERROR",
      detail: "远端终端错误",
    },
    { type: "terminal.input.accepted", terminalId: "terminal-1", clientTraceId: "trace-1" },
    { type: "terminal.resize.accepted", terminalId: "terminal-1", cols: 120, rows: 32 },
  ]) {
    socket.send(JSON.stringify(event));
  }
}

function createAuthGuardStub(): WsAuthGuard {
  return {
    authenticate: (_request: IncomingMessage): AuthContext => ({
      accessToken: "current-token",
      accessTokenId: "current-token-id",
      deviceSessionId: null,
      deviceId: null,
      callerKind: "interactive_user",
      capabilityProfile: null,
      workspaceId: null,
      projectId: null,
      sessionId: null,
      user: {
        userId: "user-1",
        username: "admin",
        role: "admin",
      },
    }),
  } as WsAuthGuard;
}

function createPeerHostServiceStub(
  baseUrl: string,
  clearSession: ReturnType<typeof vi.fn>,
): PeerHostService {
  const peerHost: PeerHostRecord = {
    id: "peer-1",
    ownerUserId: "user-1",
    name: "Peer",
    baseUrl,
    normalizedBaseUrl: baseUrl,
    status: "reachable",
    remoteVersion: "0.0.0-test",
    remoteApiCompatibility: "test",
    remoteHostFingerprint: "fingerprint-1",
    lastCheckedAt: new Date().toISOString(),
    lastErrorCode: null,
    lastErrorDetail: null,
    createdAt: new Date().toISOString(),
    updatedAt: new Date().toISOString(),
    removedAt: null,
  };

  return {
    ensureProxyReady: vi.fn((_ownerUserId: string, peerHostId: string) => {
      expect(peerHostId).toBe("peer-1");
      return peerHost;
    }),
    getAccessTokenForProxy: vi.fn(async () => "target-token"),
    clearSession,
  } as unknown as PeerHostService;
}

function listen(server: ReturnType<typeof createServer>): Promise<void> {
  return new Promise((resolve) => {
    server.listen(0, "127.0.0.1", () => resolve());
  });
}

function closeServer(server: ReturnType<typeof createServer>): Promise<void> {
  return new Promise((resolve) => {
    server.close(() => resolve());
  });
}

function closeWss(wss: WebSocketServer): Promise<void> {
  return new Promise((resolve) => {
    wss.close(() => resolve());
  });
}

function waitForOpen(socket: WebSocket): Promise<void> {
  return new Promise((resolve, reject) => {
    socket.once("open", () => resolve());
    socket.once("error", reject);
  });
}

function collectMessages(
  socket: WebSocket,
  count: number,
): Promise<Array<{ type: string }>> {
  return withTimeout(
    new Promise((resolve) => {
      const messages: Array<{ type: string }> = [];
      socket.on("message", (raw) => {
        messages.push(JSON.parse(raw.toString()) as { type: string });

        if (messages.length >= count) {
          resolve(messages);
        }
      });
    }),
    5_000,
    "等待 Peer HOST 终端代理消息超时",
  );
}

function withTimeout<T>(
  promise: Promise<T>,
  timeoutMs: number,
  message: string,
): Promise<T> {
  return new Promise((resolve, reject) => {
    const timer = setTimeout(() => reject(new Error(message)), timeoutMs);

    promise.then(
      (value) => {
        clearTimeout(timer);
        resolve(value);
      },
      (error) => {
        clearTimeout(timer);
        reject(error);
      },
    );
  });
}
