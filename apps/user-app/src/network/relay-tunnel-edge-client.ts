import {
  RelayTunnelClientSession,
  type RelayTunnelRawChannel
} from "./relay-tunnel-client-session";
import { clientConfigStore } from "../config/client-config-store";

export interface RelayTunnelBindingView {
  bindingId: string;
  tunnelDomain: string;
  hostPublicKey: string;
  hostFingerprint: string;
  relayBaseUrl: string;
  controlBaseUrl: string;
  status: "active" | "disabled";
}

export interface RelayTunnelSessionReservation {
  sessionId: string;
  bindingId: string;
  tunnelDomain: string;
  remainingBytes: string;
  accountId?: string;
  sessionRateLimitBytesPerSecond?: string | null;
  upstreamConnected: boolean;
  downstreamConnected: boolean;
  expiresAt?: string;
}

export interface RelayTunnelConnectInitResponse {
  bindingId: string;
  tunnelDomain: string;
  relayBaseUrl: string;
  controlBaseUrl: string;
  hostPublicKey: string;
  hostFingerprint: string;
  status: "active" | "disabled";
  sessionId: string;
  connectTicket: string;
  remainingBytes: string;
  sessionRateLimitBytesPerSecond: string | null;
  upstreamConnected: boolean;
  downstreamConnected: boolean;
  expiresAt: string;
}

interface RelayTunnelEdgeSocket {
  readonly readyState: number;
  send(data: string): void;
  close(code?: number, reason?: string): void;
  addEventListener(
    type: string,
    listener: EventListenerOrEventListenerObject | null,
    options?: boolean | AddEventListenerOptions
  ): void;
  removeEventListener(
    type: string,
    listener: EventListenerOrEventListenerObject | null,
    options?: boolean | EventListenerOptions
  ): void;
}

interface RelayTunnelEdgeClientDependencies {
  fetchFn?: typeof fetch;
  createWebSocket?: (url: string) => RelayTunnelEdgeSocket;
}

export async function connectInitRelayTunnel(input: {
  controlBaseUrl: string;
  tunnelDomain: string;
  fetchFn?: typeof fetch;
}): Promise<RelayTunnelConnectInitResponse> {
  const fetchFn = input.fetchFn ?? fetch;
  const requestUrl = new URL(
    `/api/v1/tunnels/${encodeURIComponent(normalizeTunnelDomain(input.tunnelDomain))}/connect-init`,
    ensureTrailingSlash(input.controlBaseUrl)
  ).toString();
  const response = await fetchFn(requestUrl, {
    method: "POST",
    headers: {
      "content-type": "application/json"
    },
    body: JSON.stringify({
      clientContext: collectRelayClientContext()
    })
  });

  if (!response.ok) {
    throw await buildRelayTunnelHttpError(response, "初始化隧道连接失败");
  }

  return await response.json() as RelayTunnelConnectInitResponse;
}

export async function connectRelayTunnelRawChannel(
  input: {
    controlBaseUrl: string;
    tunnelDomain: string;
  },
  dependencies: RelayTunnelEdgeClientDependencies = {}
): Promise<{
  binding: RelayTunnelBindingView;
  reservation: RelayTunnelSessionReservation;
  channel: RelayTunnelRawChannel;
}> {
  const connectInit = await connectInitRelayTunnel({
    controlBaseUrl: input.controlBaseUrl,
    tunnelDomain: input.tunnelDomain,
    fetchFn: dependencies.fetchFn
  });
  const binding: RelayTunnelBindingView = {
    bindingId: connectInit.bindingId,
    tunnelDomain: connectInit.tunnelDomain,
    hostPublicKey: connectInit.hostPublicKey,
    hostFingerprint: connectInit.hostFingerprint,
    relayBaseUrl: connectInit.relayBaseUrl,
    controlBaseUrl: connectInit.controlBaseUrl,
    status: connectInit.status
  };
  const reservation: RelayTunnelSessionReservation = {
    sessionId: connectInit.sessionId,
    bindingId: connectInit.bindingId,
    tunnelDomain: connectInit.tunnelDomain,
    remainingBytes: connectInit.remainingBytes,
    sessionRateLimitBytesPerSecond: connectInit.sessionRateLimitBytesPerSecond,
    upstreamConnected: connectInit.upstreamConnected,
    downstreamConnected: connectInit.downstreamConnected,
    expiresAt: connectInit.expiresAt
  };
  const socketFactory = dependencies.createWebSocket ?? defaultCreateWebSocket;
  const socket = socketFactory(
    buildRelayEdgeWebSocketUrl(binding.relayBaseUrl, reservation.sessionId, connectInit.connectTicket)
  );
  await waitForSocketOpen(socket);

  return {
    binding,
    reservation,
    channel: new RelayTunnelEdgeRawChannel(socket)
  };
}

