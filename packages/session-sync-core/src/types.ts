import type { Stats } from "node:fs";

export const BUILTIN_PROVIDER_IDS = ["claude-code", "codex"] as const;
export type BuiltinProviderId = (typeof BUILTIN_PROVIDER_IDS)[number];
export type ProviderId = BuiltinProviderId | (string & {});
export type SessionRole = "user" | "assistant" | "tool" | "system";
export type SyncStatus = "idle" | "syncing" | "error";
export type MessageKind = "text" | "thinking" | "tool_call" | "tool_result";
export type HistoryDirection = "forward" | "backward";
export type InRunInputMode = "none" | "streaming_guidance" | "queued_guidance";
export type ForkSourceType = "session" | "message";
export type ForkMethod =
  | "native_session_fork"
  | "native_message_fork"
  | "reconstructed_session_fork"
  | "reconstructed_message_fork";
export type ForkStrategy = "auto" | "native-only" | "reconstruct-only";

export interface ForkSourceMessageSnapshot {
  role: SessionRole;
  kind: MessageKind;
  content: string;
}

export interface NormalizedMessageAttachment {
  id: string;
  kind: "image" | "file";
  fileName: string;
  mimeType: string;
  fileSize: number;
}

export interface NormalizedToolCall {
  callId: string;
  name: string;
  input: string;
  output: string | null;
  error: string | null;
  status: "running" | "completed" | "failed";
}

export interface ProviderModelOption {
  id: string;
  name: string;
  usesProviderDefault?: boolean;
  supportedReasoningEfforts?: string[];
}

export interface ProviderCapabilities {
  provider: ProviderId;
  canStartSession: boolean;
  canResumeSession: boolean;
  canSendMessage: boolean;
  inRunInputMode: InRunInputMode;
  supportsSubagents: boolean;
  supportsInterrupt: boolean;
  supportsStructuredToolCalls: boolean;
  supportsTokenUsage: boolean;
  supportsAttachments: boolean;
  supportsPermissionPrompt: boolean;
  supportsCheckpoint: boolean;
  supportsTodo?: boolean;
  supportsSessionDiff?: boolean;
  supportsPermissionRequests?: boolean;
  supportsSessionFork?: boolean;
  supportsSessionShare?: boolean;
  supportsAsyncPrompt?: boolean;
  supportsNativeAgents?: boolean;
  modelOptions?: ProviderModelOption[];
  defaultReasoningLevel?: string | null;
  limitations: string[];
}

export type ContextUsageSource =
  | "provider-log"
  | "provider-runtime"
  | "provider-config"
  | "model-map";

export interface ContextUsageSnapshot {
  provider: ProviderId;
  promptTokens: number;
  uncachedInputTokens: number;
  cachedInputTokens: number;
  contextWindow: number;
  usageRatio: number;
  source: ContextUsageSource;
  contextWindowSource: ContextUsageSource;
  modelId: string | null;
  capturedAt: string | null;
  isEstimated: boolean;
}

export interface ProviderSessionSummary {
  provider: ProviderId;
  providerSessionId: string;
  title: string;
  workspacePath: string;
  rawStoreRef: string;
  isArchived?: boolean;
  lastMessageAt: string | null;
  messageCount: number;
  parentProviderSessionId?: string | null;
  isSubagent?: boolean;
  subagentLabel?: string | null;
  sourceMtimeMs?: number;
  sourceSizeBytes?: number;
}

export interface ProviderArchiveUpdateResult {
  rawStoreRef: string;
  isArchived: boolean;
}

export type ProviderDiscoveryStatus = "success" | "partial" | "failed";

export interface ProviderDiscoveryDiagnostic {
  provider: ProviderId;
  status: ProviderDiscoveryStatus;
  durationMs: number;
  sessionCount: number;
  isComplete: boolean;
  errorMessage?: string | null;
}

export interface ProviderSessionDiscovery {
  sessions: ProviderSessionSummary[];
  isComplete: boolean;
  providerDiagnostics?: ProviderDiscoveryDiagnostic[];
}

