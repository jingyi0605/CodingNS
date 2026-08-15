import { nextTimestamp } from "../providers/utils.js";
import type { ProviderId, ProviderSubscription } from "../types.js";
import type {
  ActiveRunHandle,
  ActiveRunSnapshot,
  RegisterActiveRunInput,
  RuntimeEvent,
  RuntimeEventInput,
  RuntimeInterruptSource,
  RuntimeEventListener,
  RuntimeRunState,
  RuntimeSessionBinding
} from "./types.js";

interface ActiveRunRecord {
  sessionId: string;
  workspaceId: string;
  provider: ProviderId;
  providerSessionId: string | null;
  rawStoreRef: string | null;
  runningState: RuntimeRunState;
  attachedClients: number;
  startedAt: string;
  lastEventAt: string | null;
  completedAt: string | null;
  detail: string | null;
  interruptSource: RuntimeInterruptSource | null;
  errorCode: string | null;
  supportsInterrupt: boolean;
  interruptHandler: (() => Promise<void>) | null;
  inRunInputHandler: ((options: import("./types.js").RuntimeSendOptions) => Promise<void>) | null;
  livenessProbe: (() => boolean) | null;
  recentEvents: RuntimeEvent[];
  disposed: boolean;
}

interface AttachedRuntimeListener {
  listener: RuntimeEventListener;
  queue: Promise<void>;
  closed: boolean;
}

const ACTIVE_RUN_RECENT_EVENT_LIMIT = 200;

export class ActiveRunRegistry {
  private readonly records = new Map<string, ActiveRunRecord>();
  private readonly sessionListeners = new Map<string, Set<AttachedRuntimeListener>>();

  register(input: RegisterActiveRunInput): ActiveRunHandle {
    if (this.records.has(input.sessionId)) {
      throw new Error("ACTIVE_RUN_EXISTS");
    }

    const record: ActiveRunRecord = {
      sessionId: input.sessionId,
      workspaceId: input.workspaceId,
      provider: input.provider,
      providerSessionId: input.providerSessionId,
      rawStoreRef: input.rawStoreRef,
      runningState: "starting",
      attachedClients: this.countOpenListeners(input.sessionId),
      startedAt: input.startedAt ?? nextTimestamp(),
      lastEventAt: null,
      completedAt: null,
      detail: null,
      interruptSource: null,
      errorCode: null,
      supportsInterrupt: input.supportsInterrupt ?? false,
      interruptHandler: null,
      inRunInputHandler: null,
      livenessProbe: null,
      recentEvents: [],
      disposed: false
    };

    this.records.set(record.sessionId, record);
    return this.buildHandle(record);
  }

  has(sessionId: string): boolean {
    return this.records.has(sessionId);
  }

  getSnapshot(sessionId: string): ActiveRunSnapshot | null {
    const record = this.records.get(sessionId);
    return record ? this.toSnapshot(record) : null;
  }

  listSnapshots(): ActiveRunSnapshot[] {
    return [...this.records.values()]
      .filter((record) => !record.disposed)
      .map((record) => this.toSnapshot(record));
  }

  attach(sessionId: string, listener: RuntimeEventListener): ProviderSubscription {
    const attachedListener: AttachedRuntimeListener = {
      listener,
      queue: Promise.resolve(),
      closed: false
    };
    const listeners = this.getOrCreateSessionListeners(sessionId);
    listeners.add(attachedListener);

    const record = this.records.get(sessionId);

    if (record && !record.disposed) {
      record.attachedClients += 1;

      for (const event of record.recentEvents) {
        this.enqueueListenerEvent(record, attachedListener, event);
      }
    }

    let closed = false;

    return {
      close: () => {
        if (closed) {
          return;
        }

        closed = true;
        attachedListener.closed = true;

        if (listeners.delete(attachedListener)) {
          if (listeners.size === 0) {
            this.sessionListeners.delete(sessionId);
          }

          const activeRecord = this.records.get(sessionId);

          if (activeRecord && !activeRecord.disposed) {
            activeRecord.attachedClients = Math.max(0, activeRecord.attachedClients - 1);
          }
        }
      }
    };
  }

  async disposeAll(): Promise<void> {
    const sessionIds = [...this.records.keys()];

    for (const sessionId of sessionIds) {
      await this.dispose(sessionId);
    }
  }

  async flushListeners(sessionId: string): Promise<void> {
    const listeners = this.sessionListeners.get(sessionId);

    if (!listeners || listeners.size === 0) {
      return;
    }

    await Promise.all([...listeners].map((listener) => listener.queue));
  }

