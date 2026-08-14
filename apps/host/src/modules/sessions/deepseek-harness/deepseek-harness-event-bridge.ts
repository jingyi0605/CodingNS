import { mapHarnessEntry } from "@codingns/session-sync-core";

import { HOST_TASK_TYPES } from "../../tasks/task-types.js";
import type { TaskManager } from "../../tasks/task-manager.js";
import { DeepSeekHarnessApiClient } from "./deepseek-harness-api-client.js";
import { parseHarnessDownlink, type HarnessServerRequest } from "./deepseek-harness-protocol.js";

export type DeepSeekHarnessBridgeEvent =
  | { type: "message"; sessionId: string; message: ReturnType<typeof mapHarnessEntry>; sequence: number; rpcId: string }
  | { type: "status"; sessionId: string; running: boolean; rpcId: string }
  | { type: "approval"; sessionId: string; rpcId: string; payload: unknown }
  | { type: "question"; sessionId: string; rpcId: string; payload: unknown }
  | { type: "queue"; sessionId: string; rpcId: string; payload: unknown }
  | { type: "error"; sessionId: string | null; rpcId: string; detail: string };

export interface DeepSeekHarnessEventBridgeOptions {
  taskManager: TaskManager;
  client: DeepSeekHarnessApiClient;
  rawStoreRefForSession?: (sessionId: string) => string;
}

/** 一个 sidecar 只维护一条 mux 和一条 host 订阅，断线先补 history 再重连。 */
export class DeepSeekHarnessEventBridge {
  private readonly listeners = new Map<string, Set<(event: DeepSeekHarnessBridgeEvent) => void>>();
  private readonly cursors = new Map<string, number>();
  private readonly closeFns: Array<() => void> = [];
  private started = false;
  private reconnecting = false;

  constructor(private readonly options: DeepSeekHarnessEventBridgeOptions) {
    options.taskManager.register({
      taskType: HOST_TASK_TYPES.harnessSessionReconcile,
      executionLane: "host_background",
      concurrency: 1,
      timeoutMs: 20_000,
      retryPolicy: { maxAttempts: 2, backoffMs: 500 },
      run: async () => this.reconcile()
    });
  }

  watch(sessionId: string, listener: (event: DeepSeekHarnessBridgeEvent) => void): { close(): void } {
    const set = this.listeners.get(sessionId) ?? new Set();
    set.add(listener);
    this.listeners.set(sessionId, set);
    void this.start();
    return { close: () => { set.delete(listener); if (set.size === 0) this.listeners.delete(sessionId); } };
  }

  setCursor(sessionId: string, sequence: number): void {
    const current = this.cursors.get(sessionId) ?? -1;
    if (sequence > current) this.cursors.set(sessionId, sequence);
  }

  async close(): Promise<void> {
    for (const close of this.closeFns.splice(0)) close();
    this.started = false;
  }

  private async start(): Promise<void> {
    if (this.started) return;
    this.started = true;
    const onClose = () => {
      this.started = false;
      this.options.taskManager.enqueue(HOST_TASK_TYPES.harnessSessionReconcile, { key: "deepseek-harness", input: {}, source: "harness-event-bridge" });
    };
    const muxClose = await this.options.client.subscribe("/api/events.mux", (envelope) => this.handleEnvelope(envelope), undefined, onClose);
    const hostClose = await this.options.client.subscribe("/api/events.host", (envelope) => this.handleEnvelope(envelope), undefined, onClose);
    this.closeFns.push(muxClose, hostClose);
  }

  private async reconcile(): Promise<void> {
    if (this.reconnecting) return;
    this.reconnecting = true;
    try {
      for (const [sessionId, sequence] of this.cursors) {
        const response = await this.options.client.readHistory(sessionId, undefined, 200);
        for (const entry of response.events ?? []) {
          const mapped = mapHarnessEntry(sessionId, this.options.rawStoreRefForSession?.(sessionId) ?? `harness://${sessionId}`, entry, sequence + 1);
          if (!mapped || mapped.sequence <= (this.cursors.get(sessionId) ?? -1)) continue;
          this.cursors.set(sessionId, mapped.sequence);
          this.emit(sessionId, { type: "message", sessionId, message: mapped, sequence: mapped.sequence, rpcId: "history-reconcile" });
        }
      }
      await this.start();
    } finally {
      this.reconnecting = false;
    }
  }

  private handleEnvelope(raw: HarnessServerRequest): void {
    const envelope = parseHarnessDownlink(raw);
    if (!envelope) return;
    const payload = asRecord(envelope.payload);
    const sessionId = typeof payload.sessionId === "string" ? payload.sessionId : null;
    if (payload.type === "session/event" && sessionId) {
      const mapped = mapHarnessEntry(sessionId, this.options.rawStoreRefForSession?.(sessionId) ?? `harness://${sessionId}`, payload.event, 0);
      if (!mapped || mapped.sequence <= (this.cursors.get(sessionId) ?? -1)) return;
      this.cursors.set(sessionId, mapped.sequence);
      this.emit(sessionId, { type: "message", sessionId, message: mapped, sequence: mapped.sequence, rpcId: envelope.rpcId });
      return;
    }
    if (payload.type === "host/session-status" && sessionId) {
      this.emit(sessionId, { type: "status", sessionId, running: payload.running === true, rpcId: envelope.rpcId });
      return;
    }
    if (sessionId && typeof payload.type === "string" && ["approval/requested", "approval/resolved"].includes(payload.type)) {
      this.emit(sessionId, { type: "approval", sessionId, rpcId: envelope.rpcId, payload });
      return;
    }
    if (sessionId && typeof payload.type === "string" && ["question/requested", "question/resolved"].includes(payload.type)) {
      this.emit(sessionId, { type: "question", sessionId, rpcId: envelope.rpcId, payload });
      return;
    }
    if (sessionId && payload.type === "session/queue") {
      this.emit(sessionId, { type: "queue", sessionId, rpcId: envelope.rpcId, payload });
    }
  }

  private emit(sessionId: string, event: DeepSeekHarnessBridgeEvent): void {
    for (const listener of this.listeners.get(sessionId) ?? []) listener(event);
  }
}

function asRecord(value: unknown): Record<string, any> { return value && typeof value === "object" && !Array.isArray(value) ? value as Record<string, any> : {}; }
