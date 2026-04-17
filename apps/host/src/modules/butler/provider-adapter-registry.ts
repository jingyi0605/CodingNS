import type { SessionHistoryService } from "../sessions/session-history-service.js";
import type {
  SessionRuntimeEnvelope,
  SessionLiveRuntimeService
} from "../sessions/session-live-runtime-service.js";

const DEFAULT_WAIT_TIMEOUT_MS = 20 * 60_000;
const DEFAULT_WAIT_POLL_INTERVAL_MS = 2_000;
const MAX_ACTION_ITEMS = 8;
const MAX_RISK_FLAGS = 6;

export interface PatrolStructuredOutput {
  summary: string | null;
  riskLevel: "low" | "medium" | "high" | null;
  suggestions: string[];
  progressState: "unknown" | "working" | "blocked" | "done";
  riskFlags: string[];
  nextActions: string[];
  rawJson: string | null;
}

export interface StartPatrolSessionInput {
  workspaceId: string;
  userId: string;
  providerId: "codex" | "claude-code";
  prompt: string;
  model: string | null;
  reasoningLevel: string | null;
  permissionMode: string | null;
  instructionFilePath: string | null;
}

export interface PatrolSessionLaunchResult {
  sessionId: string;
  provider: string;
  providerSessionId: string;
  acceptedAt: string;
}

export interface PatrolSessionResult {
  assistantMessages: string[];
  latestAssistantMessage: string | null;
  structured: PatrolStructuredOutput;
}

export interface PatrolProviderAdapter {
  readonly providerId: "codex" | "claude-code";
  startPatrolSession(input: StartPatrolSessionInput): Promise<PatrolSessionLaunchResult>;
  waitForSessionTerminal(sessionId: string): Promise<void>;
  readPatrolResult(sessionId: string): Promise<PatrolSessionResult>;
}

export class ProviderAdapterRegistry {
  private readonly adapters = new Map<PatrolProviderAdapter["providerId"], PatrolProviderAdapter>();

  constructor(adapters: PatrolProviderAdapter[]) {
    for (const adapter of adapters) {
      this.adapters.set(adapter.providerId, adapter);
    }
  }

  get(providerId: "codex" | "claude-code"): PatrolProviderAdapter {
    const adapter = this.adapters.get(providerId);

    if (!adapter) {
      throw new Error(`PATROL_PROVIDER_UNSUPPORTED:${providerId}`);
    }

    return adapter;
  }
}

interface RuntimePatrolProviderAdapterOptions {
  waitTimeoutMs?: number;
  waitPollIntervalMs?: number;
}

export class RuntimePatrolProviderAdapter implements PatrolProviderAdapter {
  private readonly waitTimeoutMs: number;
  private readonly waitPollIntervalMs: number;
  private readonly sessionOwnerBySessionId = new Map<string, string>();

  constructor(
    readonly providerId: "codex" | "claude-code",
    private readonly sessionLiveRuntimeService: SessionLiveRuntimeService,
    private readonly sessionHistoryService: SessionHistoryService,
    options: RuntimePatrolProviderAdapterOptions = {}
  ) {
    this.waitTimeoutMs = options.waitTimeoutMs ?? DEFAULT_WAIT_TIMEOUT_MS;
    this.waitPollIntervalMs = Math.max(500, options.waitPollIntervalMs ?? DEFAULT_WAIT_POLL_INTERVAL_MS);
  }

  async startPatrolSession(input: StartPatrolSessionInput): Promise<PatrolSessionLaunchResult> {
    const accepted = await this.sessionLiveRuntimeService.startLiveSession({
      workspaceId: input.workspaceId,
      userId: input.userId,
      provider: input.providerId,
      content: input.prompt,
      clientRequestId: null,
      runtimeOptions: {
        model: input.model,
        reasoningLevel: input.reasoningLevel,
        permissionMode: input.permissionMode,
        providerInstructionFilePath: input.instructionFilePath
      }
    });
    this.sessionOwnerBySessionId.set(accepted.sessionId, input.userId);

    return {
      sessionId: accepted.sessionId,
      provider: accepted.provider,
      providerSessionId: accepted.providerSessionId,
      acceptedAt: accepted.acceptedAt
    };
  }

  async waitForSessionTerminal(sessionId: string): Promise<void> {
    const userId = this.sessionOwnerBySessionId.get(sessionId);

    if (!userId) {
      throw new Error(`PATROL_SESSION_CONTEXT_NOT_FOUND:${sessionId}`);
    }

    try {
      const currentState = await this.readRuntimeState(sessionId, userId);

      if (isTerminalRuntimeState(currentState)) {
        return;
      }

      await this.waitForTerminalWithSubscription(sessionId, userId);
    } finally {
      this.sessionOwnerBySessionId.delete(sessionId);
    }
  }

