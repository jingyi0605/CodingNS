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

interface RelayHostClaimNextSessionResponse {
  reservation: {
    sessionId: string;
    accountId: string;
    bindingId: string;
    tunnelDomain: string;
    remainingBytes: string;
    upstreamConnected: boolean;
    downstreamConnected: boolean;
  } | null;
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

type RelayTunnelControlEnvelope =
  | RelayTunnelClientHelloEnvelope
  | RelayTunnelServerHelloEnvelope
  | RelayTunnelEncryptedFrameEnvelope
  | RelayTunnelErrorEnvelope;

interface ActiveRelaySession {
  relaySessionId: string;
  socket: WebSocket;
  gateway: RelayTunnelGatewayService | null;
  cryptoSession: RelayTunnelSession | null;
  closed: boolean;
}

const IDLE_POLL_MS = 1_000;
const ERROR_RETRY_MS = 2_000;
const CLAIM_TIMEOUT_MS = 8_000;
const HEARTBEAT_INTERVAL_MS = 5_000;
const HEARTBEAT_TIMEOUT_MS = 5_000;

export class RelayTunnelRuntimeEdgeAdapter implements RelayTunnelRuntimeAdapter {
  private currentConfigKey: string | null = null;
  private runtimeAbortController: AbortController | null = null;
  private runtimePromise: Promise<void> | null = null;
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
      throw new Error("当前 Host 还没有可用的公共隧道身份密钥");
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

    for (const activeSession of this.activeSessions.values()) {
      activeSession.closed = true;
      activeSession.gateway?.close();
      activeSession.socket.close();
    }

    this.activeSessions.clear();

