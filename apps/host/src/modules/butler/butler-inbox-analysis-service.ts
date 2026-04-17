import { existsSync, readFileSync } from "node:fs";
import path from "node:path";

import type {
  ButlerInboxItem,
  ButlerProfile,
  ButlerProject
} from "../../types/domain.js";
import type { WorkspaceService } from "../workspace/workspace-service.js";
import type { ButlerProfileService } from "./butler-profile-service.js";
import type { ButlerContextAggregator } from "./context-aggregator.js";
import type { ButlerAuthService } from "./butler-auth-service.js";
import type { SkillManagerService } from "../skills/skill-manager-service.js";
import type { SessionHistoryService } from "../sessions/session-history-service.js";
import type { SessionLiveRuntimeService } from "../sessions/session-live-runtime-service.js";
import type {
  PatrolSessionResult,
  ProviderAdapterRegistry
} from "./provider-adapter-registry.js";
import {
  buildButlerInboxAnalysisInstruction,
  type ButlerInboxExecutionInstruction
} from "./butler-inbox-instruction-adapter.js";
import { resolveButlerCodexBackgroundModel } from "./butler-codex-model-policy.js";
import { syncButlerWorkspaceContext } from "./butler-workspace-context.js";

const ANALYSIS_WAIT_TIMEOUT_MS = 20 * 60_000;
const ANALYSIS_WAIT_POLL_INTERVAL_MS = 2_000;
const ANALYSIS_RAW_DIAGNOSTIC_MAX_LINES = 8;

interface ButlerInboxAnalysisRawDiagnostic {
  rawStoreRef: string | null;
  terminalEventType: string | null;
  terminalLastAgentMessage: string | null;
  recentEvents: string[];
}

interface ButlerInboxAnalysisSessionResult extends PatrolSessionResult {
  rawDiagnostic: ButlerInboxAnalysisRawDiagnostic | null;
}

export class ButlerInboxAnalysisService {
  constructor(
    private readonly butlerProfileService: Pick<ButlerProfileService, "ensureInitialized">,
    private readonly workspaceService: Pick<WorkspaceService, "importWorkspace">,
    private readonly butlerContextAggregator: Pick<ButlerContextAggregator, "resolvePromptContext">,
    private readonly butlerAuthService: Pick<ButlerAuthService, "ensureWorkspaceCredential" | "getCredentialFilePath">,
    private readonly skillManagerService: Pick<SkillManagerService, "getOverview" | "importUnmanagedSkill">,
    private readonly sessionHistoryService: Pick<SessionHistoryService, "readRecentHistoryEnvelope">
      & Partial<Pick<SessionHistoryService, "getSession">>,
    private readonly sessionLiveRuntimeService: Pick<SessionLiveRuntimeService, "getSessionRuntime">,
    private readonly providerAdapterRegistry: ProviderAdapterRegistry,
    private readonly codexHomeDir: string | null,
    private readonly sourceCodexHomeDir: string | null,
    private readonly claudeCodeHomeDir: string | null
  ) {}

  async prepareTodoAnalysisSession(
    item: ButlerInboxItem,
    project: ButlerProject,
    userId: string
  ): Promise<{
    providerId: ButlerProfile["providerId"];
    title: string;
    prompt: string;
    model: string | null;
    reasoningLevel: string;
    permissionMode: string;
    instructionFilePath: string | null;
  }> {
    const profile = this.butlerProfileService.ensureInitialized();
    const promptContext = await this.butlerContextAggregator.resolvePromptContext(
      userId,
      [project.name, item.title, item.content].filter((value) => value.trim().length > 0).join("\n")
    );

    syncButlerWorkspaceContext({
      profile,
      promptContext,
      userId,
      butlerAuthService: this.butlerAuthService,
      skillManagerService: this.skillManagerService,
      codexHomeDir: this.codexHomeDir,
      sourceCodexHomeDir: this.sourceCodexHomeDir,
      claudeCodeHomeDir: this.claudeCodeHomeDir
    });

    const workspace = this.workspaceService.importWorkspace(profile.workspacePath, "代码助手");
    const instruction = buildButlerInboxAnalysisInstruction({
      providerId: profile.providerId,
      item,
      project
    });

    return {
      providerId: profile.providerId,
      title: `分析代办：${item.title}`,
      prompt: instruction.prompt,
      model: resolveAnalysisModel(profile, this.sourceCodexHomeDir),
      reasoningLevel: "medium",
      permissionMode: "default",
      instructionFilePath: resolveButlerInstructionFilePath(profile.providerId, profile.workspacePath)
    };
  }