  async readPatrolResult(sessionId: string): Promise<PatrolSessionResult> {
    const history = await this.sessionHistoryService.readRecentHistoryEnvelope(sessionId, 80);
    const assistantMessages =
      history?.messages
        .filter((message) => message.role === "assistant" && message.kind === "text")
        .map((message) => message.content.trim())
        .filter((message) => message.length > 0) ?? [];
    const latestAssistantMessage = assistantMessages.at(-1) ?? null;
    const structured = parseStructuredOutput(latestAssistantMessage, assistantMessages);

    return {
      assistantMessages,
      latestAssistantMessage,
      structured
    };
  }

  private async waitForTerminalWithSubscription(sessionId: string, userId: string): Promise<void> {
    return new Promise<void>((resolve, reject) => {
      let settled = false;
      let polling = false;

      const finish = (error?: Error) => {
        if (settled) {
          return;
        }

        settled = true;
        subscription.close();
        clearInterval(pollTimer);
        clearTimeout(timeoutTimer);

        if (error) {
          reject(error);
          return;
        }

        resolve();
      };

      const subscription = this.sessionLiveRuntimeService.subscribeRuntime(sessionId, async (envelope) => {
        if (!isTerminalEnvelope(envelope)) {
          return;
        }

        finish();
      });

      const pollTerminalState = async () => {
        if (settled || polling) {
          return;
        }

        polling = true;

        try {
          const state = await this.readRuntimeState(sessionId, userId);

          if (isTerminalRuntimeState(state)) {
            finish();
          }
        } catch {
          // 轮询兜底不应打断主流程，超时会统一兜底失败
        } finally {
          polling = false;
        }
      };

      const pollTimer = setInterval(() => {
        void pollTerminalState();
      }, this.waitPollIntervalMs);
      pollTimer.unref?.();

      const timeoutTimer = setTimeout(() => {
        finish(new Error(`PATROL_SESSION_WAIT_TIMEOUT:${sessionId}`));
      }, this.waitTimeoutMs);
      timeoutTimer.unref?.();

      void pollTerminalState();
    });
  }

  private async readRuntimeState(
    sessionId: string,
    userId: string
  ): Promise<ReturnType<typeof normalizeRuntimeState>> {
    const runtime = await this.sessionLiveRuntimeService.getSessionRuntime(sessionId, userId);
    return normalizeRuntimeState(runtime.runningState);
  }
}

function isTerminalEnvelope(
  envelope: SessionRuntimeEnvelope | { type: string; status?: string | null }
): boolean {
  if (envelope.type === "session.runtime_error" || envelope.type === "session.interrupted") {
    return true;
  }

  return (
    envelope.type === "session.runtime_status"
    && (envelope.status === "completed" || envelope.status === "failed" || envelope.status === "interrupted")
  );
}

function normalizeRuntimeState(
  state: string | null
): "idle" | "starting" | "running" | "completed" | "failed" | "interrupted" | "stale" | "unknown" | null {
  switch (state) {
    case "idle":
    case "starting":
    case "running":
    case "completed":
    case "failed":
    case "interrupted":
    case "stale":
    case "unknown":
      return state;
    default:
      return null;
  }
}

function isTerminalRuntimeState(state: ReturnType<typeof normalizeRuntimeState>): boolean {
  return state === "idle" || state === "completed" || state === "failed" || state === "interrupted";
}

function parseStructuredOutput(
  latestAssistantMessage: string | null,
  assistantMessages: string[]
): PatrolStructuredOutput {
  const combined = [latestAssistantMessage ?? "", ...assistantMessages.slice().reverse()].join("\n\n");
  const rawJson = extractStructuredJson(combined);
  const parsed = rawJson ? safeParseObject(rawJson) : null;
  const narrativeText = stripCodeBlocks(latestAssistantMessage ?? assistantMessages.at(-1) ?? "");
  const hintText = stripCodeBlocks(combined);
  const summary = readStringByKeys(parsed, ["summary", "结论", "总结", "摘要"]) ?? extractSummaryFromText(narrativeText);
  const riskLevel = normalizeRiskLevel(
    readStringByKeys(parsed, ["riskLevel", "risk", "风险等级", "风险级别", "风险"])
  ) ?? inferRiskLevel(combined);
  const actionHints = extractActionHints(hintText);
  const suggestions = normalizeStringList(
    readStringArrayByKeys(parsed, ["suggestions", "建议", "recommendations"]),
    readStringArrayByKeys(parsed, ["nextActions", "next_steps", "下一步", "行动项"]),
    actionHints.suggestions,
    actionHints.nextActions
  ).slice(0, MAX_ACTION_ITEMS);
  const riskFlags = normalizeStringList(
    readStringArrayByKeys(parsed, ["riskFlags", "风险项", "风险提示", "risks"]),
    actionHints.riskFlags
  ).slice(0, MAX_RISK_FLAGS);
  const nextActions = normalizeStringList(
    readStringArrayByKeys(parsed, ["nextActions", "next_steps", "下一步", "行动项"]),
    actionHints.nextActions,
    readStringArrayByKeys(parsed, ["suggestions", "建议", "recommendations"]),
    actionHints.suggestions
  ).slice(0, MAX_ACTION_ITEMS);

  return {
    summary,
    riskLevel,
    suggestions,
    progressState: normalizeProgressState(
      readStringByKeys(parsed, ["progressState", "progress", "状态", "进度状态"]),
      combined
    ),
    riskFlags,
    nextActions,
    rawJson
  };
}

