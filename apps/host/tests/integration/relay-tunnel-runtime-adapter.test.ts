import {
  createHash,
  createHmac,
  createPrivateKey,
  createPublicKey,
  diffieHellman,
  generateKeyPairSync,
  hkdfSync,
  randomBytes,
  randomUUID,
  type KeyObject
} from "node:crypto";
import { once } from "node:events";
import { createServer as createHttpServer, type IncomingMessage, type ServerResponse } from "node:http";
import { mkdtempSync, rmSync } from "node:fs";
import os from "node:os";
import path from "node:path";

import { afterEach, describe, expect, it } from "vitest";
import WebSocket, { WebSocketServer } from "ws";

import {
  __internal__ as relayTunnelRuntimeAdapterInternal,
  RelayTunnelRuntimeEdgeAdapter
} from "../../src/modules/relay-tunnel/relay-tunnel-runtime-adapter.js";
import { buildHostCandidateEndpoints } from "../../src/modules/relay-tunnel/relay-tunnel-candidate-endpoints.js";
import { generateRelayTunnelIdentity } from "../../src/modules/relay-tunnel/crypto/relay-tunnel-identity-service.js";
import { encryptSecret } from "../../src/shared/utils/secret-box.js";
import {
  createRelayTunnelClientHandshake,
  decryptRelayTunnelFrame,
  encryptRelayTunnelFrame,
  finalizeRelayTunnelClientHandshake,
  type RelayTunnelEncryptedFrame,
  type RelayTunnelServerHello
} from "../../src/modules/relay-tunnel/crypto/relay-tunnel-protocol.js";
import {
  deserializeRelayTunnelPacket,
  serializeRelayTunnelPacket,
  type RelayTunnelGatewayPacket,
  type RelayTunnelHttpResponsePacket,
  type RelayTunnelWsMessagePacket,
  type RelayTunnelWsOpenedPacket
} from "../../src/modules/relay-tunnel/crypto/relay-tunnel-packets.js";
import { InstanceRelayTunnelIdentityRepository } from "../../src/storage/repositories/instance-relay-tunnel-identity-repository.js";
import { InstanceRelayTunnelRepository } from "../../src/storage/repositories/instance-relay-tunnel-repository.js";
import { createDatabaseClient } from "../../src/storage/sqlite/client.js";
import type { InstanceRelayTunnelConfig } from "../../src/types/domain.js";

const tempDirs: string[] = [];
const cleanups: Array<() => Promise<void>> = [];

afterEach(async () => {
  while (cleanups.length > 0) {
    await cleanups.pop()?.();
  }

  while (tempDirs.length > 0) {
    const tempDir = tempDirs.pop();

    if (tempDir) {
      rmSync(tempDir, { recursive: true, force: true });
    }
  }
});

