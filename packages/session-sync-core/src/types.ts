import type { Stats } from "node:fs";

export type ProviderId = "claude-code" | "codex";
export type SessionRole = "user" | "assistant" | "tool" | "system";
export type SyncStatus = "idle" | "syncing" | "error";
export type MessageKind = "text" | "thinking" | "tool_call" | "tool_result";
export type HistoryDirection = "forward" | "backward";

export interface NormalizedMessageAttachment {
  id: string;
  kind: "image";
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
}

export interface ProviderCapabilities {
  provider: ProviderId;
  canStartSession: boolean;
  canResumeSession: boolean;
  canSendMessage: boolean;
  supportsSubagents: boolean;
  supportsInterrupt: boolean;
  supportsStructuredToolCalls: boolean;
  supportsTokenUsage: boolean;
  supportsAttachments: boolean;
  supportsPermissionPrompt: boolean;
  supportsCheckpoint: boolean;
  modelOptions?: ProviderModelOption[];
  limitations: string[];
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

export interface ProviderSubscription {
  close(): void;
}

export interface ProviderAdapter {
  readonly providerId: ProviderId;
  detectSessions(
    workspacePath: string,
    options?: DetectSessionsOptions
  ): Promise<ProviderSessionSummary[]>;
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
  sendMessage(
    providerSessionId: string,
    rawStoreRef: string,
    content: string,
    clientRequestId: string | null
  ): Promise<SendMessageResult>;
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
  getProviderCapabilities(): ProviderCapabilities;
  getSessionCapabilities(providerSessionId: string): Promise<ProviderCapabilities>;
}

export interface ProviderFileDescriptor {
  filePath: string;
  stats: Stats;
}
