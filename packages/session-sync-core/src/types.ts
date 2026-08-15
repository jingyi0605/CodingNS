import type { Stats } from "node:fs";

export const BUILTIN_PROVIDER_IDS = ["claude-code", "legna-code", "codex"] as const;
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
  defaultReasoningEffort?: string | null;
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
  supportsSessionDelete?: boolean;
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
  /** 当前请求的输入桶；Provider 未提供可验证拆分时保持缺失，不能伪造 0。 */
  uncachedInputTokens?: number;
  /** 当前请求的缓存输入桶；Provider 未提供可验证拆分时保持缺失，不能伪造 0。 */
  cachedInputTokens?: number;
  contextWindow: number;
  usageRatio: number;
  source: ContextUsageSource;
  contextWindowSource: ContextUsageSource;
  modelId: string | null;
  capturedAt: string | null;
  isEstimated: boolean;
}

/**
 * Provider 原生会话统计的指标名。
 *
 * 统计是稀疏数据：某个 key 不存在，表示该 Provider 没有提供可信的累计值，
 * 不能由调用方补成 0。
 */
export type ProviderSessionStatMetric =
  | "inputTokens"
  | "outputTokens"
  | "reasoningTokens"
  | "cacheReadTokens"
  | "cacheWriteTokens"
  | "cacheHitRate"
  | "toolTokens"
  | "totalTokens"
  | "turns"
  | "steps"
  | "llmMs"
  | "toolMs"
  | "ttftMs"
  | "ttftSteps"
  | "decodeMs"
  | "decodeTokens"
  | "costUsd";

export type ProviderSessionStatSource =
  | "provider-projection"
  | "provider-session-store"
  | "provider-history-log"
  | "derived-provider-metrics";

/** 说明当前数字是原生累计、最终事件求和，还是一条累计快照。 */
export type ProviderSessionStatSemantic =
  | "cumulative"
  | "sum-of-final-events"
  | "latest-snapshot"
  | "derived-ratio";

/**
 * 指标所覆盖的原始数据水位。
 *
 * `captured-at` 只用于 Provider 没有暴露原始序号或时间的 projection；它明确表示
 * 本次读取时看到的完整投影，而不是伪造一条 Provider 事件时间。
 */
export interface ProviderSessionStatWatermark {
  kind: "source-sequence" | "source-timestamp" | "captured-at";
  value: string;
}

export interface ProviderSessionStatValue {
  value: number;
  source: ProviderSessionStatSource;
  semantic: ProviderSessionStatSemantic;
  watermark: ProviderSessionStatWatermark;
}

/**
 * 单个 Provider 对整个会话提供的统计。
 *
 * 它刻意不复用 ContextUsageSnapshot：ContextUsageSnapshot 是下一次请求的上下文
 * 占用，而这里是已发生的会话累计数据。
 */
export interface ProviderSessionStats {
  provider: ProviderId;
  capturedAt: string;
  metrics: Partial<Record<ProviderSessionStatMetric, ProviderSessionStatValue>>;
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
  activityObservation?: ProviderSessionActivityObservation | null;
}

export type ProviderSessionObservedRunningState =
  | "idle"
  | "starting"
  | "running"
  | "completed"
  | "interrupted"
  | "failed";

export type ProviderSessionActivityConfidence = "authoritative" | "strong" | "weak";

export interface ProviderSessionActivityObservation {
  runningState: ProviderSessionObservedRunningState;
  confidence: ProviderSessionActivityConfidence;
  observedAt: string | null;
  detail?: string | null;
  errorCode?: string | null;
  runId?: string | null;
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
  scannedFiles?: number;
  skippedByMtimeSize?: number;
  parsedFiles?: number;
  bytesRead?: number;
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
  /**
   * 读取 provider 对单个会话的权威活动状态。
   *
   * 不是所有 provider 都有独立的状态接口；缺省时上层继续使用现有运行时或本地日志推断。
   */
  readSessionActivity?(
    providerSessionId: string,
    rawStoreRef: string
  ): Promise<ProviderSessionActivityObservation | null>;
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
  deleteSession?(
    providerSessionId: string,
    rawStoreRef: string
  ): Promise<void>;
  readContextUsage?(
    providerSessionId: string,
    rawStoreRef: string
  ): Promise<ContextUsageSnapshot | null>;
  readSessionStats?(
    providerSessionId: string,
    rawStoreRef: string
  ): Promise<ProviderSessionStats | null>;
  getProviderCapabilities(): ProviderCapabilities;
  getSessionCapabilities(providerSessionId: string): Promise<ProviderCapabilities>;
}

export interface ProviderFileDescriptor {
  filePath: string;
  stats: Stats;
}