  async readTodoAnalysisResult(
    sessionId: string,
    providerId: ButlerProfile["providerId"],
    userId: string
  ): Promise<ButlerInboxExecutionInstruction> {
    await this.waitForAnalysisSessionTerminal(sessionId, userId);
    const result = await this.readAnalysisResultFromSessionHistory(sessionId, userId);
    return parseInboxAnalysisResult(result);
  }

  async analyzeTodo(
    item: ButlerInboxItem,
    project: ButlerProject,
    userId: string
  ): Promise<ButlerInboxExecutionInstruction> {
    const prepared = await this.prepareTodoAnalysisSession(item, project, userId);
    const workspace = this.workspaceService.importWorkspace(
      this.butlerProfileService.ensureInitialized().workspacePath,
      "代码助手"
    );
    const adapter = this.providerAdapterRegistry.get(prepared.providerId);
    const launch = await adapter.startPatrolSession({
      workspaceId: workspace.id,
      userId,
      providerId: prepared.providerId,
      prompt: prepared.prompt,
      model: prepared.model,
      reasoningLevel: prepared.reasoningLevel,
      permissionMode: prepared.permissionMode,
      instructionFilePath: prepared.instructionFilePath
    });

    return this.readTodoAnalysisResult(launch.sessionId, prepared.providerId, userId);
  }

  private async waitForAnalysisSessionTerminal(sessionId: string, userId: string): Promise<void> {
    const startedAt = Date.now();

    while (Date.now() - startedAt < ANALYSIS_WAIT_TIMEOUT_MS) {
      const runtime = await this.sessionLiveRuntimeService.getSessionRuntime(sessionId, userId);

      if (isTerminalRuntimeState(runtime.runningState)) {
        return;
      }

      await delay(ANALYSIS_WAIT_POLL_INTERVAL_MS);
    }

    throw new Error(`BUTLER_INBOX_ANALYSIS_WAIT_TIMEOUT:${sessionId}`);
  }

  private async readAnalysisResultFromSessionHistory(
    sessionId: string,
    userId: string
  ): Promise<ButlerInboxAnalysisSessionResult> {
    const history = await this.sessionHistoryService.readRecentHistoryEnvelope(sessionId, 80);
    const assistantMessages =
      history?.messages
        .filter((message) => message.role === "assistant" && message.kind === "text")
        .map((message) => message.content.trim())
        .filter((message) => message.length > 0) ?? [];
    const latestAssistantMessage = assistantMessages.at(-1) ?? null;

    return {
      assistantMessages,
      latestAssistantMessage,
      structured: {
        summary: null,
        riskLevel: null,
        suggestions: [],
        progressState: "unknown",
        riskFlags: [],
        nextActions: [],
        rawJson: findStructuredJsonCandidate(assistantMessages)
      },
      rawDiagnostic: this.readRawDiagnostic(sessionId, userId)
    };
  }

  private readRawDiagnostic(
    sessionId: string,
    userId: string
  ): ButlerInboxAnalysisRawDiagnostic | null {
    const getSession = this.sessionHistoryService.getSession;

    if (!getSession) {
      return null;
    }

    try {
      const session = getSession.call(this.sessionHistoryService, sessionId, userId);
      const rawStoreRef = session.rawStoreRef?.trim() || null;

      if (!rawStoreRef) {
        return null;
      }

      if (!existsSync(rawStoreRef)) {
        return {
          rawStoreRef,
          terminalEventType: null,
          terminalLastAgentMessage: null,
          recentEvents: ["raw_store_missing"]
        };
      }

      const lines = readFileSync(rawStoreRef, "utf8")
        .split(/\r?\n/)
        .map((line) => line.trim())
        .filter((line) => line.length > 0);
      const recentRecords = lines
        .slice(-ANALYSIS_RAW_DIAGNOSTIC_MAX_LINES)
        .map((line) => {
          try {
            return JSON.parse(line) as Record<string, unknown>;
          } catch {
            return null;
          }
        })
        .filter((record): record is Record<string, unknown> => record !== null);
      const terminalRecord = [...recentRecords].reverse().find((record) => {
        return record.type === "event_msg"
          && typeof record.payload === "object"
          && record.payload !== null
          && (record.payload as Record<string, unknown>).type !== undefined
          && ["task_complete", "task_failed"].includes(
            String((record.payload as Record<string, unknown>).type)
          );
      }) ?? null;
      const terminalPayload =
        terminalRecord && typeof terminalRecord.payload === "object" && terminalRecord.payload !== null
          ? terminalRecord.payload as Record<string, unknown>
          : null;

      return {
        rawStoreRef,
        terminalEventType: typeof terminalPayload?.type === "string" ? terminalPayload.type : null,
        terminalLastAgentMessage: normalizeDiagnosticText(
          terminalPayload?.last_agent_message ?? terminalPayload?.lastAgentMessage
        ),
        recentEvents: recentRecords.map((record) => summarizeRawDiagnosticRecord(record))
      };
    } catch {
      return null;
    }
  }
}