  private buildHandle(record: ActiveRunRecord): ActiveRunHandle {
    return {
      sessionId: record.sessionId,
      workspaceId: record.workspaceId,
      provider: record.provider,
      getSnapshot: () => this.toSnapshot(record),
      updateSessionBinding: (binding) => {
        this.updateSessionBinding(record.sessionId, binding);
      },
      setInterruptHandler: (interrupt) => {
        record.interruptHandler = interrupt;
        record.supportsInterrupt = typeof interrupt === "function";
      },
      setInRunInputHandler: (submitDuringRun) => {
        record.inRunInputHandler = submitDuringRun;
      },
      setLivenessProbe: (probe) => {
        record.livenessProbe = probe;
      },
      emit: (event) => this.emit(record.sessionId, event),
      attach: (listener) => this.attach(record.sessionId, listener),
      isHealthy: () => {
        if (!record.livenessProbe) {
          return null;
        }

        return record.livenessProbe();
      },
      interrupt: async () => {
        if (!record.interruptHandler) {
          throw new Error("INTERRUPT_NOT_SUPPORTED");
        }

        await record.interruptHandler();
      },
      submitDuringRun: async (options) => {
        if (!record.inRunInputHandler) {
          throw new Error("IN_RUN_INPUT_NOT_SUPPORTED");
        }

        await record.inRunInputHandler(options);
      },
      dispose: () => this.dispose(record.sessionId)
    };
  }

  private updateSessionBinding(sessionId: string, binding: RuntimeSessionBinding): void {
    const record = this.getRecordOrThrow(sessionId);
    record.providerSessionId = binding.providerSessionId;
    record.rawStoreRef = binding.rawStoreRef;
  }

  private async emit(sessionId: string, input: RuntimeEventInput): Promise<RuntimeEvent> {
    const record = this.getRecordOrThrow(sessionId);
    const timestamp = input.timestamp ?? nextTimestamp();
    const detail = input.detail ?? null;
    const interruptSource = normalizeInterruptSource(input.type, input.interruptSource);
    const providerSessionId =
      input.providerSessionId === undefined ? record.providerSessionId : input.providerSessionId;
    const rawStoreRef =
      input.rawStoreRef === undefined ? record.rawStoreRef : input.rawStoreRef;

    record.providerSessionId = providerSessionId;
    record.rawStoreRef = rawStoreRef;
    record.detail = detail;
    record.interruptSource = interruptSource;
    record.errorCode = input.type === "error" ? normalizeErrorCode(input.errorCode) : null;

    const event = this.toRuntimeEvent(record, input, timestamp, detail, interruptSource);
    this.applyEventState(record, event);
    this.rememberRecentEvent(record, event);

    for (const listener of this.sessionListeners.get(record.sessionId) ?? []) {
      this.enqueueListenerEvent(record, listener, event);
    }

    return event;
  }

  private applyEventState(record: ActiveRunRecord, event: RuntimeEvent): void {
    if (event.type === "message") {
      record.lastEventAt = event.message.timestamp;

      if (
        record.runningState === "starting" ||
        record.runningState === "completed" ||
        record.runningState === "interrupted" ||
        record.runningState === "failed"
      ) {
        record.runningState = "running";
        record.completedAt = null;
        record.detail = null;
        record.interruptSource = null;
        record.errorCode = null;
      }

      return;
    }

    record.lastEventAt = event.timestamp;
    record.detail = event.detail;
    record.interruptSource =
      record.runningState === "interrupted" && record.interruptSource === "user" && event.status === "interrupted"
        ? "user"
        : event.interruptSource;
    record.runningState = event.status;
    record.errorCode = event.type === "error" ? event.errorCode : null;

    if (
      event.status === "completed" ||
      event.status === "interrupted" ||
      event.status === "failed"
    ) {
      record.completedAt = event.timestamp;
    }
  }

