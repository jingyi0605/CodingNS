import WebSocket from "ws";

import { decryptSecret } from "../../shared/utils/secret-box.js";
import type { InstanceRelayTunnelIdentityRepository } from "../../storage/repositories/instance-relay-tunnel-identity-repository.js";
import type { InstanceRelayTunnelRepository } from "../../storage/repositories/instance-relay-tunnel-repository.js";
import { nowIso } from "../../shared/utils/time.js";
import type {
  InstanceRelayTunnelConfig,
  InstanceRelayTunnelIdentity,
  InstanceRelayTunnelStatus,
  RelayTunnelPhase
} from "../../types/domain.js";
import {
  acceptRelayTunnelClientHandshake,
  decryptRelayTunnelFrame,
  encryptRelayTunnelFrame,
  type RelayTunnelClientHello,
  type RelayTunnelEncryptedFrame,
  type RelayTunnelServerHello,
  type RelayTunnelSession
} from "./crypto/relay-tunnel-protocol.js";
import {
  deserializeRelayTunnelPacket,
  serializeRelayTunnelPacket
} from "./crypto/relay-tunnel-packets.js";
import type { RelaySessionClientContext } from "./relay-tunnel-client-context.js";
import { createRelayTunnelHostClaimProof } from "./relay-tunnel-edge-proof.js";
import { RelayTunnelGatewayService } from "./relay-tunnel-gateway-service.js";
import type { RelayTunnelRuntimeAdapter } from "./relay-tunnel-service.js";

interface RelayHostChallengeResponse {
  challenge: {
    challengeId: string;
    relayPublicKey: string;
    relayNonce: string;
    expiresAt: string;
  };
}

interface RelayTunnelClientHelloEnvelope {
  type: "client_hello";
  hello: RelayTunnelClientHello;
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

interface RelayEdgeSessionOpenEnvelope {
  type: "session.open";
  sessionId: string;
  clientContext?: RelaySessionClientContext | null;
}

interface RelayEdgeSessionFrameEnvelope {
  type: "session.frame";
  sessionId: string;
  payloadBase64Url: string;
}

interface RelayEdgeSessionCloseEnvelope {
  type: "session.close";
  sessionId: string;
  code: number;
  reason: string | null;
}

type RelayTunnelControlEnvelope =
  | RelayTunnelClientHelloEnvelope
  | RelayTunnelServerHelloEnvelope
  | RelayTunnelEncryptedFrameEnvelope
  | RelayTunnelErrorEnvelope;

type RelayEdgeHostEnvelope =
  | RelayEdgeSessionOpenEnvelope
  | RelayEdgeSessionFrameEnvelope
  | RelayEdgeSessionCloseEnvelope;

interface ActiveRelaySession {
  relaySessionId: string;
  clientContext: RelaySessionClientContext | null;
  gateway: RelayTunnelGatewayService | null;
  cryptoSession: RelayTunnelSession | null;
  closed: boolean;
  inboundQueue: Promise<void>;
}

export class RelayTunnelRuntimeHttpError extends Error {
  constructor(
    readonly statusCode: number,
    readonly errorCode: string | null,
    readonly detail: string,
    prefix: string
  ) {
    super(`${prefix}：${detail}`);
    this.name = "RelayTunnelRuntimeHttpError";
  }
}

const IDLE_POLL_MS = 1_000;
const ERROR_RETRY_MS = 2_000;
const CHALLENGE_TIMEOUT_MS = 8_000;
const HEARTBEAT_INTERVAL_MS = 5_000;
const HEARTBEAT_TIMEOUT_MS = 5_000;

export class RelayTunnelRuntimeEdgeAdapter implements RelayTunnelRuntimeAdapter {
  private currentConfigKey: string | null = null;
  private runtimeAbortController: AbortController | null = null;
  private runtimePromise: Promise<void> | null = null;
  private hostChannelSocket: WebSocket | null = null;
  private activeSessions = new Map<string, ActiveRelaySession>();
  private lastPhase: RelayTunnelPhase = "connecting";
  private latestRemainingBytes: string | null = null;
  private lastHeartbeatAttemptAtMs: number | null = null;

  constructor(
    private readonly identityRepository: InstanceRelayTunnelIdentityRepository,
    private readonly repository: InstanceRelayTunnelRepository,
    private readonly dependencies?: {
      fetchFn?: typeof fetch;
      createWebSocket?: (url: string) => WebSocket;
      controlSessionSecret?: string;
    }
  ) {}