function extractStructuredJson(content: string): string | null {
  const candidates: string[] = [];
  const codeBlockMatches = [...content.matchAll(/```(?:json)?\s*([\s\S]*?)```/gi)];

  for (const match of codeBlockMatches) {
    const candidate = match[1]?.trim() ?? "";

    if (candidate.includes("{") && candidate.includes("}")) {
      candidates.push(candidate);
    }
  }

  const plainJsonCandidate = extractLastBalancedJsonObject(content);

  if (plainJsonCandidate) {
    candidates.push(plainJsonCandidate);
  }

  for (let index = candidates.length - 1; index >= 0; index -= 1) {
    const candidate = candidates[index];
    const parsed = safeParseObject(candidate);

    if (parsed) {
      return candidate;
    }
  }

  return null;
}

function extractLastBalancedJsonObject(content: string): string | null {
  let depth = 0;
  let startIndex = -1;
  let candidate: string | null = null;

  for (let index = 0; index < content.length; index += 1) {
    const char = content[index];

    if (char === "{") {
      if (depth === 0) {
        startIndex = index;
      }

      depth += 1;
      continue;
    }

    if (char !== "}" || depth <= 0) {
      continue;
    }

    depth -= 1;

    if (depth === 0 && startIndex >= 0) {
      candidate = content.slice(startIndex, index + 1);
      startIndex = -1;
    }
  }

  return candidate?.trim() ?? null;
}

function stripCodeBlocks(content: string): string {
  return content.replace(/```[\s\S]*?```/g, "").trim();
}

function safeParseObject(raw: string): Record<string, unknown> | null {
  const candidates = [raw, normalizeJsonLikeText(raw)];

  for (const candidate of candidates) {
    if (!candidate) {
      continue;
    }

    const parsed = safeParseObjectStrict(candidate);

    if (parsed) {
      return parsed;
    }
  }

  return null;
}

function safeParseObjectStrict(raw: string): Record<string, unknown> | null {
  try {
    const parsed = JSON.parse(raw);
    return parsed && typeof parsed === "object" && !Array.isArray(parsed)
      ? (parsed as Record<string, unknown>)
      : null;
  } catch {
    return null;
  }
}

function readString(record: Record<string, unknown> | null, key: string): string | null {
  const value = record?.[key];
  return typeof value === "string" && value.trim().length > 0 ? value.trim() : null;
}

function readStringByKeys(record: Record<string, unknown> | null, keys: string[]): string | null {
  for (const key of keys) {
    const value = readString(record, key);

    if (value) {
      return value;
    }
  }

  return null;
}

function readStringArray(record: Record<string, unknown> | null, key: string): string[] {
  const value = record?.[key];

  if (!Array.isArray(value)) {
    return [];
  }

  return value.filter((item): item is string => typeof item === "string" && item.trim().length > 0);
}

function readStringArrayByKeys(record: Record<string, unknown> | null, keys: string[]): string[] {
  return keys.flatMap((key) => readStringArray(record, key));
}

function normalizeRiskLevel(value: string | null): "low" | "medium" | "high" | null {
  if (!value) {
    return null;
  }

  const normalized = value.trim().toLowerCase();

  if (normalized === "low" || normalized === "medium" || normalized === "high") {
    return normalized;
  }

  if (/(高|严重|critical|severe)/i.test(value)) {
    return "high";
  }

  if (/(中|一般|moderate)/i.test(value)) {
    return "medium";
  }

  if (/(低|轻微|minor)/i.test(value)) {
    return "low";
  }

  return null;
}

