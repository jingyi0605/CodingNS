import type {
  NormalizedMessageAttachment,
  NormalizedMessage,
  ProviderCapabilities,
  ProviderId,
  ProviderSubscription
} from "../types.js";

export type RuntimeRunState =
  | "starting"
  | "running"
  | "completed"
  | "interrupted"
  | "failed";

export type RuntimeInterruptSource = "user" | "runtime";

export interface RuntimeSendOptions {
  content: string;
  clientRequestId: string | null;
  model: string | null;
  reasoningLevel: string | null;
  permissionMode: string | null;
  providerPrompt: string | null;
  attachments: RuntimeAttachment[];
}

export interface RuntimeAttachment extends NormalizedMessageAttachment {
  filePath: string;
}

export interface RuntimeSessionContext {
  sessionId: string;
  workspaceId: string;
  workspacePath: string;
  provider: ProviderId;
  providerSessionId: string | null;
  rawStoreRef: string | null;
}

export interface RuntimeSessionBinding {
  providerSessionId: string | null;
  rawStoreRef: string | null;
}

interface RuntimeEventBase {
  sessionId: string;
  provider: ProviderId;
  providerSessionId: string | null;
  rawStoreRef: string | null;
  timestamp: string;
  detail: string | null;
  interruptSource: RuntimeInterruptSource | null;
  errorCode: string | null;
  rawEventRef: string | null;
}

export interface RuntimeMessageEvent extends RuntimeEventBase {
  type: "message";
  message: NormalizedMessage;
  status: null;
}

export interface RuntimeStatusEvent extends RuntimeEventBase {
  type: "session_created" | "status" | "complete" | "interrupted";
  message: null;
  status: RuntimeRunState;
}

export interface RuntimeErrorEvent extends RuntimeEventBase {
  type: "error";
  message: null;
  status: "failed";
  errorCode: string;
}

export type RuntimeEvent = RuntimeMessageEvent | RuntimeStatusEvent | RuntimeErrorEvent;

export interface RuntimeEventInput {
  type: RuntimeEvent["type"];
  message?: NormalizedMessage | null;
  status?: RuntimeRunState | null;
  detail?: string | null;
  interruptSource?: RuntimeInterruptSource | null;
  errorCode?: string | null;
  rawEventRef?: string | null;
  timestamp?: string;
  providerSessionId?: string | null;
  rawStoreRef?: string | null;
}

export type RuntimeEventListener = (event: RuntimeEvent) => Promise<void> | void;

export interface ActiveRunSnapshot {
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
}

export interface ActiveRunHandle {
  readonly sessionId: string;
  readonly workspaceId: string;
  readonly provider: ProviderId;
  getSnapshot(): ActiveRunSnapshot;
  updateSessionBinding(binding: RuntimeSessionBinding): void;
  setInterruptHandler(interrupt: (() => Promise<void>) | null): void;
  setInRunInputHandler(submitDuringRun: ((options: RuntimeSendOptions) => Promise<void>) | null): void;
  setLivenessProbe(probe: (() => boolean) | null): void;
  emit(event: RuntimeEventInput): Promise<RuntimeEvent>;
  attach(listener: RuntimeEventListener): ProviderSubscription;
  isHealthy(): boolean | null;
  interrupt(): Promise<void>;
  submitDuringRun(options: RuntimeSendOptions): Promise<void>;
  dispose(): Promise<void>;
}

export interface RegisterActiveRunInput extends RuntimeSessionContext {
  startedAt?: string;
  supportsInterrupt?: boolean;
}

export interface ProviderRuntimeEventSink {
  emit(event: RuntimeEventInput): Promise<void>;
  updateSessionBinding(binding: RuntimeSessionBinding): void;
}

export interface ProviderRuntimeRunRequest {
  sessionId: string;
  workspaceId: string;
  workspacePath: string;
  provider: ProviderId;
  providerSessionId: string | null;
  rawStoreRef: string | null;
  sequenceBase?: number | null;
  options: RuntimeSendOptions;
}

export interface ProviderRuntimeLaunchResult {
  providerSessionId: string;
  rawStoreRef: string | null;
  completed: Promise<void>;
  interrupt?: (() => Promise<void>) | null;
  submitDuringRun?: ((options: RuntimeSendOptions) => Promise<void>) | null;
  isAlive?: (() => boolean) | null;
}

export interface ProviderRuntimeAdapter {
  readonly providerId: ProviderId;
  startSession(
    request: ProviderRuntimeRunRequest,
    sink: ProviderRuntimeEventSink
  ): Promise<ProviderRuntimeLaunchResult>;
  continueSession(
    request: ProviderRuntimeRunRequest,
    sink: ProviderRuntimeEventSink
  ): Promise<ProviderRuntimeLaunchResult>;
}

export interface RuntimeSessionView {
  sessionId: string;
  workspaceId: string;
  provider: ProviderId;
  providerSessionId: string;
  rawStoreRef: string;
  runningState: RuntimeRunState | "idle";
  hasActiveRun: boolean;
  canAttach: boolean;
  attachedClients: number;
  startedAt: string | null;
  lastEventAt: string | null;
  completedAt: string | null;
  detail: string | null;
  supportsInterrupt: boolean;
  capabilities: ProviderCapabilities;
}