describe("RelayTunnelRuntimeEdgeAdapter", () => {
  it("会保留 relayBaseUrl 里的路径前缀来构造 challenge 和 ws 地址", () => {
    expect(
      relayTunnelRuntimeAdapterInternal.buildHttpUrl(
        "https://channel.codingns.com:1443/relay",
        "/api/public/hosts/challenge"
      )
    ).toBe("https://channel.codingns.com:1443/relay/api/public/hosts/challenge");
    expect(
      relayTunnelRuntimeAdapterInternal.buildRelayHostWebSocketUrl(
        "https://channel.codingns.com:1443/relay",
        "binding_demo",
        "challenge_demo",
        "proof_demo"
      )
    ).toBe("wss://channel.codingns.com:1443/relay/ws?role=host-upstream&bindingId=binding_demo&challengeId=challenge_demo&proof=proof_demo");
    expect(
      relayTunnelRuntimeAdapterInternal.buildControlHttpUrl(
        "https://channel.codingns.com:1443/control",
        "/api/v1/hosts/binding_demo/heartbeat"
      )
    ).toBe("https://channel.codingns.com:1443/control/api/v1/hosts/binding_demo/heartbeat");
  });

  it("可以通过 relay-edge 把加密 HTTP 和 WebSocket 包转发到本地 Host", async () => {
    const tempDir = mkdtempSync(path.join(os.tmpdir(), "codingns-relay-runtime-"));
    tempDirs.push(tempDir);

    const databasePath = path.join(tempDir, "host.sqlite");
    const database = createDatabaseClient(databasePath);
    const identityRepository = new InstanceRelayTunnelIdentityRepository(database.db);
    const relayRepository = new InstanceRelayTunnelRepository(database.db);
    const identity = generateRelayTunnelIdentity();

    identityRepository.upsertIdentity(identity);

    const targetServer = await startLocalTargetServer();
    cleanups.push(async () => {
      await targetServer.close();
    });

    const relayServer = await startFakeRelayEdgeServer({
      bindingId: "binding_demo",
      tunnelDomain: "demo.codingns.example",
      hostPublicKey: identity.publicKeyPem,
      hostFingerprint: identity.keyFingerprint
    });
    cleanups.push(async () => {
      await relayServer.close();
    });

    const controlServer = await startFakeControlApiServer({
      bindingId: "binding_demo",
      tunnelDomain: "demo.codingns.example",
      hostFingerprint: identity.keyFingerprint,
      accessToken: "token_demo"
    });
    cleanups.push(async () => {
      await controlServer.close();
    });

    const adapter = new RelayTunnelRuntimeEdgeAdapter(identityRepository, relayRepository, {
      controlSessionSecret: "relay-control-secret"
    });
    const config: InstanceRelayTunnelConfig = {
      activated: true,
      enabled: true,
      provider: "codingns_relay",
      relayBaseUrl: relayServer.wsBaseUrl,
      controlBaseUrl: controlServer.baseUrl,
      controlAccessTokenCiphertext: encryptSecret("relay-control-secret", "token_demo"),
      controlAccountEmail: null,
      controlSessionExpiresAt: null,
      accountId: "acct_demo",
      tunnelDomain: "demo.codingns.example",
      bindingId: "binding_demo",
      hostPublicKey: identity.publicKeyPem,
      hostKeyFingerprint: identity.keyFingerprint,
      localTargetBaseUrl: targetServer.baseUrl,
      updatedAt: new Date().toISOString()
    };

    const connectStatus = await adapter.connect(config, new AbortController().signal);
    expect(connectStatus.phase).toBe("connecting");

    await relayServer.waitForHostChannel();
    relayServer.enqueueSession("session_demo");

    const downstream = new WebSocket(`${relayServer.wsBaseUrl}/ws?sessionId=session_demo&role=downstream`);
    cleanups.push(async () => {
      downstream.close();
    });
    await once(downstream, "open");

    const clientMessages = createDownstreamEnvelopeQueue(downstream);
    const { pendingHandshake, clientHello } = createRelayTunnelClientHandshake({
      expectedHostPublicKey: identity.publicKeyPem,
      expectedHostFingerprint: identity.keyFingerprint
    });

    downstream.send(
      JSON.stringify({
        type: "client_hello",
        hello: clientHello
      })
    );

    const serverHelloEnvelope = await clientMessages.next((value): value is { type: "server_hello"; hello: RelayTunnelServerHello } => {
      return value.type === "server_hello";
    });
    const session = await finalizeRelayTunnelClientHandshake({
      pendingHandshake,
      serverHello: serverHelloEnvelope.hello
    });

    downstream.send(
      JSON.stringify({
        type: "encrypted_frame",
        frame: encryptRelayTunnelFrame(
          session,
          serializeRelayTunnelPacket({
            type: "http.request",
            streamId: "http_1",
            method: "GET",
            path: "/hello",
            headers: {},
            bodyBase64Url: null
          })
        )
      })
    );

    const httpResponsePacket = await waitForGatewayPacket<RelayTunnelHttpResponsePacket>(
      clientMessages,
      session,
      (packet): packet is RelayTunnelHttpResponsePacket => packet.type === "http.response"
    );

    expect(httpResponsePacket.status).toBe(200);
    expect(
      JSON.parse(Buffer.from(httpResponsePacket.bodyBase64Url ?? "", "base64url").toString("utf8"))
    ).toEqual({
      ok: true,
      source: "local-target"
    });

    downstream.send(
      JSON.stringify({
        type: "encrypted_frame",
        frame: encryptRelayTunnelFrame(
          session,
          serializeRelayTunnelPacket({
            type: "ws.open",
            streamId: "ws_1",
            path: "/echo",
            headers: {},
            protocols: ["vite-hmr"]
          })
        )
      })
    );

    const wsOpenedPacket = await waitForGatewayPacket<RelayTunnelWsOpenedPacket>(
      clientMessages,
      session,
      (packet): packet is RelayTunnelWsOpenedPacket => packet.type === "ws.opened"
    );

    expect(wsOpenedPacket.streamId).toBe("ws_1");
    expect(wsOpenedPacket.selectedProtocol).toBe("vite-hmr");

    downstream.send(
      JSON.stringify({
        type: "encrypted_frame",
        frame: encryptRelayTunnelFrame(
          session,
          serializeRelayTunnelPacket({
            type: "ws.message",
            streamId: "ws_1",
            binary: false,
            dataBase64Url: Buffer.from("ping", "utf8").toString("base64url")
          })
        )
      })
    );

    const wsMessagePacket = await waitForGatewayPacket<RelayTunnelWsMessagePacket>(
      clientMessages,
      session,
      (packet): packet is RelayTunnelWsMessagePacket => packet.type === "ws.message"
    );

    expect(Buffer.from(wsMessagePacket.dataBase64Url, "base64url").toString("utf8")).toBe("ping");

    const status = relayRepository.findStatus();
    expect(status?.phase).toBe("running");
    expect(status?.connected).toBe(true);
    expect(await controlServer.waitForHeartbeat()).toEqual({
      authorization: "Bearer token_demo",
      bindingId: "binding_demo",
      tunnelDomain: "demo.codingns.example",
      hostFingerprint: identity.keyFingerprint,
      localTargetBaseUrl: targetServer.baseUrl,
      candidateEndpoints: buildHostCandidateEndpoints(config)
    });

    await adapter.disconnect("test_done");
  }, 15_000);
});

