import type { ProviderSubscription } from "../types.js";
import { ActiveRunRegistry } from "./active-run-registry.js";
import type {
  ActiveRunHandle,
  ActiveRunSnapshot,
  ProviderRuntimeAdapter,
  ProviderRuntimeRunRequest,
  RuntimeSendOptions,
  RuntimeEventListener
} from "./types.js";

export class ProviderRuntimeService {
  private readonly adapters = new Map<string, ProviderRuntimeAdapter>();
  private readonly handles = new Map<string, ActiveRunHandle>();

  constructor(
    adapters: ProviderRuntimeAdapter[],
    private readonly registry = new ActiveRunRegistry()
  ) {
    for (const adapter of adapters) {
      this.adapters.set(adapter.providerId, adapter);
    }
  }

  async startSession(request: ProviderRuntimeRunRequest): Promise<ActiveRunHandle> {
    return this.beginRun("start", request);
  }

  async continueSession(request: ProviderRuntimeRunRequest): Promise<ActiveRunHandle> {
    return this.beginRun("continue", request);
  }

  getSnapshot(sessionId: string): ActiveRunSnapshot | null {
    return this.registry.getSnapshot(sessionId);
  }

  subscribe(sessionId: string, listener: RuntimeEventListener): ProviderSubscription {
    return this.registry.attach(sessionId, listener);
  }

  async interrupt(sessionId: string): Promise<ActiveRunSnapshot> {
    const handle = this.handles.get(sessionId);

    if (!handle) {
      throw new Error("ACTIVE_RUN_NOT_FOUND");
    }

    const snapshot = handle.getSnapshot();

    if (!snapshot.supportsInterrupt) {
      throw new Error("INTERRUPT_NOT_SUPPORTED");
    }

    await handle.interrupt();
    await handle.emit({
      type: "interrupted",
      status: "interrupted",
      detail: "interrupt requested"
    });

    return handle.getSnapshot();
  }

  async submitToActiveRun(
    sessionId: string,
    options: RuntimeSendOptions
  ): Promise<ActiveRunSnapshot> {
    const handle = this.handles.get(sessionId);

    if (!handle) {
      throw new Error("ACTIVE_RUN_NOT_FOUND");
    }

    await handle.submitDuringRun(options);
    return handle.getSnapshot();
  }

  async dispose(): Promise<void> {
    const handles = [...this.handles.values()];

    for (const handle of handles) {
      await handle.dispose();
    }

    this.handles.clear();
    await this.registry.disposeAll();
  }

  private async beginRun(
    mode: "start" | "continue",
    request: ProviderRuntimeRunRequest
  ): Promise<ActiveRunHandle> {
    const adapter = this.adapters.get(request.provider);

    if (!adapter) {
      throw new Error("PROVIDER_RUNTIME_UNAVAILABLE");
    }

    const handle = this.registry.register({
      sessionId: request.sessionId,
      workspaceId: request.workspaceId,
      workspacePath: request.workspacePath,
      provider: request.provider,
      providerSessionId: request.providerSessionId,
      rawStoreRef: request.rawStoreRef
    });
    this.handles.set(request.sessionId, handle);

    await handle.emit({
      type: "status",
      status: "starting",
      detail: mode === "start" ? "starting native session" : "resuming native session"
    });

    try {
      const launch =
        mode === "start"
          ? await adapter.startSession(request, this.createSink(handle))
          : await adapter.continueSession(request, this.createSink(handle));

      handle.updateSessionBinding({
        providerSessionId: launch.providerSessionId,
        rawStoreRef: launch.rawStoreRef
      });
      handle.setInterruptHandler(launch.interrupt ?? null);
      handle.setInRunInputHandler(launch.submitDuringRun ?? null);

      await handle.emit({
        type: "session_created",
        status: "starting",
        providerSessionId: launch.providerSessionId,
        rawStoreRef: launch.rawStoreRef,
        detail: "native session attached"
      });

      void launch.completed
        .then(async () => {
          const snapshot = this.registry.getSnapshot(request.sessionId);

          if (!snapshot) {
            this.handles.delete(request.sessionId);
            return;
          }

          if (snapshot.runningState === "starting" || snapshot.runningState === "running") {
            await handle.emit({
              type: "complete",
              status: "completed",
              detail: "run completed"
            });
          }

          await handle.dispose();
          this.handles.delete(request.sessionId);
        })
        .catch(async (error) => {
          const snapshot = this.registry.getSnapshot(request.sessionId);

          if (!snapshot) {
            this.handles.delete(request.sessionId);
            return;
          }

          await handle.emit({
            type: "error",
            status: "failed",
            detail: error instanceof Error ? error.message : "provider runtime failed"
          });
          await handle.dispose();
          this.handles.delete(request.sessionId);
        });

      return handle;
    } catch (error) {
      await handle.emit({
        type: "error",
        status: "failed",
        detail: error instanceof Error ? error.message : "provider runtime failed"
      });
      await handle.dispose();
      this.handles.delete(request.sessionId);
      throw error;
    }
  }

  private createSink(handle: ActiveRunHandle) {
    return {
      emit: async (event: Parameters<ActiveRunHandle["emit"]>[0]) => {
        await handle.emit(event);
      },
      updateSessionBinding: (binding: Parameters<ActiveRunHandle["updateSessionBinding"]>[0]) => {
        handle.updateSessionBinding(binding);
      }
    };
  }
}
