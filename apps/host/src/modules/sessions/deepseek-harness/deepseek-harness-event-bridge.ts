import {
  createDeepSeekHarnessStreamMessageMapper,
  getHarnessEntrySequence,
  isHarnessAssistantChunk,
  type DeepSeekHarnessStreamMessageMapper,
  type NormalizedMessage
} from "@codingns/session-sync-core";

import { HOST_TASK_TYPES } from "../../tasks/task-types.js";
import type { TaskManager } from "../../tasks/task-manager.js";
import { DeepSeekHarnessApiClient } from "./deepseek-harness-api-client.js";
import { parseHarnessDownlink, type HarnessServerRequest } from "./deepseek-harness-protocol.js";

export type DeepSeekHarnessBridgeEvent =
  | { type: "message"; sessionId: string; message: NormalizedMessage; sequence: number; rpcId: string }
  | { type: "status"; sessionId: string; running: boolean; rpcId: string }
  | { type: "approval"; sessionId: string; rpcId: string; payload: unknown }
  | { type: "question"; sessionId: string; rpcId: string; payload: unknown }
  | { type: "queue"; sessionId: string; rpcId: string; payload: unknown }
  | { type: "error"; sessionId: string | null; rpcId: string; detail: string };

const STREAM_EMIT_INTERVAL_MS = 32;

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
  private readonly streamMappers = new Map<string, DeepSeekHarnessStreamMessageMapper>();
  private readonly pendingStreamMessages = new Map<string, Map<string, DeepSeekHarnessBridgeEvent>>();
  private readonly streamFlushTimers = new Map<string, ReturnType<typeof setTimeout>>();
  private started = false;
  private startPromise: Promise<void> | null = null;
  private reconnecting = false;
  private disposed = false;

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

  async watch(sessionId: string, listener: (event: DeepSeekHarnessBridgeEvent) => void): Promise<{ close(): void }> {
    if (this.disposed) throw new Error("HARNESS_EVENT_BRIDGE_CLOSED");
    const set = this.listeners.get(sessionId) ?? new Set();
    set.add(listener);
    this.listeners.set(sessionId, set);
    try {
      await this.start();
    } catch (error) {
      set.delete(listener);
      if (set.size === 0) this.listeners.delete(sessionId);
      throw error;
    }
    return {
      close: () => {
        set.delete(listener);
        if (set.size !== 0) return;
        this.listeners.delete(sessionId);
        this.clearSessionStreamState(sessionId);
      }
    };
  }

  setCursor(sessionId: string, sequence: number): void {
    const current = this.cursors.get(sessionId) ?? -1;
    if (sequence > current) this.cursors.set(sessionId, sequence);
  }

  async close(): Promise<void> {
    this.disposed = true;
    for (const close of this.closeFns.splice(0)) close();
    for (const timer of this.streamFlushTimers.values()) clearTimeout(timer);
    this.streamFlushTimers.clear();
    this.pendingStreamMessages.clear();
    this.streamMappers.clear();
    this.started = false;
  }

  private async start(): Promise<void> {
    if (this.started) return;
    if (this.startPromise) return this.startPromise;
    this.startPromise = this.openSubscriptions();
    try {
      await this.startPromise;
      this.started = true;
    } finally {
      this.startPromise = null;
    }
  }

  private async openSubscriptions(): Promise<void> {
    const onClose = () => {
      if (this.disposed) return;
      this.started = false;
      const task = this.options.taskManager.enqueue(
        HOST_TASK_TYPES.harnessSessionReconcile,
        { key: "deepseek-harness", input: {}, source: "harness-event-bridge" }
      );
      void task.promise.catch(() => undefined);
    };
    const muxClose = await this.options.client.subscribe("/api/events.mux", (envelope) => this.handleEnvelope(envelope), undefined, onClose);
    try {
      const hostClose = await this.options.client.subscribe("/api/events.host", (envelope) => this.handleEnvelope(envelope), undefined, onClose);
      this.closeFns.push(muxClose, hostClose);
    } catch (error) {
      muxClose();
      throw error;
    }
  }

  private async reconcile(): Promise<void> {
    if (this.reconnecting) return;
    this.reconnecting = true;
    try {
      for (const [sessionId, sequence] of this.cursors) {
        const response = await this.options.client.readHistory(sessionId, undefined, 200);
        let fallbackSequence = sequence;
        for (const entry of response.events ?? []) {
          fallbackSequence += 1;
          this.processSessionEntry(sessionId, entry, fallbackSequence, "history-reconcile");
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
      this.processSessionEntry(sessionId, payload.event, (this.cursors.get(sessionId) ?? -1) + 1, envelope.rpcId);
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

  private processSessionEntry(sessionId: string, entry: unknown, fallbackSequence: number, rpcId: string): void {
    const sequence = getHarnessEntrySequence(entry, fallbackSequence);
    if (sequence <= (this.cursors.get(sessionId) ?? -1)) return;
    this.cursors.set(sessionId, sequence);

    const messages = this.getStreamMapper(sessionId).map(entry, sequence);
    if (isHarnessAssistantChunk(entry)) {
      this.queueStreamingMessages(sessionId, messages, rpcId);
      return;
    }

    this.flushPendingStreamMessages(sessionId);
    for (const message of messages) {
      this.emit(sessionId, { type: "message", sessionId, message, sequence: message.sequence, rpcId });
    }
  }

  private getStreamMapper(sessionId: string): DeepSeekHarnessStreamMessageMapper {
    const existing = this.streamMappers.get(sessionId);
    if (existing) return existing;

    const mapper = createDeepSeekHarnessStreamMessageMapper(
      sessionId,
      this.options.rawStoreRefForSession?.(sessionId) ?? `harness://${sessionId}`
    );
    this.streamMappers.set(sessionId, mapper);
    return mapper;
  }

  /** Harness 可按 token 推送，按帧合并后再发给 Host，避免运行时队列被数百个 SQLite 写入塞满。 */
  private queueStreamingMessages(sessionId: string, messages: NormalizedMessage[], rpcId: string): void {
    if (messages.length === 0) return;

    const pending = this.pendingStreamMessages.get(sessionId) ?? new Map<string, DeepSeekHarnessBridgeEvent>();
    this.pendingStreamMessages.set(sessionId, pending);
    for (const message of messages) {
      pending.set(message.messageId, { type: "message", sessionId, message, sequence: message.sequence, rpcId });
    }

    if (this.streamFlushTimers.has(sessionId)) return;
    const timer = setTimeout(() => {
      this.streamFlushTimers.delete(sessionId);
      this.flushPendingStreamMessages(sessionId);
    }, STREAM_EMIT_INTERVAL_MS);
    this.streamFlushTimers.set(sessionId, timer);
  }

  private flushPendingStreamMessages(sessionId: string): void {
    const timer = this.streamFlushTimers.get(sessionId);
    if (timer) clearTimeout(timer);
    this.streamFlushTimers.delete(sessionId);

    const pending = this.pendingStreamMessages.get(sessionId);
    this.pendingStreamMessages.delete(sessionId);
    if (!pending) return;

    for (const event of pending.values()) this.emit(sessionId, event);
  }

  private clearSessionStreamState(sessionId: string): void {
    const timer = this.streamFlushTimers.get(sessionId);
    if (timer) clearTimeout(timer);
    this.streamFlushTimers.delete(sessionId);
    this.pendingStreamMessages.delete(sessionId);
    this.streamMappers.delete(sessionId);
  }

  private emit(sessionId: string, event: DeepSeekHarnessBridgeEvent): void {
    for (const listener of this.listeners.get(sessionId) ?? []) listener(event);
  }
}

function asRecord(value: unknown): Record<string, any> { return value && typeof value === "object" && !Array.isArray(value) ? value as Record<string, any> : {}; }