async function startLocalTargetServer(): Promise<{
  baseUrl: string;
  close: () => Promise<void>;
}> {
  const httpServer = createHttpServer((request, response) => {
    handleLocalTargetHttpRequest(request, response);
  });
  const wsServer = new WebSocketServer({
    noServer: true,
    handleProtocols(protocols) {
      if (protocols.has("vite-hmr")) {
        return "vite-hmr";
      }

      return false;
    }
  });

  wsServer.on("connection", (socket) => {
    socket.on("message", (payload, isBinary) => {
      socket.send(payload, {
        binary: isBinary
      });
    });
  });

  httpServer.on("upgrade", (request, socket, head) => {
    if (request.url !== "/echo") {
      socket.destroy();
      return;
    }

    wsServer.handleUpgrade(request, socket, head, (client) => {
      wsServer.emit("connection", client, request);
    });
  });

  await new Promise<void>((resolve) => {
    httpServer.listen(0, "127.0.0.1", () => resolve());
  });

  const address = httpServer.address();

  if (!address || typeof address === "string") {
    throw new Error("local target address unavailable");
  }

  return {
    baseUrl: `http://127.0.0.1:${address.port}`,
    close: async () => {
      for (const client of wsServer.clients) {
        client.terminate();
      }

      wsServer.close();
      await new Promise<void>((resolve, reject) => {
        httpServer.close((error) => {
          if (error) {
            reject(error);
            return;
          }

          resolve();
        });
      });
    }
  };
}

function handleLocalTargetHttpRequest(request: IncomingMessage, response: ServerResponse): void {
  if (request.method === "GET" && request.url === "/hello") {
    response.writeHead(200, {
      "content-type": "application/json"
    });
    response.end(JSON.stringify({
      ok: true,
      source: "local-target"
    }));
    return;
  }

  response.writeHead(404);
  response.end("not found");
}