  async connect(
    config: InstanceRelayTunnelConfig,
    signal: AbortSignal
  ): Promise<InstanceRelayTunnelStatus> {
    const identity = this.identityRepository.findIdentity();

    if (!identity) {
      throw new Error("当前 Host 还没有可用的 CodingNS Connect 身份密钥");
    }

    const configKey = serializeConfigKey(config);

    if (this.currentConfigKey !== configKey) {
      await this.disconnect("relay_tunnel_runtime_reconfigure");
      this.currentConfigKey = configKey;
      this.lastPhase = "connecting";
      this.latestRemainingBytes = null;
      this.lastHeartbeatAttemptAtMs = null;
      this.runtimeAbortController = new AbortController();
      this.runtimePromise = this.runSupervisor(config, identity, this.runtimeAbortController.signal);
    }

    if (signal.aborted) {
      throw new Error("操作已取消");
    }

    return buildStatus(this.lastPhase, config, identity.keyFingerprint, this.latestRemainingBytes);
  }

  async disconnect(_reason?: string): Promise<void> {
    const controller = this.runtimeAbortController;

    this.runtimeAbortController = null;
    this.currentConfigKey = null;
    this.lastHeartbeatAttemptAtMs = null;

    if (controller) {
      controller.abort();
    }

    this.hostChannelSocket?.close();
    this.hostChannelSocket = null;
    this.closeAllSessions();

    try {
      await this.runtimePromise;
    } catch {
      // 停机路径不再额外抛错。
    }

    this.runtimePromise = null;
  }

  private async runSupervisor(
    config: InstanceRelayTunnelConfig,
    identity: InstanceRelayTunnelIdentity,
    signal: AbortSignal
  ): Promise<void> {
    while (!signal.aborted) {
      try {
        await this.maybeSendHeartbeat(config, identity, signal);
        await this.runHostUpstreamChannel(config, identity, signal);
      } catch (error) {
        if (signal.aborted) {
          break;
        }

        const message = error instanceof Error ? error.message : String(error);
        const phase = this.lastPhase === "quota_exhausted" ? "quota_exhausted" : "error";
        this.repository.upsertStatus({
          ...buildStatus(phase, config, identity.keyFingerprint, this.latestRemainingBytes),
          connected: false,
          lastError: message
        });

        await waitForDelay(ERROR_RETRY_MS, signal);
      }
    }
  }

  private async runHostUpstreamChannel(
    config: InstanceRelayTunnelConfig,
    identity: InstanceRelayTunnelIdentity,
    signal: AbortSignal
  ): Promise<void> {
    const socket = await this.openHostUpstreamChannel(config, identity, signal);
    this.hostChannelSocket = socket;
    this.lastPhase = "running";
    this.repository.upsertStatus(
      buildStatus("running", config, identity.keyFingerprint, this.latestRemainingBytes)
    );

    const closed = createSocketCloseSignal(socket);

    socket.on("message", (payload, isBinary) => {
      if (isBinary) {
        socket.close(1008, "HOST_CHANNEL_BINARY_NOT_SUPPORTED");
        return;
      }

      const rawPayload = typeof payload === "string" ? payload : payload.toString("utf8");
      void this.handleHostChannelPayload(config, identity, rawPayload);
    });

    while (!signal.aborted) {
      const result = await Promise.race([
        closed.promise,
        waitForDelay(IDLE_POLL_MS, signal).then(() => null)
      ]);

      if (result) {
        this.hostChannelSocket = null;
        this.closeAllSessions();

        if (result.error) {
          throw result.error;
        }

        throw new Error(
          `Host 上游信道已断开（code=${result.code}${result.reason ? `, reason=${result.reason}` : ""}）`
        );
      }

      await this.maybeSendHeartbeat(config, identity, signal);
    }

    socket.close(1000, "relay_tunnel_runtime_abort");
    await closed.promise;
    this.hostChannelSocket = null;
    this.closeAllSessions();
  }