function normalizeProgressState(
  value: string | null,
  fallbackText: string
): "unknown" | "working" | "blocked" | "done" {
  if (value) {
    const normalized = value.trim().toLowerCase();

    if (normalized === "working" || normalized === "blocked" || normalized === "done") {
      return normalized;
    }

    if (/(进行中|处理中|working|running|in progress)/i.test(value)) {
      return "working";
    }

    if (/(阻塞|失败|中断|blocked|failed|interrupted|error|报错)/i.test(value)) {
      return "blocked";
    }

    if (/(完成|done|completed|通过|已完成|closed)/i.test(value)) {
      return "done";
    }
  }

  if (/(阻塞|blocked|失败|failed|中断|interrupted|无法继续|报错|错误)/i.test(fallbackText)) {
    return "blocked";
  }

  if (/(完成|已完成|done|completed|通过|passed|收敛)/i.test(fallbackText)) {
    return "done";
  }

  if (fallbackText.trim().length > 0) {
    return "working";
  }

  return "unknown";
}

function inferRiskLevel(content: string): "low" | "medium" | "high" | null {
  if (/(严重|高风险|high risk|blocked|失败|failed|error|崩溃|中断|破坏|回滚)/i.test(content)) {
    return "high";
  }

  if (/(风险|告警|warning|不稳定|flaky|缺失|待处理|需关注|可能)/i.test(content)) {
    return "medium";
  }

  if (/(稳定|正常|无风险|通过|healthy|ok)/i.test(content)) {
    return "low";
  }

  return null;
}

function extractSummaryFromText(content: string): string | null {
  const lines = content
    .split("\n")
    .map((line) => line.trim())
    .filter((line) => line.length > 0)
    .filter((line) => !line.startsWith("{") && !line.startsWith("}"));

  return lines.at(0) ?? null;
}

function extractActionHints(content: string): {
  suggestions: string[];
  nextActions: string[];
  riskFlags: string[];
} {
  const lines = content
    .split("\n")
    .map((line) => line.trim())
    .filter((line) => line.length > 0);
  const suggestions: string[] = [];
  const nextActions: string[] = [];
  const riskFlags: string[] = [];

  for (const line of lines) {
    const normalized = normalizeBulletLine(line);

    if (!normalized) {
      continue;
    }

    if (/(建议|下一步|next step|todo|行动|action)/i.test(line)) {
      suggestions.push(normalized);
      nextActions.push(normalized);
    }

    if (/(风险|阻塞|失败|错误|告警|risk|blocked|failed|error|warning)/i.test(line)) {
      riskFlags.push(normalized);
    }
  }

  return {
    suggestions,
    nextActions,
    riskFlags
  };
}

function normalizeBulletLine(line: string): string | null {
  const normalized = line
    .replace(/^[-*]\s*/, "")
    .replace(/^\d+\.\s*/, "")
    .replace(/^(建议|下一步|风险|Risk|Next)\s*[:：-]\s*/i, "")
    .trim();

  if (normalized.length < 4) {
    return null;
  }

  if (normalized.startsWith("{") || normalized.startsWith("}") || normalized.startsWith("\"")) {
    return null;
  }
  if (normalized.startsWith("[") || normalized.startsWith("]")) {
    return null;
  }

  return normalized;
}

function normalizeStringList(...groups: string[][]): string[] {
  const seen = new Set<string>();
  const result: string[] = [];

  for (const group of groups) {
    for (const item of group) {
      const normalized = item.trim();

      if (!normalized) {
        continue;
      }

      if (seen.has(normalized)) {
        continue;
      }

      seen.add(normalized);
      result.push(normalized);
    }
  }

  return result;
}

function normalizeJsonLikeText(raw: string): string {
  const withoutComments = raw
    .replace(/\/\*[\s\S]*?\*\//g, "")
    .replace(/(^|[^:])\/\/.*$/gm, "$1");

  return withoutComments
    .trim()
    .replace(/^[\u201c\u201d]/g, "\"")
    .replace(/[\u201c\u201d]/g, "\"")
    .replace(/[\u2018\u2019]/g, "'")
    .replace(/\bTrue\b/g, "true")
    .replace(/\bFalse\b/g, "false")
    .replace(/\bNone\b/g, "null")
    .replace(/([{,]\s*)([A-Za-z_\u4e00-\u9fa5][A-Za-z0-9_\-\u4e00-\u9fa5]*)(\s*:)/g, "$1\"$2\"$3")
    .replace(/'([^'\\]*(?:\\.[^'\\]*)*)'/g, (_, inner: string) => `"${inner.replace(/"/g, "\\\"")}"`)
    .replace(/,\s*([}\]])/g, "$1");
}