async function startFakeRelayEdgeServer(input: {
  bindingId: string;
  tunnelDomain: string;
  hostPublicKey: string;
  hostFingerprint: string;
}): Promise<{
  wsBaseUrl: string;
  enqueueSession: (sessionId: string) => void;
  waitForHostChannel: () => Promise<void>;
  close: () => Promise<void>;
}> {
  const challenges = new Map<string, {
    challengeId: string;
    relayPrivateKey: KeyObject;
    relayPublicKey: string;
    relayNonce: string;
  }>();
  const reservations = new Map<string, {
    sessionId: string;
    opened: boolean;
    downstream: WebSocket | null;
  }>();
  let hostChannel: WebSocket | null = null;
  const httpServer = createHttpServer(async (request, response) => {
    const url = new URL(request.url ?? "/", "http://127.0.0.1");

    if (request.method === "POST" && url.pathname === "/api/public/hosts/challenge") {
      const body = await readJsonBody(request) as {
        bindingId?: string;
        tunnelDomain?: string;
        hostFingerprint?: string;
      };

      if (
        body.bindingId !== input.bindingId
        || body.tunnelDomain !== input.tunnelDomain
        || body.hostFingerprint !== input.hostFingerprint
      ) {
        writeJson(response, 403, {
          errorCode: "HOST_AUTH_INVALID",
          detail: "Host 绑定不匹配"
        });
        return;
      }

      const { privateKey, publicKey } = generateKeyPairSync("x25519");
      const challengeId = randomUUID();
      const relayPublicKey = publicKey.export({
        type: "spki",
        format: "der"
      }).toString("base64url");
      const relayNonce = randomBytes(16).toString("base64url");

      challenges.set(challengeId, {
        challengeId,
        relayPrivateKey: privateKey,
        relayPublicKey,
        relayNonce
      });
      writeJson(response, 201, {
        challenge: {
          challengeId,
          relayPublicKey,
          relayNonce,
          expiresAt: new Date(Date.now() + 15_000).toISOString()
        }
      });
      return;
    }

    writeJson(response, 404, {
      errorCode: "NOT_FOUND",
      detail: "not found"
    });
  });
  const wsServer = new WebSocketServer({
    noServer: true
  });

  wsServer.on("connection", (socket, request) => {
    const url = new URL(request.url ?? "/", "http://127.0.0.1");
    const sessionId = url.searchParams.get("sessionId");
    const role = url.searchParams.get("role");

    if (role === "host-upstream") {
      const bindingId = url.searchParams.get("bindingId");
      const challengeId = url.searchParams.get("challengeId");
      const proof = url.searchParams.get("proof");
      const challenge = challengeId ? challenges.get(challengeId) : null;

      if (!challenge || !bindingId || !proof || bindingId !== input.bindingId) {
        socket.close(1008, "HOST_AUTH_INVALID");
        return;
      }

      challenges.delete(challenge.challengeId);
      const expectedProof = createExpectedHostClaimProof({
        challengeId: challenge.challengeId,
        bindingId: input.bindingId,
        tunnelDomain: input.tunnelDomain,
        hostFingerprint: input.hostFingerprint,
        relayNonce: challenge.relayNonce,
        relayPrivateKey: challenge.relayPrivateKey,
        relayPublicKey: challenge.relayPublicKey,
        hostPublicKeyPem: input.hostPublicKey
      });

      if (expectedProof !== proof) {
        socket.close(1008, "HOST_AUTH_INVALID");
        return;
      }

      hostChannel = socket;

      socket.on("message", (payload, isBinary) => {
        if (isBinary) {
          return;
        }

        const envelope = JSON.parse(payload.toString("utf8")) as
          | {
              type: "session.frame";
              sessionId: string;
              payloadBase64Url: string;
            }
          | {
              type: "session.close";
              sessionId: string;
              code: number;
              reason: string | null;
            };
        const reservation = reservations.get(envelope.sessionId) ?? null;

        if (!reservation) {
          return;
        }

        if (envelope.type === "session.frame") {
          if (!reservation.downstream || reservation.downstream.readyState !== WebSocket.OPEN) {
            return;
          }

          reservation.downstream.send(Buffer.from(envelope.payloadBase64Url, "base64url").toString("utf8"));
          return;
        }

        if (reservation.downstream && reservation.downstream.readyState === WebSocket.OPEN) {
          reservation.downstream.close(envelope.code, envelope.reason ?? undefined);
        }
      });

      socket.on("close", () => {
        if (hostChannel === socket) {
          hostChannel = null;
        }
      });

      for (const reservation of reservations.values()) {
        if (!reservation.opened) {
          socket.send(JSON.stringify({
            type: "session.open",
            sessionId: reservation.sessionId
          }));
          reservation.opened = true;
        }
      }

      return;
    }

    const reservation = sessionId ? reservations.get(sessionId) : null;

    if (!reservation || role !== "downstream") {
      socket.close(1008, "SESSION_NOT_FOUND");
      return;
    }

    reservation.downstream = socket;

    socket.on("message", (payload, isBinary) => {
      if (isBinary || !hostChannel || hostChannel.readyState !== WebSocket.OPEN) {
        return;
      }

      hostChannel.send(JSON.stringify({
        type: "session.frame",
        sessionId,
        payloadBase64Url: Buffer.from(payload.toString("utf8"), "utf8").toString("base64url")
      }));
    });

    socket.on("close", (code, reason) => {
      if (reservation.downstream === socket) {
        reservation.downstream = null;
      }

      if (hostChannel && hostChannel.readyState === WebSocket.OPEN) {
        hostChannel.send(JSON.stringify({
          type: "session.close",
          sessionId,
          code,
          reason: reason.length > 0 ? reason.toString("utf8") : null
        }));
      }
    });

    if (hostChannel && hostChannel.readyState === WebSocket.OPEN && !reservation.opened) {
      hostChannel.send(JSON.stringify({
        type: "session.open",
        sessionId
      }));
      reservation.opened = true;
    }
  });

  httpServer.on("upgrade", (request, socket, head) => {
    const url = new URL(request.url ?? "/", "http://127.0.0.1");

    if (url.pathname !== "/ws") {
      socket.destroy();
      return;
    }

    wsServer.handleUpgrade(request, socket, head, (client) => {
      wsServer.emit("connection", client, request);
    });
  });

  await new Promise<void>((resolve) => {
    httpServer.listen(0, "127.0.0.1", () => resolve());
  });

  const address = httpServer.address();

  if (!address || typeof address === "string") {
    throw new Error("fake relay-edge address unavailable");
  }

  return {
    wsBaseUrl: `ws://127.0.0.1:${address.port}`,
    enqueueSession: (sessionId: string) => {
      reservations.set(sessionId, {
        sessionId,
        opened: false,
        downstream: null
      });
      if (hostChannel && hostChannel.readyState === WebSocket.OPEN) {
        hostChannel.send(JSON.stringify({
          type: "session.open",
          sessionId
        }));
        const reservation = reservations.get(sessionId);

        if (reservation) {
          reservation.opened = true;
        }
      }
    },
    waitForHostChannel: async () => {
      const deadline = Date.now() + 5_000;

      while (Date.now() < deadline) {
        if (hostChannel?.readyState === WebSocket.OPEN) {
          return;
        }

        await new Promise<void>((resolve) => {
          setTimeout(resolve, 50);
        });
      }

      throw new Error("等待 Host 持久上游信道接入 relay-edge 超时");
    },
    close: async () => {
      for (const client of wsServer.clients) {
        client.terminate();
      }

      wsServer.close();
      await new Promise<void>((resolve, reject) => {
        httpServer.close((error) => {
          if (error) {
            reject(error);
            return;
          }

          resolve();
        });
      });
    }
  };
}