  private async maybeSendHeartbeat(
    config: InstanceRelayTunnelConfig,
    identity: InstanceRelayTunnelIdentity,
    signal: AbortSignal
  ): Promise<void> {
    const heartbeatRequest = this.buildHeartbeatRequest(config, identity);

    if (!heartbeatRequest) {
      return;
    }

    const nowMs = Date.now();

    if (
      this.lastHeartbeatAttemptAtMs !== null
      && nowMs - this.lastHeartbeatAttemptAtMs < HEARTBEAT_INTERVAL_MS
    ) {
      return;
    }

    this.lastHeartbeatAttemptAtMs = nowMs;
    const fetchFn = this.dependencies?.fetchFn ?? fetch;

    try {
      const response = await fetchWithTimeout(
        fetchFn,
        heartbeatRequest.url,
        {
          method: "POST",
          headers: heartbeatRequest.headers,
          body: heartbeatRequest.body,
          signal
        },
        HEARTBEAT_TIMEOUT_MS
      );

      if (!response.ok) {
        throw await buildHttpError(response, "上报 Host 心跳失败");
      }
    } catch {
      // 心跳只负责在线统计，不能打断主链路。
    }
  }

  private async openHostUpstreamChannel(
    config: InstanceRelayTunnelConfig,
    identity: InstanceRelayTunnelIdentity,
    signal: AbortSignal
  ): Promise<WebSocket> {
    const fetchFn = this.dependencies?.fetchFn ?? fetch;
    const challengeResponse = await fetchWithTimeout(
      fetchFn,
      buildHttpUrl(config.relayBaseUrl!, "/api/public/hosts/challenge"),
      {
        method: "POST",
        headers: {
          "Content-Type": "application/json"
        },
        body: JSON.stringify({
          bindingId: config.bindingId,
          tunnelDomain: config.tunnelDomain,
          hostFingerprint: identity.keyFingerprint
        }),
        signal
      },
      CHALLENGE_TIMEOUT_MS
    );

    if (!challengeResponse.ok) {
      throw await buildHttpError(challengeResponse, "申请 Host 上游接入挑战失败");
    }

    const challengePayload = await challengeResponse.json() as RelayHostChallengeResponse;
    const proof = createRelayTunnelHostClaimProof({
      challengeId: challengePayload.challenge.challengeId,
      bindingId: config.bindingId!,
      tunnelDomain: config.tunnelDomain!,
      hostFingerprint: identity.keyFingerprint,
      relayNonce: challengePayload.challenge.relayNonce,
      relayPublicKey: challengePayload.challenge.relayPublicKey,
      hostPrivateKeyPem: identity.privateKeyPem
    });
    const socket = (this.dependencies?.createWebSocket ?? ((url) => new WebSocket(url)))(
      buildRelayHostWebSocketUrl(
        config.relayBaseUrl!,
        config.bindingId!,
        challengePayload.challenge.challengeId,
        proof
      )
    );

    await waitForSocketOpen(socket, signal);
    return socket;
  }

  private buildHeartbeatRequest(
    config: InstanceRelayTunnelConfig,
    identity: InstanceRelayTunnelIdentity
  ): {
    url: string;
    headers: Record<string, string>;
    body: string;
  } | null {
    const controlBaseUrl = normalizeRequiredText(config.controlBaseUrl);
    const bindingId = normalizeRequiredText(config.bindingId);
    const tunnelDomain = normalizeRequiredText(config.tunnelDomain);
    const encryptedAccessToken = normalizeRequiredText(config.controlAccessTokenCiphertext);
    const controlSessionSecret = normalizeRequiredText(this.dependencies?.controlSessionSecret);

    if (
      !controlBaseUrl
      || !bindingId
      || !tunnelDomain
      || !encryptedAccessToken
      || !controlSessionSecret
    ) {
      return null;
    }

    try {
      const accessToken = decryptSecret(controlSessionSecret, encryptedAccessToken);

      return {
        url: buildControlHttpUrl(controlBaseUrl, `/api/v1/hosts/${bindingId}/heartbeat`),
        headers: {
          "Content-Type": "application/json",
          Authorization: `Bearer ${accessToken}`
        },
        body: JSON.stringify({
          tunnelDomain,
          hostFingerprint: identity.keyFingerprint
        })
      };
    } catch {
      return null;
    }
  }

