import { nextTimestamp } from "../providers/utils.js";
import type { ProviderId, ProviderSubscription } from "../types.js";
import type {
  ActiveRunHandle,
  ActiveRunSnapshot,
  RegisterActiveRunInput,
  RuntimeEvent,
  RuntimeEventInput,
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
  errorCode: string | null;
  supportsInterrupt: boolean;
  interruptHandler: (() => Promise<void>) | null;
  inRunInputHandler: ((options: import("./types.js").RuntimeSendOptions) => Promise<void>) | null;
  listeners: Set<RuntimeEventListener>;
  disposed: boolean;
}

export class ActiveRunRegistry {
  private readonly records = new Map<string, ActiveRunRecord>();

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
      attachedClients: 0,
      startedAt: input.startedAt ?? nextTimestamp(),
      lastEventAt: null,
      completedAt: null,
      detail: null,
      errorCode: null,
      supportsInterrupt: input.supportsInterrupt ?? false,
      interruptHandler: null,
      inRunInputHandler: null,
      listeners: new Set(),
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

  attach(sessionId: string, listener: RuntimeEventListener): ProviderSubscription {
    const record = this.records.get(sessionId);

    if (!record || record.disposed) {
      return {
        close() {
          return;
        }
      };
    }

    record.listeners.add(listener);
    record.attachedClients += 1;
    let closed = false;

    return {
      close: () => {
        if (closed) {
          return;
        }

        closed = true;
        if (record.listeners.delete(listener)) {
          record.attachedClients = Math.max(0, record.attachedClients - 1);
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
      emit: (event) => this.emit(record.sessionId, event),
      attach: (listener) => this.attach(record.sessionId, listener),
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
    const providerSessionId =
      input.providerSessionId === undefined ? record.providerSessionId : input.providerSessionId;
    const rawStoreRef =
      input.rawStoreRef === undefined ? record.rawStoreRef : input.rawStoreRef;

    record.providerSessionId = providerSessionId;
    record.rawStoreRef = rawStoreRef;
    record.detail = detail;
    record.errorCode = input.type === "error" ? normalizeErrorCode(input.errorCode) : null;

    const event = this.toRuntimeEvent(record, input, timestamp, detail);
    this.applyEventState(record, event);

    await Promise.all(
      [...record.listeners].map(async (listener) => {
        await listener(event);
      })
    );

    return event;
  }

  private applyEventState(record: ActiveRunRecord, event: RuntimeEvent): void {
    if (event.type === "message") {
      record.lastEventAt = event.message.timestamp;

      if (record.runningState === "starting") {
        record.runningState = "running";
      }

      return;
    }

    record.lastEventAt = event.timestamp;
    record.detail = event.detail;
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
    detail: string | null
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
    record.listeners.clear();
    record.attachedClients = 0;
    this.records.delete(sessionId);
  }

  private getRecordOrThrow(sessionId: string): ActiveRunRecord {
    const record = this.records.get(sessionId);

    if (!record || record.disposed) {
      throw new Error("ACTIVE_RUN_NOT_FOUND");
    }

    return record;
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