async function startFakeControlApiServer(input: {
  bindingId: string;
  tunnelDomain: string;
  hostFingerprint: string;
  accessToken: string;
}): Promise<{
  baseUrl: string;
  waitForHeartbeat: () => Promise<{
    authorization: string | undefined;
    bindingId: string;
    tunnelDomain: string;
    hostFingerprint: string;
    localTargetBaseUrl: string | null;
    candidateEndpoints: Array<{
      endpointId: string;
      kind: string;
      url: string;
      priority: number;
      expiresAt: string | null;
      source: string;
    }>;
  }>;
  close: () => Promise<void>;
}> {
  let resolveHeartbeat: ((value: {
    authorization: string | undefined;
    bindingId: string;
    tunnelDomain: string;
    hostFingerprint: string;
    localTargetBaseUrl: string | null;
    candidateEndpoints: Array<{
      endpointId: string;
      kind: string;
      url: string;
      priority: number;
      expiresAt: string | null;
      source: string;
    }>;
  }) => void) | null = null;
  const heartbeatPromise = new Promise<{
    authorization: string | undefined;
    bindingId: string;
    tunnelDomain: string;
    hostFingerprint: string;
    localTargetBaseUrl: string | null;
    candidateEndpoints: Array<{
      endpointId: string;
      kind: string;
      url: string;
      priority: number;
      expiresAt: string | null;
      source: string;
    }>;
  }>((resolve) => {
    resolveHeartbeat = resolve;
  });

  const httpServer = createHttpServer(async (request, response) => {
    const url = new URL(request.url ?? "/", "http://127.0.0.1");

    if (request.method === "POST" && url.pathname === `/api/v1/hosts/${input.bindingId}/heartbeat`) {
      const body = await readJsonBody(request) as {
        tunnelDomain?: string;
        hostFingerprint?: string;
        localTargetBaseUrl?: string;
        candidateEndpoints?: Array<{
          endpointId: string;
          kind: string;
          url: string;
          priority: number;
          expiresAt: string | null;
          source: string;
        }>;
      };
      const authorization = request.headers.authorization;

      if (
        authorization !== `Bearer ${input.accessToken}`
        || body.tunnelDomain !== input.tunnelDomain
        || body.hostFingerprint !== input.hostFingerprint
        || typeof body.localTargetBaseUrl !== "string"
        || !Array.isArray(body.candidateEndpoints)
      ) {
        writeJson(response, 401, {
          errorCode: "AUTH_INVALID",
          detail: "invalid heartbeat"
        });
        return;
      }

      resolveHeartbeat?.({
        authorization,
        bindingId: input.bindingId,
        tunnelDomain: body.tunnelDomain,
        hostFingerprint: body.hostFingerprint,
        localTargetBaseUrl: body.localTargetBaseUrl,
        candidateEndpoints: body.candidateEndpoints
      });
      resolveHeartbeat = null;
      response.writeHead(204);
      response.end();
      return;
    }

    writeJson(response, 404, {
      errorCode: "NOT_FOUND",
      detail: "not found"
    });
  });

  await new Promise<void>((resolve) => {
    httpServer.listen(0, "127.0.0.1", () => resolve());
  });

  const address = httpServer.address();

  if (!address || typeof address === "string") {
    throw new Error("control api address unavailable");
  }

  return {
    baseUrl: `http://127.0.0.1:${address.port}`,
    waitForHeartbeat: async () => await heartbeatPromise,
    close: async () => {
      await new Promise<void>((resolve, reject) => {
        httpServer.close((error) => {
          if (error) {
            reject(error);
            return;
          }

          resolve();
        });
      });
    }
  };
}