  private async handleHostChannelPayload(
    config: InstanceRelayTunnelConfig,
    identity: InstanceRelayTunnelIdentity,
    rawPayload: string
  ): Promise<void> {
    let envelope: RelayEdgeHostEnvelope;

    try {
      envelope = JSON.parse(rawPayload) as RelayEdgeHostEnvelope;
    } catch {
      this.hostChannelSocket?.close(1008, "HOST_CHANNEL_INVALID_ENVELOPE");
      return;
    }

    if (envelope.type === "session.open") {
      this.ensureRelaySession(envelope.sessionId, envelope.clientContext ?? null);
      return;
    }

    if (envelope.type === "session.close") {
      this.teardownRelaySession(envelope.sessionId);
      return;
    }

    const activeSession = this.activeSessions.get(envelope.sessionId) ?? null;

    if (!activeSession) {
      this.sendSessionClose(envelope.sessionId, 1008, "SESSION_NOT_FOUND");
      return;
    }

    activeSession.inboundQueue = activeSession.inboundQueue
      .catch(() => undefined)
      .then(async () => {
        if (activeSession.closed) {
          return;
        }

        await this.handleRelayPayload(
          activeSession,
          config,
          identity,
          Buffer.from(envelope.payloadBase64Url, "base64url").toString("utf8")
        );
      });
  }

  private ensureRelaySession(
    sessionId: string,
    clientContext: RelaySessionClientContext | null = null
  ): ActiveRelaySession {
    const existing = this.activeSessions.get(sessionId);

    if (existing) {
      existing.clientContext = clientContext;
      return existing;
    }

    const created: ActiveRelaySession = {
      relaySessionId: sessionId,
      clientContext,
      gateway: null,
      cryptoSession: null,
      closed: false,
      inboundQueue: Promise.resolve()
    };
    this.activeSessions.set(sessionId, created);
    return created;
  }

  private async handleRelayPayload(
    activeSession: ActiveRelaySession,
    config: InstanceRelayTunnelConfig,
    identity: InstanceRelayTunnelIdentity,
    rawPayload: string
  ): Promise<void> {
    let envelope: RelayTunnelControlEnvelope;

    try {
      envelope = JSON.parse(rawPayload) as RelayTunnelControlEnvelope;
    } catch {
      await this.emitRelayError(activeSession, "INVALID_CONTROL_ENVELOPE", "CodingNS Connect 控制包不是合法 JSON");
      return;
    }

    if (envelope.type === "client_hello") {
      if (activeSession.cryptoSession) {
        await this.emitRelayError(activeSession, "HANDSHAKE_ALREADY_COMPLETED", "当前会话已经完成握手");
        return;
      }

      try {
        const accepted = acceptRelayTunnelClientHandshake({
          hostIdentity: identity,
          clientHello: envelope.hello
        });

        activeSession.cryptoSession = accepted.session;
        activeSession.gateway = new RelayTunnelGatewayService({
          localTargetBaseUrl: config.localTargetBaseUrl,
          sessionId: activeSession.relaySessionId,
          clientContext: activeSession.clientContext,
          onPacket: async (packet) => {
            if (!activeSession.cryptoSession || activeSession.closed) {
              return;
            }

            const frame = encryptRelayTunnelFrame(
              activeSession.cryptoSession,
              serializeRelayTunnelPacket(packet)
            );

            await this.sendControlEnvelope(activeSession.relaySessionId, {
              type: "encrypted_frame",
              frame
            } satisfies RelayTunnelEncryptedFrameEnvelope);
          }
        });
        await this.sendControlEnvelope(activeSession.relaySessionId, {
          type: "server_hello",
          hello: accepted.serverHello
        } satisfies RelayTunnelServerHelloEnvelope);
      } catch (error) {
        await this.emitRelayError(
          activeSession,
          "HANDSHAKE_FAILED",
          error instanceof Error ? error.message : String(error)
        );
      }

      return;
    }

    if (envelope.type === "encrypted_frame") {
      if (!activeSession.cryptoSession || !activeSession.gateway) {
        await this.emitRelayError(activeSession, "HANDSHAKE_REQUIRED", "当前会话还没有完成握手");
        return;
      }

      try {
        const plaintext = decryptRelayTunnelFrame(activeSession.cryptoSession, envelope.frame);

        if (!plaintext) {
          return;
        }

        await activeSession.gateway.handlePacket(deserializeRelayTunnelPacket(plaintext));
      } catch (error) {
        await this.emitRelayError(
          activeSession,
          "DECRYPT_FRAME_FAILED",
          error instanceof Error ? error.message : String(error)
        );
      }

      return;
    }

    if (envelope.type === "error") {
      this.repository.upsertStatus({
        ...buildStatus("error", config, identity.keyFingerprint, this.latestRemainingBytes),
        connected: false,
        lastError: `${envelope.errorCode}: ${envelope.detail}`
      });
    }
  }

