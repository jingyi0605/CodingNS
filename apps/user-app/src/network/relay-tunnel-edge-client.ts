import {
  RelayTunnelClientSession,
  type RelayTunnelRawChannel
} from "./relay-tunnel-client-session";

export interface RelayTunnelBindingView {
  bindingId: string;
  tunnelDomain: string;
  hostPublicKey: string;
  hostFingerprint: string;
  relayBaseUrl: string;
  controlBaseUrl: string;
  status: "active" | "disabled";
}

export interface RelayTunnelBindingResolveResponse {
  binding: RelayTunnelBindingView;
}

export interface RelayTunnelSessionReservation {
  sessionId: string;
  accountId: string;
  bindingId: string;
  tunnelDomain: string;
  remainingBytes: string;
  upstreamConnected: boolean;
  downstreamConnected: boolean;
}

export interface RelayTunnelSessionReserveResponse {
  reservation: RelayTunnelSessionReservation;
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
  createSessionId?: () => string;
}

export async function resolveRelayTunnelBinding(input: {
  controlBaseUrl: string;
  tunnelDomain: string;
  fetchFn?: typeof fetch;
}): Promise<RelayTunnelBindingView> {
  const fetchFn = input.fetchFn ?? fetch;
  const requestUrl = new URL(
    `/api/v1/tunnels/${encodeURIComponent(normalizeTunnelDomain(input.tunnelDomain))}`,
    ensureTrailingSlash(input.controlBaseUrl)
  ).toString();
  const response = await fetchFn(requestUrl);

  if (!response.ok) {
    throw await buildRelayTunnelHttpError(response, "解析隧道绑定失败");
  }

  const payload = await response.json() as RelayTunnelBindingResolveResponse;
  return payload.binding;
}

export async function reserveRelayTunnelSession(input: {
  relayBaseUrl: string;
  sessionId: string;
  tunnelDomain: string;
  fetchFn?: typeof fetch;
}): Promise<RelayTunnelSessionReservation> {
  const fetchFn = input.fetchFn ?? fetch;
  const requestUrl = new URL("/api/internal/sessions/reserve", ensureTrailingSlash(input.relayBaseUrl)).toString();
  const response = await fetchFn(requestUrl, {
    method: "POST",
    headers: {
      "Content-Type": "application/json"
    },
    body: JSON.stringify({
      sessionId: input.sessionId,
      tunnelDomain: normalizeTunnelDomain(input.tunnelDomain)
    })
  });

  if (!response.ok) {
    throw await buildRelayTunnelHttpError(response, "预留隧道会话失败");
  }

  const payload = await response.json() as RelayTunnelSessionReserveResponse;
  return payload.reservation;
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
  const binding = await resolveRelayTunnelBinding({
    controlBaseUrl: input.controlBaseUrl,
    tunnelDomain: input.tunnelDomain,
    fetchFn: dependencies.fetchFn
  });
  const sessionId = (dependencies.createSessionId ?? defaultCreateSessionId)();
  const reservation = await reserveRelayTunnelSession({
    relayBaseUrl: binding.relayBaseUrl,
    sessionId,
    tunnelDomain: binding.tunnelDomain,
    fetchFn: dependencies.fetchFn
  });
  const socketFactory = dependencies.createWebSocket ?? defaultCreateWebSocket;
  const socket = socketFactory(
    buildRelayEdgeWebSocketUrl(binding.relayBaseUrl, reservation.sessionId, "downstream")
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
    expectedHostFingerprint: binding.hostFingerprint
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
  role: "upstream" | "downstream"
): string {
  const url = new URL("/ws", ensureTrailingSlash(relayBaseUrl));

  url.searchParams.set("sessionId", sessionId);
  url.searchParams.set("role", role);
  url.protocol = url.protocol === "https:" ? "wss:" : "ws:";

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

function defaultCreateWebSocket(url: string): RelayTunnelEdgeSocket {
  return new WebSocket(url);
}

function defaultCreateSessionId(): string {
  return globalThis.crypto.randomUUID();
}