    try {
      await this.runtimePromise;
    } catch {
      // 这里是停机路径，错误已经在状态里体现，不再向上抛。
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
        const claim = await this.claimNextSession(config, identity, signal);
        const remainingBytes = claim?.remainingBytes ?? this.latestRemainingBytes;

        this.latestRemainingBytes = remainingBytes;
        if (claim) {
          this.lastPhase = "running";
          this.startRelaySession(config, identity, claim);
        } else if (this.lastPhase === "connecting") {
          this.lastPhase = "running";
        }

        const status = buildStatus(this.lastPhase, config, identity.keyFingerprint, remainingBytes);
        this.repository.upsertStatus(status);

        if (!claim) {
          await waitForDelay(IDLE_POLL_MS, signal);
        }
      } catch (error) {
        if (signal.aborted) {
          break;
        }

        const message = error instanceof Error ? error.message : String(error);
        const phase = this.lastPhase === "quota_exhausted" ? "quota_exhausted" : "error";
        const failedStatus: InstanceRelayTunnelStatus = {
          ...buildStatus(phase, config, identity.keyFingerprint, this.latestRemainingBytes),
          connected: false,
          lastError: message
        };

        this.repository.upsertStatus(failedStatus);

        await waitForDelay(ERROR_RETRY_MS, signal);
      }
    }
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
      // 心跳只负责在线统计，不能反过来把隧道主链路打断。
    }
  }

  private async claimNextSession(
    config: InstanceRelayTunnelConfig,
    identity: InstanceRelayTunnelIdentity,
    signal: AbortSignal
  ): Promise<RelayHostClaimNextSessionResponse["reservation"]> {
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
      CLAIM_TIMEOUT_MS
    );

    if (!challengeResponse.ok) {
      throw await buildHttpError(challengeResponse, "申请 Host 领取挑战失败");
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
    const claimResponse = await fetchWithTimeout(
      fetchFn,
      buildHttpUrl(config.relayBaseUrl!, "/api/public/hosts/claim-next-session"),
      {
        method: "POST",
        headers: {
          "Content-Type": "application/json"
        },
        body: JSON.stringify({
          challengeId: challengePayload.challenge.challengeId,
          proof
        }),
        signal
      },
      CLAIM_TIMEOUT_MS
    );

    if (!claimResponse.ok) {
      throw await buildHttpError(claimResponse, "领取待接会话失败");
    }

    const claimPayload = await claimResponse.json() as RelayHostClaimNextSessionResponse;
    return claimPayload.reservation;
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

  private startRelaySession(
    config: InstanceRelayTunnelConfig,
    identity: InstanceRelayTunnelIdentity,
    reservation: NonNullable<RelayHostClaimNextSessionResponse["reservation"]>
  ): void {
    if (this.activeSessions.has(reservation.sessionId)) {
      return;
    }

    const socket = (this.dependencies?.createWebSocket ?? ((url) => new WebSocket(url)))(
      buildRelayWebSocketUrl(config.relayBaseUrl!, reservation.sessionId)
    );
    const activeSession: ActiveRelaySession = {
      relaySessionId: reservation.sessionId,
      socket,
      gateway: null,
      cryptoSession: null,
      closed: false
    };

    this.activeSessions.set(reservation.sessionId, activeSession);

    socket.on("message", (payload, isBinary) => {
      if (isBinary) {
        void this.emitRelayError(activeSession, "UNSUPPORTED_BINARY_FRAME", "公共隧道控制面不支持二进制帧");
        return;
      }

      const rawPayload = typeof payload === "string" ? payload : payload.toString("utf8");
      void this.handleRelayPayload(activeSession, config, identity, rawPayload);
    });

    socket.on("close", (code, reason) => {
      this.teardownRelaySession(reservation.sessionId);

      if (code === 1008 && reason.toString("utf8") === "QUOTA_EXHAUSTED") {
        this.lastPhase = "quota_exhausted";
        this.latestRemainingBytes = "0";
        this.repository.upsertStatus({
          ...buildStatus("quota_exhausted", config, identity.keyFingerprint, "0"),
          connected: false,
          lastError: "公共隧道流量额度已经耗尽"
        });
      }
    });

    socket.on("error", (error) => {
      this.repository.upsertStatus({
        ...buildStatus("error", config, identity.keyFingerprint, this.latestRemainingBytes),
        connected: false,
        lastError: error.message
      });
    });
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
      await this.emitRelayError(activeSession, "INVALID_CONTROL_ENVELOPE", "公共隧道控制包不是合法 JSON");
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
          onPacket: async (packet) => {
            if (!activeSession.cryptoSession || activeSession.closed || activeSession.socket.readyState !== WebSocket.OPEN) {
              return;
            }

            const frame = encryptRelayTunnelFrame(
              activeSession.cryptoSession,
              serializeRelayTunnelPacket(packet)
            );

            activeSession.socket.send(
              JSON.stringify({
                type: "encrypted_frame",
                frame
              } satisfies RelayTunnelEncryptedFrameEnvelope)
            );
          }
        });
        activeSession.socket.send(
          JSON.stringify({
            type: "server_hello",
            hello: accepted.serverHello
          } satisfies RelayTunnelServerHelloEnvelope)
        );
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

  private async emitRelayError(
    activeSession: ActiveRelaySession,
    errorCode: string,
    detail: string
  ): Promise<void> {
    if (activeSession.closed || activeSession.socket.readyState !== WebSocket.OPEN) {
      return;
    }

    activeSession.socket.send(
      JSON.stringify({
        type: "error",
        errorCode,
        detail
      } satisfies RelayTunnelErrorEnvelope)
    );
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

function buildRelayWebSocketUrl(relayBaseUrl: string, sessionId: string): string {
  const url = resolveRelayBaseUrl(relayBaseUrl, "ws");

  url.searchParams.set("sessionId", sessionId);
  url.searchParams.set("role", "upstream");
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
    return new Error(`${prefix}（HTTP ${response.status}）`);
  }

  try {
    const parsed = JSON.parse(raw) as {
      errorCode?: string;
      detail?: string;
    };

    if (parsed.detail) {
      return new Error(`${prefix}：${parsed.detail}`);
    }
  } catch {
    // 这里退回可读文本错误。
  }

  return new Error(`${prefix}：${raw.trim()}`);
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
  buildRelayWebSocketUrl,
  buildControlHttpUrl
};

function normalizeRequiredText(value: string | null | undefined): string | null {
  const normalized = value?.trim() ?? "";
  return normalized.length > 0 ? normalized : null;
}