function createExpectedHostClaimProof(input: {
  challengeId: string;
  bindingId: string;
  tunnelDomain: string;
  hostFingerprint: string;
  relayNonce: string;
  relayPrivateKey: KeyObject;
  relayPublicKey: string;
  hostPublicKeyPem: string;
}): string {
  const transcript = Buffer.from(
    JSON.stringify({
      challengeId: input.challengeId,
      bindingId: input.bindingId,
      tunnelDomain: input.tunnelDomain,
      hostFingerprint: input.hostFingerprint,
      relayPublicKey: input.relayPublicKey,
      relayNonce: input.relayNonce
    }),
    "utf8"
  );
  const transcriptHash = createHash("sha256").update(transcript).digest();
  const sharedSecret = diffieHellman({
    privateKey: input.relayPrivateKey,
    publicKey: createPublicKey(input.hostPublicKeyPem)
  });
  const proofKey = Buffer.from(
    hkdfSync(
      "sha256",
      sharedSecret,
      transcriptHash,
      Buffer.from("codingns-relay-host-claim-proof", "utf8"),
      32
    )
  );

  return createHmac("sha256", proofKey)
    .update(transcriptHash)
    .digest("base64url");
}

function createDownstreamEnvelopeQueue(socket: WebSocket) {
  const queue: unknown[] = [];
  const waiters = new Set<(value: unknown) => void>();

  socket.on("message", (payload, isBinary) => {
    if (isBinary) {
      return;
    }

    const value = JSON.parse(payload.toString("utf8")) as unknown;
    const waiter = waiters.values().next().value as ((value: unknown) => void) | undefined;

    if (waiter) {
      waiters.delete(waiter);
      waiter(value);
      return;
    }

    queue.push(value);
  });

  return {
    async next<T>(predicate: (value: RelayTunnelControlEnvelope) => value is T): Promise<T> {
      const deadline = Date.now() + 5_000;

      while (Date.now() < deadline) {
        const queuedIndex = queue.findIndex((item) => predicate(item as RelayTunnelControlEnvelope));

        if (queuedIndex >= 0) {
          return queue.splice(queuedIndex, 1)[0] as T;
        }

        const value = await new Promise<unknown>((resolve, reject) => {
          const waiter = (nextValue: unknown) => {
            clearTimeout(timeoutId);
            waiters.delete(waiter);
            resolve(nextValue);
          };
          const timeoutId = setTimeout(() => {
            waiters.delete(waiter);
            reject(new Error("等待 relay-edge 下游消息超时"));
          }, Math.max(deadline - Date.now(), 1));

          waiters.add(waiter);
        });

        if (predicate(value as RelayTunnelControlEnvelope)) {
          return value as T;
        }

        queue.push(value);
      }

      throw new Error("等待 relay-edge 下游消息超时");
    }
  };
}