  private async sendControlEnvelope(
    sessionId: string,
    envelope: RelayTunnelControlEnvelope
  ): Promise<void> {
    if (!this.hostChannelSocket || this.hostChannelSocket.readyState !== WebSocket.OPEN) {
      return;
    }

    this.hostChannelSocket.send(JSON.stringify({
      type: "session.frame",
      sessionId,
      payloadBase64Url: Buffer.from(JSON.stringify(envelope), "utf8").toString("base64url")
    } satisfies RelayEdgeSessionFrameEnvelope));
  }

  private sendSessionClose(sessionId: string, code: number, reason: string | null): void {
    if (!this.hostChannelSocket || this.hostChannelSocket.readyState !== WebSocket.OPEN) {
      return;
    }

    this.hostChannelSocket.send(JSON.stringify({
      type: "session.close",
      sessionId,
      code,
      reason
    } satisfies RelayEdgeSessionCloseEnvelope));
  }

  private async emitRelayError(
    activeSession: ActiveRelaySession,
    errorCode: string,
    detail: string
  ): Promise<void> {
    await this.sendControlEnvelope(activeSession.relaySessionId, {
      type: "error",
      errorCode,
      detail
    } satisfies RelayTunnelErrorEnvelope);
  }

  private teardownRelaySession(sessionId: string): void {
    const activeSession = this.activeSessions.get(sessionId);

    if (!activeSession) {
      return;
    }

    activeSession.closed = true;
    activeSession.gateway?.close();
    this.activeSessions.delete(sessionId);
  }

