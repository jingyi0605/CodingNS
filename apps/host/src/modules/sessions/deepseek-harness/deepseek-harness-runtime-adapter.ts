import { readFile } from "node:fs/promises";
import path from "node:path";

import type {
  ProviderRuntimeAdapter,
  ProviderRuntimeLaunchResult,
  ProviderRuntimeRunRequest,
  ProviderRuntimeEventSink,
  RuntimeSendOptions
} from "@codingns/session-sync-core/runtime/types";
import { DeepSeekHarnessEventBridge } from "./deepseek-harness-event-bridge.js";
import type { DeepSeekHarnessApiClient } from "./deepseek-harness-api-client.js";
import type { TaskManager } from "../../tasks/task-manager.js";

const MAX_ATTACHMENT_BYTES = 10 * 1024 * 1024;

export class DeepSeekHarnessRuntimeAdapter implements ProviderRuntimeAdapter {
  readonly providerId = "deepseek-harness" as const;

  private runtime: Promise<{ client: DeepSeekHarnessApiClient; eventBridge: DeepSeekHarnessEventBridge }> | null = null;
  private permissionRequestHandler: ((input: {
    sessionId: string;
    providerSessionId: string;
    rpcId: string;
    type: "approval" | "question";
    payload: unknown;
    respond: (result: { ok: true; value: unknown } | { ok: false; error: { code: string; message: string } }) => Promise<void>;
  }) => Promise<void>) | null = null;

  constructor(private readonly clientFactory: () => Promise<DeepSeekHarnessApiClient>, private readonly taskManager: TaskManager) {}

  setPermissionRequestHandler(handler: NonNullable<DeepSeekHarnessRuntimeAdapter["permissionRequestHandler"]>): void {
    this.permissionRequestHandler = handler;
  }

  async startSession(request: ProviderRuntimeRunRequest, sink: ProviderRuntimeEventSink): Promise<ProviderRuntimeLaunchResult> {
    const { client } = await this.getRuntime();
    let providerSessionId = request.providerSessionId;
    if (!providerSessionId) {
      const created = await client.createSession(request.workspacePath);
      providerSessionId = created.sessionId;
      sink.updateSessionBinding({ providerSessionId, rawStoreRef: `harness://${providerSessionId}` });
      await sink.emit({ type: "session_created", status: "starting", providerSessionId, rawStoreRef: `harness://${providerSessionId}`, detail: "Harness 会话已创建" });
    }
    return this.launchPrompt(request, providerSessionId, sink);
  }

  async continueSession(request: ProviderRuntimeRunRequest, sink: ProviderRuntimeEventSink): Promise<ProviderRuntimeLaunchResult> {
    if (!request.providerSessionId) return this.startSession(request, sink);
    return this.launchPrompt(request, request.providerSessionId, sink);
  }

  private async launchPrompt(request: ProviderRuntimeRunRequest, providerSessionId: string, sink: ProviderRuntimeEventSink): Promise<ProviderRuntimeLaunchResult> {
    const { client, eventBridge } = await this.getRuntime();
    const rawStoreRef = request.rawStoreRef ?? `harness://${providerSessionId}`;
    const closed = eventBridge.watch(providerSessionId, (event) => {
      if (event.type === "message" && event.message) {
        void sink.emit({ type: "message", message: event.message, providerSessionId, rawStoreRef, rawEventRef: event.message.rawRef });
      } else if (event.type === "status") {
        void sink.emit({ type: "status", status: event.running ? "running" : "completed", providerSessionId, rawStoreRef, detail: event.running ? "Harness 正在运行" : "Harness 已完成" });
        if (!event.running) settle();
      } else if (event.type === "error") {
        void sink.emit({ type: "error", status: "failed", errorCode: "HARNESS_RUNTIME_ERROR", detail: event.detail, providerSessionId, rawStoreRef });
        settle();
      } else if ((event.type === "approval" || event.type === "question") && this.permissionRequestHandler) {
        void this.permissionRequestHandler({
          sessionId: request.sessionId,
          providerSessionId,
          rpcId: event.rpcId,
          type: event.type,
          payload: event.payload,
          respond: (result) => client.respond(event.rpcId, result)
        });
      }
    });
    let resolveCompleted!: () => void;
    let rejectCompleted!: (error: unknown) => void;
    const completed = new Promise<void>((resolve, reject) => { resolveCompleted = resolve; rejectCompleted = reject; });
    let settled = false;
    const settle = () => { if (settled) return; settled = true; closed.close(); resolveCompleted(); };

    try {
      await sink.emit({ type: "status", status: "running", providerSessionId, rawStoreRef, detail: "Harness 正在运行" });
      const selection = parseModelSelection(request.options.model);
      if (selection) await client.selectModel(providerSessionId, selection.provider, selection.model, request.options.reasoningLevel ?? undefined);
      await client.prompt(providerSessionId, await buildPromptContent(request.options, request.workspacePath), resolvePromptMode(request.options));
    } catch (error) {
      closed.close();
      rejectCompleted(error);
      throw error;
    }

    return {
      providerSessionId,
      rawStoreRef,
      completed,
      interrupt: async () => { await client.cancel(providerSessionId!); settle(); },
      submitDuringRun: async (options) => { await client.prompt(providerSessionId!, await buildPromptContent(options, request.workspacePath), resolvePromptMode(options)); },
      isAlive: () => !settled
    };
  }

  private getRuntime(): Promise<{ client: DeepSeekHarnessApiClient; eventBridge: DeepSeekHarnessEventBridge }> {
    if (!this.runtime) {
      this.runtime = this.clientFactory().then((client) => ({ client, eventBridge: new DeepSeekHarnessEventBridge({ taskManager: this.taskManager, client }) }));
    }
    return this.runtime;
  }
}

function resolvePromptMode(options: RuntimeSendOptions): "queue" | "steer" {
  return options.permissionMode === "steer" ? "steer" : "queue";
}

function parseModelSelection(value: string | null): { provider: string; model: string } | null {
  const normalized = value?.trim();
  if (!normalized) return null;
  const separator = normalized.indexOf(":");
  if (separator <= 0 || separator === normalized.length - 1) return { provider: "deepseek", model: normalized };
  return { provider: normalized.slice(0, separator), model: normalized.slice(separator + 1) };
}

async function buildPromptContent(options: RuntimeSendOptions, workspacePath: string): Promise<Array<Record<string, string>>> {
  const content: Array<Record<string, string>> = [{ type: "text", text: options.content }];
  for (const attachment of options.attachments) {
    const absolutePath = path.resolve(attachment.filePath);
    const relative = path.relative(path.resolve(workspacePath), absolutePath);
    if (relative.startsWith("..") || path.isAbsolute(relative)) throw new Error("HARNESS_WORKSPACE_FORBIDDEN");
    const data = await readFile(absolutePath);
    if (data.byteLength > MAX_ATTACHMENT_BYTES) throw new Error("HARNESS_ATTACHMENT_TOO_LARGE");
    if (attachment.kind === "image") content.push({ type: "image", mediaType: attachment.mimeType, data: data.toString("base64"), ...(attachment.fileName ? { name: attachment.fileName } : {}) });
  }
  return content;
}