async function waitForGatewayPacket<T extends RelayTunnelGatewayPacket>(
  queue: ReturnType<typeof createDownstreamEnvelopeQueue>,
  session: Parameters<typeof decryptRelayTunnelFrame>[0],
  predicate: (packet: RelayTunnelGatewayPacket) => packet is T
): Promise<T> {
  while (true) {
    const envelope = await queue.next((value): value is RelayTunnelControlEnvelope => {
      return value.type === "encrypted_frame" || value.type === "error";
    });

    if (envelope.type === "error") {
      throw new Error(`${envelope.errorCode}: ${envelope.detail}`);
    }

    const packet = deserializeRelayTunnelPacket(decryptRelayTunnelFrame(session, envelope.frame));

    if (predicate(packet)) {
      return packet;
    }
  }
}

async function readJsonBody(request: IncomingMessage): Promise<unknown> {
  const chunks: Buffer[] = [];

  for await (const chunk of request) {
    chunks.push(Buffer.from(chunk));
  }

  if (chunks.length === 0) {
    return {};
  }

  return JSON.parse(Buffer.concat(chunks).toString("utf8")) as unknown;
}

function writeJson(response: ServerResponse, statusCode: number, body: unknown): void {
  response.writeHead(statusCode, {
    "content-type": "application/json"
  });
  response.end(JSON.stringify(body));
}

interface RelayTunnelServerHelloEnvelope {
  type: "server_hello";
  hello: RelayTunnelServerHello;
}

interface RelayTunnelEncryptedFrameEnvelope {
  type: "encrypted_frame";
  frame: RelayTunnelEncryptedFrame;
}

interface RelayTunnelErrorEnvelope {
  type: "error";
  errorCode: string;
  detail: string;
}

type RelayTunnelControlEnvelope =
  | RelayTunnelServerHelloEnvelope
  | RelayTunnelEncryptedFrameEnvelope
  | RelayTunnelErrorEnvelope;