export async function connectRelayTunnelClientSessionViaEdge(
  input: {
    controlBaseUrl: string;
    tunnelDomain: string;
    onWireBytes?: (direction: "upstream" | "downstream", bytes: number) => void;
  },
  dependencies: RelayTunnelEdgeClientDependencies = {}
): Promise<{
  binding: RelayTunnelBindingView;
  reservation: RelayTunnelSessionReservation;
  channel: RelayTunnelRawChannel;
  clientSession: RelayTunnelClientSession;
}> {
  const { binding, reservation, channel } = await connectRelayTunnelRawChannel(input, dependencies);
  const clientSession = new RelayTunnelClientSession(channel, {
    expectedHostPublicKey: binding.hostPublicKey,
    expectedHostFingerprint: binding.hostFingerprint,
    onWireBytes: input.onWireBytes
  });
  await clientSession.connect();

  return {
    binding,
    reservation,
    channel,
    clientSession
  };
}

class RelayTunnelEdgeRawChannel implements RelayTunnelRawChannel {
  constructor(private readonly socket: RelayTunnelEdgeSocket) {}

  send(payload: string): void {
    if (this.socket.readyState !== 1) {
      throw new Error("当前 relay-edge 原始链路尚未建立完成");
    }

    this.socket.send(payload);
  }

  subscribe(listener: (payload: string) => void): () => void {
    const handler = (event: Event) => {
      const messageEvent = event as MessageEvent<unknown>;

      if (typeof messageEvent.data === "string") {
        listener(messageEvent.data);
      }
    };

    this.socket.addEventListener("message", handler);

    return () => {
      this.socket.removeEventListener("message", handler);
    };
  }

  close(code?: number, reason?: string): void {
    this.socket.close(code, reason);
  }
}

function buildRelayEdgeWebSocketUrl(
  relayBaseUrl: string,
  sessionId: string,
  connectTicket: string
): string {
  const url = resolveRelayBaseUrl(relayBaseUrl, "ws");

  url.searchParams.set("sessionId", sessionId);
  url.searchParams.set("role", "downstream");
  url.searchParams.set("connectTicket", connectTicket);
  url.protocol = url.protocol === "https:" || url.protocol === "wss:" ? "wss:" : "ws:";

  return url.toString();
}

async function waitForSocketOpen(socket: RelayTunnelEdgeSocket): Promise<void> {
  if (socket.readyState === 1) {
    return;
  }

  await new Promise<void>((resolve, reject) => {
    const handleOpen = () => {
      cleanup();
      resolve();
    };
    const handleClose = (event: Event) => {
      cleanup();
      const closeEvent = event as CloseEvent;
      reject(
        new Error(
          `relay-edge 原始链路关闭：${closeEvent.code}${closeEvent.reason ? ` ${closeEvent.reason}` : ""}`
        )
      );
    };
    const handleError = () => {
      cleanup();
      reject(new Error("relay-edge 原始链路建立失败"));
    };
    const cleanup = () => {
      socket.removeEventListener("open", handleOpen);
      socket.removeEventListener("close", handleClose);
      socket.removeEventListener("error", handleError);
    };

    socket.addEventListener("open", handleOpen);
    socket.addEventListener("close", handleClose);
    socket.addEventListener("error", handleError);
  });
}

async function buildRelayTunnelHttpError(response: Response, prefix: string): Promise<Error> {
  const raw = await response.text();
  const detail = raw.trim();

  if (!detail) {
    return new Error(`${prefix}（HTTP ${response.status}）`);
  }

  try {
    const parsed = JSON.parse(detail) as {
      errorCode?: string;
      detail?: string;
    };

    if (typeof parsed.detail === "string" && typeof parsed.errorCode === "string") {
      return new Error(`${parsed.errorCode}: ${parsed.detail}`);
    }
  } catch {
    // ignore
  }

  return new Error(`${prefix}：${detail}`);
}

function normalizeTunnelDomain(value: string): string {
  const normalized = value.trim().toLowerCase();

  if (!normalized) {
    throw new Error("tunnelDomain 不能为空");
  }

  return normalized;
}

function ensureTrailingSlash(baseUrl: string): string {
  return baseUrl.endsWith("/") ? baseUrl : `${baseUrl}/`;
}

function collectRelayClientContext(): {
  runtimePlatform: string | null;
  systemPlatform: string | null;
  userAgent: string | null;
  language: string | null;
  timezone: string | null;
} {
  const runtimePlatform = clientConfigStore.getState().platform ?? null;
  const userAgent = typeof navigator === "undefined" ? null : normalizeNullableText(navigator.userAgent);
  const systemPlatform = typeof navigator === "undefined" ? null : normalizeNullableText(navigator.platform);
  const language = typeof navigator === "undefined" ? null : normalizeNullableText(navigator.language);
  const timezone = resolveBrowserTimeZone();

  return {
    runtimePlatform,
    systemPlatform,
    userAgent,
    language,
    timezone
  };
}

function resolveBrowserTimeZone(): string | null {
  try {
    return normalizeNullableText(Intl.DateTimeFormat().resolvedOptions().timeZone);
  } catch {
    return null;
  }
}

function resolveRelayBaseUrl(baseUrl: string, pathname: string): URL {
  return new URL(pathname.replace(/^\/+/, ""), ensureTrailingSlash(baseUrl));
}

function defaultCreateWebSocket(url: string): RelayTunnelEdgeSocket {
  return new WebSocket(url);
}

function normalizeNullableText(value: string | null | undefined): string | null {
  const normalized = value?.trim();
  return normalized ? normalized : null;
}