  private toRuntimeEvent(
    record: ActiveRunRecord,
    input: RuntimeEventInput,
    timestamp: string,
    detail: string | null,
    interruptSource: RuntimeInterruptSource | null
  ): RuntimeEvent {
    if (input.type === "message") {
      if (!input.message) {
        throw new Error("RUNTIME_MESSAGE_REQUIRED");
      }

      return {
        type: "message",
        sessionId: record.sessionId,
        provider: record.provider,
        providerSessionId: input.providerSessionId ?? record.providerSessionId,
        rawStoreRef: input.rawStoreRef ?? record.rawStoreRef,
        message: input.message,
        status: null,
        detail,
        interruptSource,
        errorCode: null,
        rawEventRef: input.rawEventRef ?? null,
        timestamp
      };
    }

    const status = normalizeRuntimeStatus(input.type, input.status);
    const shared = {
      sessionId: record.sessionId,
      provider: record.provider,
      providerSessionId: input.providerSessionId ?? record.providerSessionId,
      rawStoreRef: input.rawStoreRef ?? record.rawStoreRef,
      message: null,
      detail,
      interruptSource,
      rawEventRef: input.rawEventRef ?? null,
      timestamp
    };

    if (input.type === "error") {
      return {
        type: "error",
        ...shared,
        errorCode: normalizeErrorCode(input.errorCode),
        status: "failed"
      };
    }

    return {
      type: input.type,
      ...shared,
      errorCode: null,
      status
    };
  }

  private async dispose(sessionId: string): Promise<void> {
    const record = this.records.get(sessionId);

    if (!record || record.disposed) {
      return;
    }

    record.disposed = true;
    record.recentEvents = [];
    record.attachedClients = 0;
    this.records.delete(sessionId);
  }

  private rememberRecentEvent(record: ActiveRunRecord, event: RuntimeEvent): void {
    record.recentEvents.push(event);

    if (record.recentEvents.length > ACTIVE_RUN_RECENT_EVENT_LIMIT) {
      record.recentEvents.splice(0, record.recentEvents.length - ACTIVE_RUN_RECENT_EVENT_LIMIT);
    }
  }

  private enqueueListenerEvent(
    record: ActiveRunRecord,
    attachedListener: AttachedRuntimeListener,
    event: RuntimeEvent
  ): void {
    attachedListener.queue = attachedListener.queue
      .catch(() => {
        return;
      })
      .then(async () => {
        const listeners = this.sessionListeners.get(record.sessionId);

        if (
          record.disposed
          || attachedListener.closed
          || !listeners
          || !listeners.has(attachedListener)
        ) {
          return;
        }

        await attachedListener.listener(event);
      })
      .catch((error) => {
        const message = error instanceof Error ? error.message : String(error);
        console.warn(`[active-run-registry] listener failed for ${record.sessionId}: ${message}`);
      });
  }

  private getRecordOrThrow(sessionId: string): ActiveRunRecord {
    const record = this.records.get(sessionId);

    if (!record || record.disposed) {
      throw new Error("ACTIVE_RUN_NOT_FOUND");
    }

    return record;
  }

  private getOrCreateSessionListeners(sessionId: string): Set<AttachedRuntimeListener> {
    const existing = this.sessionListeners.get(sessionId);

    if (existing) {
      return existing;
    }

    const created = new Set<AttachedRuntimeListener>();
    this.sessionListeners.set(sessionId, created);
    return created;
  }

  private countOpenListeners(sessionId: string): number {
    const listeners = this.sessionListeners.get(sessionId);

    if (!listeners) {
      return 0;
    }

    let count = 0;

    for (const listener of listeners) {
      if (!listener.closed) {
        count += 1;
      }
    }

    return count;
  }

  private toSnapshot(record: ActiveRunRecord): ActiveRunSnapshot {
    return {
      sessionId: record.sessionId,
      workspaceId: record.workspaceId,
      provider: record.provider,
      providerSessionId: record.providerSessionId,
      rawStoreRef: record.rawStoreRef,
      runningState: record.runningState,
      attachedClients: record.attachedClients,
      startedAt: record.startedAt,
      lastEventAt: record.lastEventAt,
      completedAt: record.completedAt,
      detail: record.detail,
      interruptSource: record.interruptSource,
      errorCode: record.errorCode,
      supportsInterrupt: record.supportsInterrupt
    };
  }
}

function normalizeRuntimeStatus(
  type: RuntimeEvent["type"],
  status: RuntimeEventInput["status"]
): RuntimeRunState {
  if (type === "complete") {
    return "completed";
  }

  if (type === "interrupted") {
    return "interrupted";
  }

  if (type === "error") {
    return "failed";
  }

  return status ?? "running";
}

function normalizeErrorCode(errorCode: string | null | undefined): string {
  const normalized = errorCode?.trim();
  return normalized && normalized.length > 0 ? normalized : "PROVIDER_RUNTIME_ERROR";
}

function normalizeInterruptSource(
  type: RuntimeEvent["type"],
  interruptSource: RuntimeEventInput["interruptSource"]
): RuntimeInterruptSource | null {
  if (type !== "interrupted") {
    return null;
  }

  return interruptSource ?? "runtime";
}
