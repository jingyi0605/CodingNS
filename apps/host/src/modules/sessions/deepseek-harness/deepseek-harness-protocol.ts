import { randomUUID } from "node:crypto";

/** Harness 0.1.0-rc.5 使用的 JSON-RPC 信封。这里不复用 Harness 源码类型，避免外部包污染 Host。 */
export interface HarnessClientRequest {
  type: "client-request";
  rpcId: string;
  method: string;
  payload: unknown;
}

export interface HarnessServerResponse {
  type: "server-response";
  rpcId: string;
  result: HarnessRpcResult<unknown>;
}

export interface HarnessServerRequest {
  type: "server-request";
  rpcId: string;
  method: string;
  payload: unknown;
}

export interface HarnessClientResponse {
  type: "client-response";
  rpcId: string;
  result: HarnessRpcResult<unknown>;
}

export type HarnessRpcResult<T> =
  | { ok: true; value: T }
  | { ok: false; error: HarnessRpcError };

export interface HarnessRpcError {
  code: string;
  message: string;
  details?: unknown;
}

export type HarnessDownlinkEnvelope = HarnessServerRequest;

export interface HarnessSessionSummary {
  sessionId: string;
  cwd?: string;
  title?: string;
  updatedAt?: number | string;
  createdAt?: number | string;
  messageCount?: number;
  running?: boolean;
}

export interface HarnessHistoryEntry {
  event: Record<string, unknown>;
  view?: unknown;
}

export interface HarnessHistoryResult {
  events: HarnessHistoryEntry[];
  hasMore?: boolean;
}

export interface HarnessSessionEventFrame {
  type: "session/event";
  sessionId: string;
  event: Record<string, unknown>;
  view?: unknown;
}

export interface HarnessSessionSubscribedFrame {
  type: "session/subscribed";
  sessionId: string;
  lastSeq: number;
}

export interface HarnessHostStatusFrame {
  type: "host/session-status";
  sessionId: string;
  running: boolean;
}

export type HarnessMuxFrame =
  | HarnessSessionEventFrame
  | HarnessSessionSubscribedFrame
  | { type: "approval/requested"; sessionId: string; approvalId: string; toolName: string; callId?: string; reason?: string }
  | { type: "approval/resolved"; sessionId: string; approvalId: string; outcome: unknown }
  | { type: "question/requested"; sessionId: string; questions: unknown[] }
  | { type: "question/resolved"; sessionId: string; questionRpcId: string; outcome: string }
  | { type: "session/queue"; sessionId: string; items: unknown[] }
  | { type: "stream/error"; error: HarnessRpcError };

export type HarnessHostFrame =
  | HarnessHostStatusFrame
  | { type: "host/session-added"; sessionId: string; blank?: boolean; cwd?: string; parentSessionId?: string }
  | { type: "host/session-removed"; sessionId: string }
  | { type: "host/agent-error"; sessionId: string; message: string }
  | { type: "stream/error"; error: HarnessRpcError };

export function createHarnessRpcId(): string {
  return randomUUID();
}

export function createClientRequest(method: string, payload: unknown, rpcId = createHarnessRpcId()): HarnessClientRequest {
  if (!method.trim()) {
    throw new Error("HARNESS_RPC_METHOD_REQUIRED");
  }

  return { type: "client-request", rpcId, method, payload };
}

export function createClientResponse(rpcId: string, result: HarnessRpcResult<unknown>): HarnessClientResponse {
  if (!rpcId.trim()) {
    throw new Error("HARNESS_RPC_ID_REQUIRED");
  }

  return { type: "client-response", rpcId, result };
}

export function parseHarnessServerResponse(value: unknown, expectedRpcId: string): HarnessServerResponse {
  if (!isRecord(value) || value.type !== "server-response" || value.rpcId !== expectedRpcId) {
    throw new Error("HARNESS_RPC_PROTOCOL_ERROR");
  }

  if (!isHarnessRpcResult(value.result)) {
    throw new Error("HARNESS_RPC_PROTOCOL_ERROR");
  }

  return value as unknown as HarnessServerResponse;
}

export function parseHarnessDownlink(value: unknown): HarnessDownlinkEnvelope | null {
  if (!isRecord(value) || value.type !== "server-request" || typeof value.rpcId !== "string" || typeof value.method !== "string") {
    return null;
  }

  return value as unknown as HarnessDownlinkEnvelope;
}

function isHarnessRpcResult(value: unknown): value is HarnessRpcResult<unknown> {
  if (!isRecord(value) || typeof value.ok !== "boolean") {
    return false;
  }

  if (value.ok) {
    return "value" in value;
  }

  return isRecord(value.error) && typeof value.error.code === "string" && typeof value.error.message === "string";
}

function isRecord(value: unknown): value is Record<string, any> {
  return Boolean(value) && typeof value === "object" && !Array.isArray(value);
}