function isTerminalRuntimeState(state: string | null): boolean {
  return state === "idle" || state === "completed" || state === "failed" || state === "interrupted";
}

function delay(timeoutMs: number): Promise<void> {
  return new Promise((resolve) => {
    setTimeout(resolve, timeoutMs);
  });
}

function parseInboxAnalysisResult(result: ButlerInboxAnalysisSessionResult): ButlerInboxExecutionInstruction {
  const rawJson =
    result.structured.rawJson
    ?? findStructuredJsonCandidate(result.assistantMessages)
    ?? extractJsonFromText(result.latestAssistantMessage);

  if (!rawJson) {
    throw new Error(buildMissingStructuredJsonDetail(result));
  }

  let parsed: Record<string, unknown>;

  try {
    parsed = JSON.parse(rawJson) as Record<string, unknown>;
  } catch (error) {
    throw new Error(
      `代办分析助手返回的 JSON 无法解析：${error instanceof Error ? error.message : String(error)}；${buildAnalysisReturnEvidence(result)}`
    );
  }

  const analysisSummary = normalizeRequiredString(parsed.analysisSummary, "analysisSummary");
  const prompt = normalizeRequiredString(parsed.generatedPrompt, "generatedPrompt");
  const followUpObjective = normalizeRequiredString(parsed.followUpObjective, "followUpObjective");
  const completionCriteria = normalizeRequiredString(parsed.completionCriteria, "completionCriteria");
  const cliEvidence = normalizeStringArray(parsed.cliEvidence);

  if (cliEvidence.length < 2) {
    throw new Error("代办分析助手没有提供足够的 CLI 查询证据");
  }

  return {
    analysisSummary,
    prompt,
    followUpObjective,
    completionCriteria
  };
}

function normalizeRequiredString(value: unknown, field: string): string {
  if (typeof value !== "string" || value.trim().length === 0) {
    throw new Error(`代办分析助手返回的 ${field} 为空`);
  }

  return value.trim();
}

function normalizeStringArray(value: unknown): string[] {
  if (!Array.isArray(value)) {
    return [];
  }

  return value
    .filter((item): item is string => typeof item === "string")
    .map((item) => item.trim())
    .filter((item) => item.length > 0);
}

function buildMissingStructuredJsonDetail(result: ButlerInboxAnalysisSessionResult): string {
  return `代办分析助手没有返回结构化 JSON；${buildAnalysisReturnEvidence(result)}`;
}

function buildAnalysisReturnEvidence(result: ButlerInboxAnalysisSessionResult): string {
  const details: string[] = [];
  const assistantExcerpt = buildAssistantExcerpt(result.assistantMessages, result.latestAssistantMessage);

  if (assistantExcerpt) {
    details.push(`最近 assistant 输出：${assistantExcerpt}`);
  } else {
    details.push("最近 assistant 输出为空");
  }

  if (result.rawDiagnostic?.terminalEventType) {
    const terminalDetail =
      result.rawDiagnostic.terminalLastAgentMessage
        ? `${result.rawDiagnostic.terminalEventType}，last_agent_message=${clipDiagnosticText(result.rawDiagnostic.terminalLastAgentMessage)}`
        : `${result.rawDiagnostic.terminalEventType}，last_agent_message=null`;
    details.push(`raw 终态：${terminalDetail}`);
  }

  if ((result.rawDiagnostic?.recentEvents.length ?? 0) > 0) {
    details.push(`最近 raw 事件：${result.rawDiagnostic!.recentEvents.join(" -> ")}`);
  }

  if (result.rawDiagnostic?.rawStoreRef) {
    details.push(`rawStoreRef=${result.rawDiagnostic.rawStoreRef}`);
  }

  return details.join("；");
}