export interface DetectSessionsOptions {
  knownSessions?: ProviderSessionSummary[];
}

export interface NormalizedMessage {
  messageId: string;
  provider: ProviderId;
  providerSessionId: string;
  role: SessionRole;
  kind: MessageKind;
  content: string;
  toolCall: NormalizedToolCall | null;
  attachments?: NormalizedMessageAttachment[];
  timestamp: string;
  sequence: number;
  rawRef: string;
}

export interface HistoryPage {
  messages: NormalizedMessage[];
  cursor: string | null;
  nextCursor: string | null;
  total: number;
}

export interface ResumeSessionResult {
  provider: ProviderId;
  providerSessionId: string;
  resumedAt: string;
  rawStoreRef: string;
}

export interface StartSessionOptions {
  initialPrompt?: string;
}

export interface StartSessionResult {
  session: ProviderSessionSummary;
  initialCursor: string | null;
}

export interface ProviderRealtimeEvent {
  messages: NormalizedMessage[];
  cursor: string | null;
}

export interface SendMessageResult {
  acceptedAt: string;
  clientRequestId: string | null;
  message: NormalizedMessage;
}

export interface ForkSessionOptions {
  rawStoreRef: string;
  sourceType: ForkSourceType;
  sourceMessageId?: string | null;
  sourceMessageSnapshot?: ForkSourceMessageSnapshot | null;
  strategy?: ForkStrategy;
}

export interface ForkSessionResult {
  session: ProviderSessionSummary;
  forkMethod: ForkMethod;
  forkSourceType: ForkSourceType;
  inheritedPrefixMessageCount: number;
  providerSourceMessageId?: string | null;
}

export interface ProviderSubscription {
  close(): void;
}

export interface ProviderAdapter {
  readonly providerId: ProviderId;
  detectSessions(
    workspacePath: string,
    options?: DetectSessionsOptions
  ): Promise<ProviderSessionSummary[]>;
  detectSessionsDetailed?(
    workspacePath: string,
    options?: DetectSessionsOptions
  ): Promise<ProviderSessionDiscovery>;
  readRecentSessionHistory?(
    providerSessionId: string,
    rawStoreRef: string,
    totalMessageCount: number,
    limit: number
  ): Promise<HistoryPage | null>;
  readSessionHistory(
    providerSessionId: string,
    rawStoreRef: string,
    cursor: string | null,
    limit: number,
    direction?: HistoryDirection
  ): Promise<HistoryPage>;
  subscribeSession(
    providerSessionId: string,
    rawStoreRef: string,
    cursor: string | null,
    limit: number,
    onEvent: (event: ProviderRealtimeEvent) => Promise<void> | void
  ): ProviderSubscription;
  resumeSession(providerSessionId: string, rawStoreRef: string): Promise<ResumeSessionResult>;
  startSession(workspacePath: string, options: StartSessionOptions): Promise<StartSessionResult>;
  forkSession?(
    providerSessionId: string,
    workspacePath: string,
    options: ForkSessionOptions
  ): Promise<ForkSessionResult>;
  sendMessage(
    providerSessionId: string,
    rawStoreRef: string,
    content: string,
    clientRequestId: string | null,
    permissionMode?: string | null
  ): Promise<SendMessageResult>;
  readSessionTitle(
    providerSessionId: string,
    rawStoreRef: string
  ): Promise<string>;
  renameSessionTitle(
    providerSessionId: string,
    rawStoreRef: string,
    title: string
  ): Promise<string>;
  updateSessionArchiveState(
    providerSessionId: string,
    rawStoreRef: string,
    isArchived: boolean
  ): Promise<ProviderArchiveUpdateResult>;
  readContextUsage?(
    providerSessionId: string,
    rawStoreRef: string
  ): Promise<ContextUsageSnapshot | null>;
  getProviderCapabilities(): ProviderCapabilities;
  getSessionCapabilities(providerSessionId: string): Promise<ProviderCapabilities>;
}

export interface ProviderFileDescriptor {
  filePath: string;
  stats: Stats;
}