  private closeAllSessions(): void {
    for (const sessionId of this.activeSessions.keys()) {
      this.teardownRelaySession(sessionId);
    }
  }
}

function buildStatus(
  phase: RelayTunnelPhase,
  config: InstanceRelayTunnelConfig,
  hostFingerprint: string | null,
  remainingBytes: string | null
): InstanceRelayTunnelStatus {
  return {
    phase,
    connected: phase === "running",
    bindingId: config.bindingId,
    tunnelDomain: config.tunnelDomain,
    hostFingerprint,
    trafficUsedBytes: null,
    trafficRemainingBytes: remainingBytes,
    quotaResetAt: null,
    lastError: null,
    observedAt: nowIso()
  };
}

function serializeConfigKey(config: InstanceRelayTunnelConfig): string {
  return JSON.stringify({
    relayBaseUrl: config.relayBaseUrl,
    bindingId: config.bindingId,
    tunnelDomain: config.tunnelDomain,
    localTargetBaseUrl: config.localTargetBaseUrl,
    hostPublicKey: config.hostPublicKey,
    hostKeyFingerprint: config.hostKeyFingerprint
  });
}

function buildHttpUrl(baseUrl: string, pathname: string): string {
  const url = resolveRelayBaseUrl(baseUrl, pathname);

  url.protocol = url.protocol === "wss:" || url.protocol === "https:" ? "https:" : "http:";
  return url.toString();
}

function buildRelayHostWebSocketUrl(
  relayBaseUrl: string,
  bindingId: string,
  challengeId: string,
  proof: string
): string {
  const url = resolveRelayBaseUrl(relayBaseUrl, "ws");

  url.searchParams.set("role", "host-upstream");
  url.searchParams.set("bindingId", bindingId);
  url.searchParams.set("challengeId", challengeId);
  url.searchParams.set("proof", proof);
  url.protocol = url.protocol === "https:" || url.protocol === "wss:" ? "wss:" : "ws:";
  return url.toString();
}

function buildControlHttpUrl(controlBaseUrl: string, pathname: string): string {
  const url = new URL(pathname.replace(/^\/+/, ""), ensureTrailingSlash(controlBaseUrl));

  url.protocol = url.protocol === "https:" ? "https:" : "http:";
  return url.toString();
}

function ensureTrailingSlash(value: string): string {
  return value.endsWith("/") ? value : `${value}/`;
}

function resolveRelayBaseUrl(baseUrl: string, pathname: string): URL {
  return new URL(pathname.replace(/^\/+/, ""), ensureTrailingSlash(baseUrl));
}

async function waitForSocketOpen(socket: WebSocket, signal: AbortSignal): Promise<void> {
  if (socket.readyState === WebSocket.OPEN) {
    return;
  }

  await new Promise<void>((resolve, reject) => {
    const handleOpen = () => {
      cleanup();
      resolve();
    };
    const handleClose = (code: number, reason: Buffer) => {
      cleanup();
      reject(new Error(`Host 上游信道建立失败（code=${code}${reason.length > 0 ? `, reason=${reason.toString("utf8")}` : ""}）`));
    };
    const handleError = (error: Error) => {
      cleanup();
      reject(error);
    };
    const handleAbort = () => {
      cleanup();
      reject(new Error("操作已取消"));
    };
    const cleanup = () => {
      socket.off("open", handleOpen);
      socket.off("close", handleClose);
      socket.off("error", handleError);
      signal.removeEventListener("abort", handleAbort);
    };

    socket.on("open", handleOpen);
    socket.on("close", handleClose);
    socket.on("error", handleError);
    signal.addEventListener("abort", handleAbort, {
      once: true
    });
  });
}

function createSocketCloseSignal(socket: WebSocket): {
  promise: Promise<{ code: number; reason: string; error?: Error }>;
} {
  return {
    promise: new Promise((resolve) => {
      let settled = false;
      const finish = (value: { code: number; reason: string; error?: Error }) => {
        if (settled) {
          return;
        }

        settled = true;
        resolve(value);
      };

      socket.once("close", (code, reason) => {
        finish({
          code,
          reason: reason.length > 0 ? reason.toString("utf8") : ""
        });
      });
      socket.once("error", (error) => {
        finish({
          code: 1006,
          reason: error.message,
          error
        });
      });
    })
  };
}

async function fetchWithTimeout(
  fetchFn: typeof fetch,
  input: string,
  init: RequestInit & { signal?: AbortSignal },
  timeoutMs: number
): Promise<Response> {
  const controller = new AbortController();
  const timeoutId = setTimeout(() => controller.abort(), timeoutMs);
  const linkedAbort = () => controller.abort();

  init.signal?.addEventListener("abort", linkedAbort, {
    once: true
  });

  try {
    return await fetchFn(input, {
      ...init,
      signal: controller.signal
    });
  } finally {
    clearTimeout(timeoutId);
    init.signal?.removeEventListener("abort", linkedAbort);
  }
}

async function buildHttpError(response: Response, prefix: string): Promise<Error> {
  const raw = await response.text();

  if (!raw.trim()) {
    return new RelayTunnelRuntimeHttpError(
      response.status,
      null,
      `HTTP ${response.status}`,
      prefix
    );
  }

  try {
    const parsed = JSON.parse(raw) as {
      errorCode?: string;
      detail?: string;
    };

    if (typeof parsed.detail === "string" && parsed.detail.trim()) {
      return new RelayTunnelRuntimeHttpError(
        response.status,
        typeof parsed.errorCode === "string" ? parsed.errorCode : null,
        parsed.detail.trim(),
        prefix
      );
    }
  } catch {
    // 回退到可读文本错误。
  }

  return new RelayTunnelRuntimeHttpError(
    response.status,
    null,
    raw.trim(),
    prefix
  );
}

async function waitForDelay(delayMs: number, signal: AbortSignal): Promise<void> {
  if (signal.aborted) {
    throw new Error("操作已取消");
  }

  await new Promise<void>((resolve, reject) => {
    const timeoutId = setTimeout(() => {
      signal.removeEventListener("abort", handleAbort);
      resolve();
    }, delayMs);
    const handleAbort = () => {
      clearTimeout(timeoutId);
      reject(new Error("操作已取消"));
    };

    signal.addEventListener("abort", handleAbort, {
      once: true
    });
  });
}

export const __internal__ = {
  buildHttpUrl,
  buildRelayHostWebSocketUrl,
  buildControlHttpUrl
};

function normalizeRequiredText(value: string | null | undefined): string | null {
  const normalized = value?.trim() ?? "";
  return normalized.length > 0 ? normalized : null;
}