function buildAssistantExcerpt(messages: string[], latestAssistantMessage: string | null): string | null {
  const candidate = latestAssistantMessage ?? messages.at(-1) ?? null;
  return candidate ? clipDiagnosticText(candidate) : null;
}

function clipDiagnosticText(value: string): string {
  const normalized = value.replace(/\s+/g, " ").trim();

  if (normalized.length <= 220) {
    return normalized;
  }

  return `${normalized.slice(0, 217)}...`;
}

function normalizeDiagnosticText(value: unknown): string | null {
  if (typeof value !== "string") {
    return null;
  }

  const normalized = value.trim();
  return normalized.length > 0 ? normalized : null;
}

function summarizeRawDiagnosticRecord(record: Record<string, unknown>): string {
  if (record.type === "event_msg" && typeof record.payload === "object" && record.payload !== null) {
    const payload = record.payload as Record<string, unknown>;
    const eventType = typeof payload.type === "string" ? payload.type : "unknown_event";
    return `event:${eventType}`;
  }

  if (record.type === "response_item" && typeof record.payload === "object" && record.payload !== null) {
    const payload = record.payload as Record<string, unknown>;
    const itemType = typeof payload.type === "string" ? payload.type : "unknown_item";
    const role = typeof payload.role === "string" ? payload.role : null;
    return role ? `item:${itemType}:${role}` : `item:${itemType}`;
  }

  if (typeof record.type === "string") {
    return `record:${record.type}`;
  }

  return "record:unknown";
}

function extractJsonFromText(value: string | null): string | null {
  if (!value) {
    return null;
  }

  const candidates = extractJsonCandidatesFromText(value);

  for (const candidate of candidates) {
    try {
      JSON.parse(candidate);
      return candidate;
    } catch {
      continue;
    }
  }

  return null;
}

function findStructuredJsonCandidate(messages: string[]): string | null {
  for (let index = messages.length - 1; index >= 0; index -= 1) {
    const candidate = extractJsonFromText(messages[index] ?? null);

    if (candidate) {
      return candidate;
    }
  }

  return null;
}

function extractJsonCandidatesFromText(value: string): string[] {
  const trimmed = value.trim();
  const candidates: string[] = [];
  const seen = new Set<string>();

  const appendCandidate = (candidate: string | null): void => {
    const normalized = candidate?.trim() ?? "";

    if (normalized.length === 0 || seen.has(normalized)) {
      return;
    }

    seen.add(normalized);
    candidates.push(normalized);
  };

  const fencedMatches = trimmed.matchAll(/```(?:json)?\s*([\s\S]*?)```/gi);

  for (const match of fencedMatches) {
    appendCandidate(match[1] ?? null);
  }

  if (trimmed.startsWith("{") && trimmed.endsWith("}")) {
    appendCandidate(trimmed);
  }

  appendCandidate(extractBalancedJsonObject(trimmed));

  return candidates;
}

function extractBalancedJsonObject(value: string): string | null {
  let depth = 0;
  let start = -1;
  let inString = false;
  let escaped = false;

  for (let index = 0; index < value.length; index += 1) {
    const char = value[index];

    if (escaped) {
      escaped = false;
      continue;
    }

    if (char === "\\") {
      escaped = true;
      continue;
    }

    if (char === "\"") {
      inString = !inString;
      continue;
    }

    if (inString) {
      continue;
    }

    if (char === "{") {
      if (depth === 0) {
        start = index;
      }

      depth += 1;
      continue;
    }

    if (char !== "}") {
      continue;
    }

    if (depth === 0) {
      continue;
    }

    depth -= 1;

    if (depth === 0 && start >= 0) {
      return value.slice(start, index + 1);
    }
  }

  return null;
}

function resolveAnalysisModel(
  profile: Pick<ButlerProfile, "providerId">,
  sourceCodexHomeDir: string | null
): string | null {
  if (profile.providerId !== "codex") {
    return null;
  }

  return resolveButlerCodexBackgroundModel("gpt-5.1-codex-mini", sourceCodexHomeDir);
}

function resolveButlerInstructionFilePath(
  providerId: ButlerProfile["providerId"],
  workspacePath: string
): string | null {
  return providerId === "claude-code"
    ? path.resolve(workspacePath, "CLAUDE.md")
    : path.resolve(workspacePath, "AGENTS.md");
}
