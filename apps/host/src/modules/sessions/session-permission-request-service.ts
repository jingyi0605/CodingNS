import { join } from "node:path";

import type { ProviderId } from "@codingns/session-sync-core";

import type { HostConfig } from "../../config/env.js";
import { AppError } from "../../shared/errors/app-error.js";
import { logPermissionDebug } from "../../shared/utils/permission-debug-log.js";
import { createId } from "../../shared/utils/id.js";
import { nowIso } from "../../shared/utils/time.js";
import type { AuthUserRepository } from "../../storage/repositories/auth-user-repository.js";
import type { SessionBindingRepository } from "../../storage/repositories/session-binding-repository.js";
import type { SessionListItem } from "../../types/domain.js";
import type { WorkspaceService } from "../workspace/workspace-service.js";
import type { SessionHistoryService } from "./session-history-service.js";

export type SessionPermissionRequestKind =
  | "tool_call"
  | "command"
  | "file_change"
  | "permissions"
  | "user_input";
export type SessionPermissionRequestStatus =
  | "pending"
  | "approved"
  | "declined"
  | "cancelled"
  | "expired";
export type SessionPermissionRequestActionTone = "primary" | "neutral" | "danger";

export interface SessionPermissionRequestActionView {
  value: string;
  label: string;
  tone: SessionPermissionRequestActionTone;
  description: string | null;
}

export interface SessionPermissionRequestQuestionOptionView {
  label: string;
  description: string | null;
}

export interface SessionPermissionRequestQuestionView {
  id: string;
  header: string;
  question: string;
  allowOther: boolean;
  secret: boolean;
  options: SessionPermissionRequestQuestionOptionView[];
}

export interface SessionPermissionProfileView {
  readPaths: string[];
  writePaths: string[];
  networkEnabled: boolean | null;
}

export interface SessionPermissionRequestView {
  id: string;
  sessionId: string;
  provider: ProviderId;
  providerSessionId: string;
  requestKey: string;
  kind: SessionPermissionRequestKind;
  status: SessionPermissionRequestStatus;
  title: string;
  summary: string;
  detail: string | null;
  reason: string | null;
  toolName: string | null;
  command: string | null;
  cwd: string | null;
  paths: string[];
  permissionProfile: SessionPermissionProfileView | null;
  questions: SessionPermissionRequestQuestionView[];
  actions: SessionPermissionRequestActionView[];
  rawPayload: string | null;
  createdAt: string;
  updatedAt: string;
  resolvedAt: string | null;
}

export interface SessionPermissionReplyInput {
  action: string;
  answers?: Record<string, string[]>;
}

export interface SessionPermissionRequestEnvelope {
  type: "session.permission_request";
  sessionId: string;
  request: SessionPermissionRequestView;
}

export interface SessionPermissionRequestResolvedEnvelope {
  type: "session.permission_request_resolved";
  sessionId: string;
  request: SessionPermissionRequestView;
}

export type SessionPermissionEnvelope =
  | SessionPermissionRequestEnvelope
  | SessionPermissionRequestResolvedEnvelope;

interface SessionPermissionRequestInternalRecord extends SessionPermissionRequestView {
  source:
    | {
        kind: "claude-pre-tool-use";
        resolve: (decision: ClaudePreToolUseDecision) => void;
        timer: ReturnType<typeof setTimeout> | null;
      }
    | {
        kind: "opencode";
        permissionId: string;
        baseUrl: string;
      }
    | {
        kind: "codex-app-server";
        method: string;
        resolve?: (response: unknown) => void;
      };
}

interface ClaudePreToolUseDecision {
  action: "allow" | "deny" | "ask";
  answers?: Record<string, string[]>;
}

interface ClaudePreToolUseResult {
  accepted: boolean;
  ignored: boolean;
  sessionId: string | null;
  bridgeResponse: Record<string, unknown> | null;
}

interface ClaudeHookPermissionPayload {
  session_id?: string;
  transcript_path?: string;
  cwd?: string;
  tool_name?: string;
  tool_input?: unknown;
  permission_suggestions?: unknown;
  reason?: string;
  hook_event_name?: string;
}

interface OpenCodePermissionRecord {
  id?: unknown;
  type?: unknown;
  permission?: unknown;
  pattern?: unknown;
  patterns?: unknown;
  sessionID?: unknown;
  messageID?: unknown;
  callID?: unknown;
  title?: unknown;
  metadata?: unknown;
  time?: unknown;
  always?: unknown;
  tool?: unknown;
}

interface OpenCodeSessionSummary {
  id?: unknown;
  directory?: unknown;
}

interface OpenCodePermissionFetchResult {
  permission: OpenCodePermissionRecord;
  baseUrl: string;
}

interface CodexServerRequest {
  id?: unknown;
  method?: unknown;
  params?: unknown;
}

interface CodexCommandActionRecord {
  type?: unknown;
  command?: unknown;
  name?: unknown;
  path?: unknown;
  query?: unknown;
}

const CLAUDE_PRE_TOOL_USE_TIMEOUT_MS = 90_000;
const OPENCODE_RECONNECT_DELAY_MS = 1_500;

export class SessionPermissionRequestService {
  private readonly requestsById = new Map<string, SessionPermissionRequestInternalRecord>();
  private readonly requestIdsBySessionId = new Map<string, string[]>();
  private readonly opencodeWatcherAbortControllers = new Map<string, AbortController>();
  private readonly claudeAllowedScopeKeysBySessionId = new Map<string, Set<string>>();

  constructor(
    private readonly sessionHistoryService: SessionHistoryService,
    private readonly sessionBindingRepository: SessionBindingRepository,
    private readonly authUserRepository: AuthUserRepository,
    private readonly workspaceService: WorkspaceService,
    private readonly config: HostConfig,
    private readonly emitEnvelope: (envelope: SessionPermissionEnvelope) => Promise<void> | void,
    private readonly resolveActiveClaudeSession?: (input: {
      providerSessionId: string;
      workspaceId: string;
      workspacePath: string;
      transcriptPath: string | null;
    }) => Promise<{ sessionId: string; rawStoreRef: string } | null>
  ) {}

  async dispose(): Promise<void> {
    for (const controller of this.opencodeWatcherAbortControllers.values()) {
      controller.abort();
    }
    this.opencodeWatcherAbortControllers.clear();

    for (const request of this.requestsById.values()) {
      if (request.source.kind === "claude-pre-tool-use" && request.source.timer) {
        clearTimeout(request.source.timer);
      }
    }

    this.requestsById.clear();
    this.requestIdsBySessionId.clear();
    this.claudeAllowedScopeKeysBySessionId.clear();
  }

  async listSessionPermissionRequests(
    sessionId: string,
    userId: string
  ): Promise<SessionPermissionRequestView[]> {
    const session = this.sessionHistoryService.getSession(sessionId, userId);

    if (session.provider === "opencode") {
      await this.startOpenCodeWatchers(session);
      await this.refreshOpenCodePermissionRequests(session).catch(() => {
        return;
      });
    }

    const requests = this.getSessionRequestViews(sessionId);
    logPermissionDebug("permission_request.list", {
      sessionId,
      provider: session.provider,
      count: requests.length
    });
    return requests;
  }

  async replyToSessionPermissionRequest(
    sessionId: string,
    userId: string,
    requestId: string,
    input: SessionPermissionReplyInput
  ): Promise<SessionPermissionRequestView> {
    this.sessionHistoryService.getSession(sessionId, userId);
    const request = this.getRequestOrThrow(sessionId, requestId);

    if (request.status !== "pending") {
      throw new AppError({
        statusCode: 409,
        errorCode: "PERMISSION_REQUEST_ALREADY_RESOLVED",
        detail: "该权限申请已经处理过了",
        field: "requestId"
      });
    }

    if (request.source.kind === "claude-pre-tool-use") {
      const action = normalizeText(input.action);

      if (action !== "allow" && action !== "allow_session" && action !== "deny") {
        throw new AppError({
          statusCode: 400,
          errorCode: "INVALID_INPUT",
        detail: "Claude 权限申请只支持 allow、allow_session 或 deny",
          field: "action"
        });
      }

      if (request.source.timer) {
        clearTimeout(request.source.timer);
      }

      if (action === "allow_session") {
        this.addClaudeAllowedScopeKey(request);
        logPermissionDebug("claude_permission.pre_tool_use.session_default_allow", {
          sessionId: request.sessionId,
          providerSessionId: request.providerSessionId,
          requestId: request.id,
          scopeKey: buildClaudeAllowedScopeKey(request)
        });
      }

      request.source.resolve({
        action: action === "deny" ? "deny" : "allow"
      });
      return await this.markResolved(
        request,
        action === "deny" ? "declined" : "approved"
      );
    }

    if (request.source.kind === "opencode") {
      const action = normalizeText(input.action);

      if (action !== "once" && action !== "always" && action !== "reject") {
        throw new AppError({
          statusCode: 400,
          errorCode: "INVALID_INPUT",
          detail: "OpenCode 权限申请只支持 once、always 或 reject",
          field: "action"
        });
      }

      await this.replyToOpenCodePermission(
        request.source.baseUrl,
        request.providerSessionId,
        request.source.permissionId,
        action
      );
      return await this.markResolved(
        request,
        action === "reject" ? "declined" : "approved"
      );
    }

    const responsePayload = buildCodexServerRequestResponsePayload(request, input);

    if (!request.source.resolve) {
      throw new AppError({
        statusCode: 409,
        errorCode: "PERMISSION_REQUEST_REPLY_NOT_SUPPORTED",
        detail: "当前 Codex 请求没有挂起中的回写通道",
        field: "requestId"
      });
    }

    request.source.resolve(responsePayload);
    return await this.markResolved(
      request,
      resolveCodexReplyStatus(request.kind, input.action)
    );
  }

  async handleClaudePreToolUse(
    payload: ClaudeHookPermissionPayload
  ): Promise<ClaudePreToolUseResult> {
    logPermissionDebug("claude_permission.pre_tool_use.begin", {
      providerSessionId: payload.session_id ?? null,
      cwd: payload.cwd ?? null,
      toolName: payload.tool_name ?? null,
      transcriptPath: payload.transcript_path ?? null
    });
    const providerSessionId = requireNonEmptyText(payload.session_id, "session_id");
    const workspacePath = requireNonEmptyText(payload.cwd, "cwd");
    const workspace = this.workspaceService.findWorkspaceByPath(workspacePath);

    if (!workspace) {
      logPermissionDebug("claude_permission.pre_tool_use.workspace_not_found", {
        providerSessionId,
        cwd: workspacePath
      });
      return {
        accepted: true,
        ignored: true,
        sessionId: null,
        bridgeResponse: buildClaudePreToolUseBridgeResponse("ask", "未匹配到工作区，回退 Claude 原生确认")
      };
    }

    const transcriptPath = normalizeText(payload.transcript_path) || null;
    const binding =
      await this.resolveClaudeBinding(
      providerSessionId,
      workspace.id,
      workspace.path,
      transcriptPath
    ).catch(() => null)
      ?? this.resolveClaudeWorkspaceSessionFallback({
        providerSessionId,
        workspaceId: workspace.id,
        workspacePath: workspace.path,
        transcriptPath
      })
      ?? (this.resolveActiveClaudeSession
        ? await this.resolveActiveClaudeSession({
            providerSessionId,
            workspaceId: workspace.id,
            workspacePath: workspace.path,
            transcriptPath
          }).catch(() => null)
        : null);

    logPermissionDebug("claude_permission.pre_tool_use.binding_resolution", {
      providerSessionId,
      workspaceId: workspace.id,
      sessionId: binding?.sessionId ?? null,
      rawStoreRef: binding?.rawStoreRef ?? null
    });

    if (!binding) {
      logPermissionDebug("claude_permission.pre_tool_use.binding_missing", {
        providerSessionId,
        workspaceId: workspace.id
      });
      return {
        accepted: true,
        ignored: true,
        sessionId: null,
        bridgeResponse: buildClaudePreToolUseBridgeResponse(
          "ask",
          "CodingNS 未找到会话绑定，回退 Claude 原生确认"
        )
      };
    }

    const now = nowIso();
    const normalized = normalizeClaudePreToolUseRequest({
      sessionId: binding.sessionId,
      providerSessionId,
      payload,
      createdAt: now
    });

    const allowedScopeKey = buildClaudeAllowedScopeKey(normalized);

    if (allowedScopeKey && this.isClaudeScopeAllowed(binding.sessionId, allowedScopeKey)) {
      logPermissionDebug("claude_permission.pre_tool_use.auto_allow_session", {
        sessionId: binding.sessionId,
        providerSessionId,
        toolName: payload.tool_name ?? null,
        scopeKey: allowedScopeKey
      });
      return {
        accepted: true,
        ignored: false,
        sessionId: binding.sessionId,
        bridgeResponse: buildClaudePreToolUseBridgeResponse(
          "allow",
          "CodingNS 已按本会话默认允许自动放行"
        )
      };
    }

    let resolvedByTimeout = false;

    const decision = await new Promise<ClaudePreToolUseDecision>((resolve) => {
      const timer = setTimeout(() => {
        resolvedByTimeout = true;
        resolve({ action: "ask" });
      }, CLAUDE_PRE_TOOL_USE_TIMEOUT_MS);
      const record: SessionPermissionRequestInternalRecord = {
        ...normalized,
        source: {
          kind: "claude-pre-tool-use",
          resolve,
          timer
        }
      };

      this.upsertRequest(record);
      logPermissionDebug("claude_permission.pre_tool_use.request_created", {
        requestId: record.id,
        sessionId: binding.sessionId,
        providerSessionId,
        title: record.title,
        kind: record.kind
      });
      void this.emitEnvelope({
        type: "session.permission_request",
        sessionId: binding.sessionId,
        request: this.toRequestView(record)
      });
    });

    if (decision.action === "ask") {
      const existing = this.requestsById.get(normalized.id);

      if (existing) {
        await this.markResolved(existing, "expired");
      }
    }

    return {
      accepted: true,
      ignored: false,
      sessionId: binding.sessionId,
      bridgeResponse: buildClaudePreToolUseBridgeResponse(
        decision.action,
        buildClaudeDecisionReason(decision.action, normalized.title, resolvedByTimeout)
      )
    };
  }

  async handleClaudePermissionRequest(
    payload: ClaudeHookPermissionPayload
  ): Promise<ClaudePreToolUseResult> {
    logPermissionDebug("claude_permission.permission_request.begin", {
      providerSessionId: payload.session_id ?? null,
      cwd: payload.cwd ?? null,
      toolName: payload.tool_name ?? null,
      transcriptPath: payload.transcript_path ?? null,
      suggestions: payload.permission_suggestions ?? null
    });
    const providerSessionId = requireNonEmptyText(payload.session_id, "session_id");
    const workspacePath = requireNonEmptyText(payload.cwd, "cwd");
    const workspace = this.workspaceService.findWorkspaceByPath(workspacePath);

    if (!workspace) {
      logPermissionDebug("claude_permission.permission_request.workspace_not_found", {
        providerSessionId,
        cwd: workspacePath
      });
      return {
        accepted: true,
        ignored: true,
        sessionId: null,
        bridgeResponse: buildClaudePermissionRequestBridgeResponse(
          "deny",
          "未匹配到工作区，拒绝本次权限申请"
        )
      };
    }

    const transcriptPath = normalizeText(payload.transcript_path) || null;
    const binding =
      await this.resolveClaudeBinding(
        providerSessionId,
        workspace.id,
        workspace.path,
        transcriptPath
      ).catch(() => null)
      ?? this.resolveClaudeWorkspaceSessionFallback({
        providerSessionId,
        workspaceId: workspace.id,
        workspacePath: workspace.path,
        transcriptPath
      })
      ?? (this.resolveActiveClaudeSession
        ? await this.resolveActiveClaudeSession({
            providerSessionId,
            workspaceId: workspace.id,
            workspacePath: workspace.path,
            transcriptPath
          }).catch(() => null)
        : null);

    logPermissionDebug("claude_permission.permission_request.binding_resolution", {
      providerSessionId,
      workspaceId: workspace.id,
      sessionId: binding?.sessionId ?? null,
      rawStoreRef: binding?.rawStoreRef ?? null
    });

    if (!binding) {
      logPermissionDebug("claude_permission.permission_request.binding_missing", {
        providerSessionId,
        workspaceId: workspace.id
      });
      return {
        accepted: true,
        ignored: true,
        sessionId: null,
        bridgeResponse: buildClaudePermissionRequestBridgeResponse(
          "deny",
          "CodingNS 未找到会话绑定，拒绝本次权限申请"
        )
      };
    }

    const now = nowIso();
    const normalized = normalizeClaudePreToolUseRequest({
      sessionId: binding.sessionId,
      providerSessionId,
      payload,
      createdAt: now
    });
    let resolvedByTimeout = false;

    const decision = await new Promise<ClaudePreToolUseDecision>((resolve) => {
      const timer = setTimeout(() => {
        resolvedByTimeout = true;
        resolve({ action: "deny" });
      }, CLAUDE_PRE_TOOL_USE_TIMEOUT_MS);
      const record: SessionPermissionRequestInternalRecord = {
        ...normalized,
        source: {
          kind: "claude-pre-tool-use",
          resolve,
          timer
        }
      };

      this.upsertRequest(record);
      logPermissionDebug("claude_permission.permission_request.request_created", {
        requestId: record.id,
        sessionId: binding.sessionId,
        providerSessionId,
        title: record.title,
        kind: record.kind
      });
      void this.emitEnvelope({
        type: "session.permission_request",
        sessionId: binding.sessionId,
        request: this.toRequestView(record)
      });
    });

    const status = decision.action === "allow" ? "approved" : "declined";
    const existing = this.requestsById.get(normalized.id);

    if (existing) {
      await this.markResolved(existing, resolvedByTimeout ? "expired" : status);
    }

    return {
      accepted: true,
      ignored: false,
      sessionId: binding.sessionId,
      bridgeResponse: buildClaudePermissionRequestBridgeResponse(
        decision.action === "allow" ? "allow" : "deny",
        decision.action === "allow"
          ? "CodingNS 已批准本次权限申请"
          : resolvedByTimeout
            ? "CodingNS 审批超时，拒绝本次权限申请"
            : "CodingNS 已拒绝本次权限申请"
      )
    };
  }

  ingestCodexServerRequest(
    sessionId: string,
    providerSessionId: string,
    request: CodexServerRequest
  ): SessionPermissionRequestView | null {
    const normalized = normalizeCodexServerRequest(sessionId, providerSessionId, request);

    if (!normalized) {
      return null;
    }

    const record: SessionPermissionRequestInternalRecord = {
      ...normalized,
      source: {
        kind: "codex-app-server",
        method: normalizeText(request.method) || "unknown",
        resolve: () => undefined
      }
    };

    this.upsertRequest(record);
    void this.emitEnvelope({
      type: "session.permission_request",
      sessionId,
      request: this.toRequestView(record)
    });

    return this.toRequestView(record);
  }

  async handleCodexServerRequest(
    sessionId: string,
    providerSessionId: string,
    request: CodexServerRequest
  ): Promise<unknown> {
    const normalized = normalizeCodexServerRequest(sessionId, providerSessionId, request);

    if (!normalized) {
      throw new AppError({
        statusCode: 400,
        errorCode: "UNSUPPORTED_CODEX_SERVER_REQUEST",
        detail: "当前暂不支持这类 Codex app-server 请求"
      });
    }

    return await new Promise<unknown>((resolve) => {
      const record: SessionPermissionRequestInternalRecord = {
        ...normalized,
        source: {
          kind: "codex-app-server",
          method: normalizeText(request.method) || "unknown",
          resolve
        }
      };

      this.upsertRequest(record);
      void this.emitEnvelope({
        type: "session.permission_request",
        sessionId,
        request: this.toRequestView(record)
      });
    });
  }

  private async startOpenCodeWatchers(session: SessionListItem): Promise<void> {
    const workspacePath = this.workspaceService.getWorkspaceOrThrow(session.workspaceId).path;
    const baseUrls = await this.resolveOpenCodeBaseUrls(false, workspacePath);

    logPermissionDebug("opencode_permission.watchers.ensure", {
      sessionId: session.sessionId,
      providerSessionId: session.providerSessionId,
      workspacePath,
      baseUrls
    });

    for (const baseUrl of baseUrls) {
      if (this.opencodeWatcherAbortControllers.has(baseUrl)) {
        continue;
      }

      const controller = new AbortController();
      this.opencodeWatcherAbortControllers.set(baseUrl, controller);
      void this.consumeOpenCodeEvents(baseUrl, workspacePath, controller.signal)
        .finally(() => {
          if (this.opencodeWatcherAbortControllers.get(baseUrl) === controller) {
            this.opencodeWatcherAbortControllers.delete(baseUrl);
          }
        });
    }
  }

  private async consumeOpenCodeEvents(
    baseUrl: string,
    workspacePath: string,
    signal: AbortSignal
  ): Promise<void> {
    while (!signal.aborted) {
      try {
        logPermissionDebug("opencode_permission.watch.connecting", {
          baseUrl,
          workspacePath
        });
        const url = new URL("/event", `${baseUrl}/`);
        const response = await fetch(url, { signal });

        if (!response.body) {
          throw new Error("OPENCODE_EVENT_STREAM_UNAVAILABLE");
        }

        logPermissionDebug("opencode_permission.watch.connected", {
          baseUrl,
          workspacePath
        });

        const reader = response.body.getReader();
        const decoder = new TextDecoder();
        let buffer = "";

        try {
          while (!signal.aborted) {
            const next = await reader.read();

            if (next.done) {
              break;
            }

            buffer += decoder.decode(next.value, { stream: true });

            while (true) {
              const separatorIndex = buffer.indexOf("\n\n");

              if (separatorIndex < 0) {
                break;
              }

              const frame = buffer.slice(0, separatorIndex);
              buffer = buffer.slice(separatorIndex + 2);
              const payload = extractSseData(frame);

              if (!payload) {
                continue;
              }

              const rawEvent = JSON.parse(payload) as Record<string, unknown>;
              const event = unwrapOpenCodeEventPayload(rawEvent);

              if (!event) {
                continue;
              }

              await this.handleOpenCodeEvent(event, {
                baseUrl,
                workspacePath
              });
            }
          }
        } finally {
          reader.releaseLock();
        }
      } catch (error) {
        if (signal.aborted) {
          return;
        }

        logPermissionDebug("opencode_permission.watch.reconnect", {
          baseUrl,
          workspacePath,
          detail: error instanceof Error ? error.message : "unknown"
        });
        await waitForDelay(OPENCODE_RECONNECT_DELAY_MS, signal).catch(() => {
          return;
        });
      }
    }
  }

  private async handleOpenCodeEvent(
    event: Record<string, unknown>,
    input: {
      baseUrl: string;
      workspacePath: string;
    }
  ): Promise<void> {
    const eventType = normalizeText(event.type);
    logPermissionDebug("opencode_permission.event", {
      eventType,
      baseUrl: input.baseUrl,
      workspacePath: input.workspacePath
    });

    if (eventType === "permission.updated" || eventType === "permission.asked") {
      await this.handleOpenCodePermissionUpdated(event.properties, input);
      return;
    }

    if (eventType === "permission.replied") {
      const properties = toRecord(event.properties);
      const providerSessionId = normalizeText(properties?.sessionID);
      const requestKey =
        normalizeText(properties?.permissionID) ||
        normalizeText(properties?.requestID);

      if (!providerSessionId || !requestKey) {
        return;
      }

      const request = this.findRequestByKey("opencode", providerSessionId, requestKey);

      if (!request || request.status !== "pending") {
        return;
      }

      const response = normalizeText(properties?.response) || "reject";
      await this.markResolved(
        request,
        response === "reject" ? "declined" : "approved"
      );
    }
  }

  private async handleOpenCodePermissionUpdated(
    rawPermission: unknown,
    input: {
      baseUrl: string;
      workspacePath?: string | null;
    }
  ): Promise<void> {
    const permission = toRecord(rawPermission);
    const providerSessionId = normalizeText(permission?.sessionID);
    const requestKey = normalizeText(permission?.id);

    if (!permission || !providerSessionId || !requestKey) {
      logPermissionDebug("opencode_permission.updated.invalid_payload", {
        providerSessionId,
        requestKey,
        baseUrl: input.baseUrl,
        rawPermission
      });
      return;
    }

    const session = await this.resolveOpenCodeSession(providerSessionId, input);

    if (!session) {
      return;
    }

    const normalized = normalizeOpenCodePermissionRequest({
      sessionId: session.sessionId,
      providerSessionId,
      permission,
      createdAt: extractOpenCodePermissionCreatedAt(permission) ?? nowIso()
    });
    const existing = this.findRequestByKey("opencode", providerSessionId, requestKey);
    const record: SessionPermissionRequestInternalRecord = {
      ...(existing ?? normalized),
      ...normalized,
      id: existing?.id ?? normalized.id,
      createdAt: existing?.createdAt ?? normalized.createdAt,
      updatedAt: nowIso(),
      source: {
        kind: "opencode",
        permissionId: requestKey,
        baseUrl: input.baseUrl
      }
    };

    this.upsertRequest(record);
    logPermissionDebug("opencode_permission.request_created", {
      requestId: record.id,
      sessionId: session.sessionId,
      providerSessionId,
      requestKey,
      baseUrl: input.baseUrl,
      title: record.title,
      kind: record.kind
    });
    await this.emitEnvelope({
      type: "session.permission_request",
      sessionId: session.sessionId,
      request: this.toRequestView(record)
    });
  }

  private async refreshOpenCodePermissionRequests(session: SessionListItem): Promise<void> {
    const workspacePath = this.workspaceService.getWorkspaceOrThrow(session.workspaceId).path;
    const permissions = await this.fetchOpenCodePermissions(
      session.providerSessionId,
      workspacePath
    );
    logPermissionDebug("opencode_permission.refresh", {
      sessionId: session.sessionId,
      providerSessionId: session.providerSessionId,
      workspacePath,
      count: permissions.length,
      baseUrls: permissions.map((entry) => entry.baseUrl)
    });

    for (const entry of permissions) {
      await this.handleOpenCodePermissionUpdated(entry.permission, {
        baseUrl: entry.baseUrl,
        workspacePath
      });
    }
  }

  private async replyToOpenCodePermission(
    baseUrl: string,
    providerSessionId: string,
    permissionId: string,
    action: "once" | "always" | "reject"
  ): Promise<void> {
    const normalizedBaseUrl = `${baseUrl.replace(/\/+$/, "")}/`;
    const requests = [
      {
        url: new URL(`/permission/${encodeURIComponent(permissionId)}/reply`, normalizedBaseUrl),
        body: {
          reply: action
        }
      },
      {
        url: new URL(
          `/session/${encodeURIComponent(providerSessionId)}/permissions/${encodeURIComponent(permissionId)}`,
          normalizedBaseUrl
        ),
        body: {
          response: action
        }
      }
    ];

    for (const candidate of requests) {
      const response = await fetch(candidate.url, {
        method: "POST",
        headers: {
          "content-type": "application/json"
        },
        body: JSON.stringify(candidate.body)
      });

      if (response.ok) {
        return;
      }

      if (response.status !== 404) {
        throw new AppError({
          statusCode: 502,
          errorCode: "OPENCODE_PERMISSION_REPLY_FAILED",
          detail: (await safeReadResponseText(response)) || "OpenCode 权限回复失败"
        });
      }
    }

    throw new AppError({
      statusCode: 502,
      errorCode: "OPENCODE_PERMISSION_REPLY_FAILED",
      detail: "OpenCode 权限回复接口不存在"
    });
  }

  private async fetchOpenCodePermissions(
    providerSessionId: string,
    workspacePath: string
  ): Promise<OpenCodePermissionFetchResult[]> {
    const baseUrls = await this.resolveOpenCodeBaseUrls(false, workspacePath);
    const results: OpenCodePermissionFetchResult[] = [];
    const seenPermissionIds = new Set<string>();

    for (const baseUrl of baseUrls) {
      const candidates = [
        new URL(`/permission?sessionID=${encodeURIComponent(providerSessionId)}`, `${baseUrl}/`),
        new URL(`/session/${encodeURIComponent(providerSessionId)}/permissions`, `${baseUrl}/`)
      ];

      for (const url of candidates) {
        const response = await fetch(url);

        if (!response.ok) {
          if (response.status === 404) {
            continue;
          }

          logPermissionDebug("opencode_permission.fetch.failed", {
            providerSessionId,
            workspacePath,
            baseUrl,
            endpoint: url.pathname,
            status: response.status
          });
          break;
        }

        const payload = (await response.json()) as unknown;
        const permissions = Array.isArray(payload) ? (payload as OpenCodePermissionRecord[]) : [];

        for (const permission of permissions) {
          const permissionId = normalizeText(permission.id);

          if (!permissionId || seenPermissionIds.has(permissionId)) {
            continue;
          }

          seenPermissionIds.add(permissionId);
          results.push({
            permission,
            baseUrl
          });
        }

        logPermissionDebug("opencode_permission.fetch.success", {
          providerSessionId,
          workspacePath,
          baseUrl,
          endpoint: url.pathname,
          count: permissions.length
        });
        break;
      }
    }

    return results;
  }

  private async fetchOpenCodeSession(
    providerSessionId: string,
    baseUrl: string
  ): Promise<OpenCodeSessionSummary | null> {
    const url = new URL(`/session/${encodeURIComponent(providerSessionId)}`, `${baseUrl}/`);
    const response = await fetch(url);

    if (!response.ok) {
      return null;
    }

    return (await response.json()) as OpenCodeSessionSummary;
  }

  private async resolveOpenCodeSession(
    providerSessionId: string,
    input: {
      baseUrl: string;
      workspacePath?: string | null;
    }
  ): Promise<SessionListItem | null> {
    const binding = this.sessionBindingRepository.findByProviderSession("opencode", providerSessionId);

    if (binding) {
      const userId = this.authUserRepository.listIds()[0] ?? null;

      if (!userId) {
        return null;
      }

      return this.sessionHistoryService.getSession(binding.sessionId, userId);
    }

    const summary = await this.fetchOpenCodeSession(providerSessionId, input.baseUrl);
    const workspacePath = normalizeText(summary?.directory);

    if (!workspacePath) {
      return null;
    }

    const workspace = this.workspaceService.findWorkspaceByPath(workspacePath);
    const userId = this.authUserRepository.listIds()[0] ?? null;

    if (!workspace || !userId) {
      return null;
    }

    await this.sessionHistoryService.discoverWorkspaceSessions(workspace.id, userId, {
      force: true,
      refreshStateMode: "deferred"
    }).catch(() => {
      return;
    });

    const discoveredBinding =
      this.sessionBindingRepository.findByProviderSession("opencode", providerSessionId);

    if (!discoveredBinding) {
      return null;
    }

    return this.sessionHistoryService.getSession(discoveredBinding.sessionId, userId);
  }

  private resolveClaudeWorkspaceSessionFallback(input: {
    providerSessionId: string;
    workspaceId: string;
    workspacePath: string;
    transcriptPath: string | null;
  }): { sessionId: string; rawStoreRef: string } | null {
    const userId = this.authUserRepository.listIds()[0] ?? null;

    if (!userId) {
      return null;
    }

    const activeClaudeSessions = this.sessionHistoryService
      .listWorkspaceSessions(input.workspaceId, userId)
      .filter(
        (session) =>
          session.provider === "claude-code"
      );

    const preferredSession =
      activeClaudeSessions.find(
        (session) => session.runningState === "starting" || session.runningState === "running"
      )
      ?? [...activeClaudeSessions]
        .filter((session) => session.isArchived !== true)
        .sort((left, right) =>
          (right.lastEventAt ?? right.updatedAt ?? "").localeCompare(left.lastEventAt ?? left.updatedAt ?? "")
        )[0]
      ?? (activeClaudeSessions.length === 1 ? activeClaudeSessions[0] : null);

    if (!preferredSession) {
      return null;
    }

    const rawStoreRef =
      input.transcriptPath ??
      preferredSession.rawStoreRef ??
      buildClaudeRawStoreRef(this.config.claudeCodeHomeDir, input.workspacePath, input.providerSessionId);

    this.sessionHistoryService.persistSessionBinding(preferredSession.sessionId, input.workspaceId, {
      provider: "claude-code",
      providerSessionId: input.providerSessionId,
      rawStoreRef
    });

    return {
      sessionId: preferredSession.sessionId,
      rawStoreRef
    };
  }

  private async resolveClaudeBinding(
    providerSessionId: string,
    workspaceId: string,
    workspacePath: string,
    transcriptPath: string | null
  ): Promise<{ sessionId: string; rawStoreRef: string }> {
    const rawStoreRef =
      transcriptPath ??
      this.sessionBindingRepository.findByProviderSession("claude-code", providerSessionId)?.rawStoreRef ??
      buildClaudeRawStoreRef(this.config.claudeCodeHomeDir, workspacePath, providerSessionId);
    const existing =
      this.sessionBindingRepository.findByProviderSession("claude-code", providerSessionId) ??
      this.sessionBindingRepository.findByRawStoreRef("claude-code", rawStoreRef);

    if (existing) {
      return {
        sessionId: existing.sessionId,
        rawStoreRef: existing.rawStoreRef
      };
    }

    const userId = this.authUserRepository.listIds()[0] ?? null;

    if (userId) {
      await this.sessionHistoryService.discoverWorkspaceSessions(workspaceId, userId, {
        force: true,
        refreshStateMode: "deferred"
      }).catch(() => {
        return;
      });
    }

    const refreshed =
      this.sessionBindingRepository.findByProviderSession("claude-code", providerSessionId) ??
      this.sessionBindingRepository.findByRawStoreRef("claude-code", rawStoreRef);

    if (!refreshed) {
      throw new AppError({
        statusCode: 404,
        errorCode: "CLAUDE_SESSION_NOT_FOUND",
        detail: "没有找到对应的 Claude 会话绑定"
      });
    }

    return {
      sessionId: refreshed.sessionId,
      rawStoreRef: refreshed.rawStoreRef
    };
  }

  private async resolveOpenCodeBaseUrl(
    refresh: boolean,
    workspacePath?: string | null
  ): Promise<string> {
    const resolved = this.config.opencodeBaseUrlResolver
      ? await this.config.opencodeBaseUrlResolver.resolve({
          refresh,
          workspacePath
        })
      : this.config.opencodeBaseUrl;
    const normalized = resolved?.trim() ?? "";

    if (!normalized) {
      throw new Error("OPENCODE_BASE_URL_UNAVAILABLE");
    }

    return normalized.replace(/\/+$/, "");
  }

  private async resolveOpenCodeBaseUrls(
    refresh: boolean,
    workspacePath?: string | null
  ): Promise<string[]> {
    const resolver = this.config.opencodeBaseUrlResolver;

    if (resolver) {
      const reachable = await resolver.listReachableBaseUrls({
        refresh,
        workspacePath
      });

      if (reachable.length > 0) {
        return reachable.map((value) => value.replace(/\/+$/, ""));
      }
    }

    return [await this.resolveOpenCodeBaseUrl(refresh, workspacePath)];
  }

  private addClaudeAllowedScopeKey(request: SessionPermissionRequestInternalRecord): void {
    const scopeKey = buildClaudeAllowedScopeKey(request);

    if (!scopeKey) {
      return;
    }

    const scopeKeys = this.claudeAllowedScopeKeysBySessionId.get(request.sessionId) ?? new Set<string>();
    scopeKeys.add(scopeKey);
    this.claudeAllowedScopeKeysBySessionId.set(request.sessionId, scopeKeys);
  }

  private isClaudeScopeAllowed(sessionId: string, scopeKey: string): boolean {
    return this.claudeAllowedScopeKeysBySessionId.get(sessionId)?.has(scopeKey) ?? false;
  }

  private upsertRequest(request: SessionPermissionRequestInternalRecord): void {
    const existing = this.requestsById.get(request.id);

    if (existing?.source.kind === "claude-pre-tool-use" && existing.source.timer) {
      clearTimeout(existing.source.timer);
    }

    this.requestsById.set(request.id, request);
    const requestIds = this.requestIdsBySessionId.get(request.sessionId) ?? [];

    if (!requestIds.includes(request.id)) {
      requestIds.push(request.id);
      this.requestIdsBySessionId.set(request.sessionId, requestIds);
    }

    logPermissionDebug("permission_request.upsert", {
      requestId: request.id,
      sessionId: request.sessionId,
      provider: request.provider,
      providerSessionId: request.providerSessionId,
      kind: request.kind,
      status: request.status,
      title: request.title
    });
  }

  private async markResolved(
    request: SessionPermissionRequestInternalRecord,
    status: SessionPermissionRequestStatus
  ): Promise<SessionPermissionRequestView> {
    request.status = status;
    request.updatedAt = nowIso();
    request.resolvedAt = request.updatedAt;
    this.requestsById.set(request.id, request);

    const view = this.toRequestView(request);
    logPermissionDebug("permission_request.resolved", {
      requestId: request.id,
      sessionId: request.sessionId,
      provider: request.provider,
      kind: request.kind,
      status
    });
    await this.emitEnvelope({
      type: "session.permission_request_resolved",
      sessionId: request.sessionId,
      request: view
    });

    return view;
  }

  private getSessionRequestViews(sessionId: string): SessionPermissionRequestView[] {
    const requestIds = this.requestIdsBySessionId.get(sessionId) ?? [];

    return requestIds
      .map((requestId) => this.requestsById.get(requestId) ?? null)
      .filter((request): request is SessionPermissionRequestInternalRecord => request !== null)
      .sort((left, right) => {
        if (left.status !== right.status) {
          return left.status === "pending" ? -1 : 1;
        }

        return right.createdAt.localeCompare(left.createdAt);
      })
      .map((request) => this.toRequestView(request));
  }

  private toRequestView(
    request: SessionPermissionRequestInternalRecord
  ): SessionPermissionRequestView {
    return {
      id: request.id,
      sessionId: request.sessionId,
      provider: request.provider,
      providerSessionId: request.providerSessionId,
      requestKey: request.requestKey,
      kind: request.kind,
      status: request.status,
      title: request.title,
      summary: request.summary,
      detail: request.detail,
      reason: request.reason,
      toolName: request.toolName,
      command: request.command,
      cwd: request.cwd,
      paths: [...request.paths],
      permissionProfile: request.permissionProfile
        ? {
            readPaths: [...request.permissionProfile.readPaths],
            writePaths: [...request.permissionProfile.writePaths],
            networkEnabled: request.permissionProfile.networkEnabled
          }
        : null,
      questions: request.questions.map((question) => ({
        ...question,
        options: question.options.map((option) => ({ ...option }))
      })),
      actions: request.actions.map((action) => ({ ...action })),
      rawPayload: request.rawPayload,
      createdAt: request.createdAt,
      updatedAt: request.updatedAt,
      resolvedAt: request.resolvedAt
    };
  }

  private getRequestOrThrow(
    sessionId: string,
    requestId: string
  ): SessionPermissionRequestInternalRecord {
    const request = this.requestsById.get(requestId);

    if (!request || request.sessionId !== sessionId) {
      throw new AppError({
        statusCode: 404,
        errorCode: "PERMISSION_REQUEST_NOT_FOUND",
        detail: "没有找到对应的权限申请",
        field: "requestId"
      });
    }

    return request;
  }

  private findRequestByKey(
    provider: ProviderId,
    providerSessionId: string,
    requestKey: string
  ): SessionPermissionRequestInternalRecord | null {
    for (const request of this.requestsById.values()) {
      if (
        request.provider === provider &&
        request.providerSessionId === providerSessionId &&
        request.requestKey === requestKey
      ) {
        return request;
      }
    }

    return null;
  }
}

export function normalizeClaudePreToolUseRequest(input: {
  sessionId: string;
  providerSessionId: string;
  payload: ClaudeHookPermissionPayload;
  createdAt: string;
}): SessionPermissionRequestInternalRecord {
  const toolName = normalizeText(input.payload.tool_name) || "tool";
  const toolInput = input.payload.tool_input;
  const rawPayload = stringifyPayload(input.payload);
  const normalized = buildClaudeKind(toolName, toolInput);
  const requestKey =
    normalizeText(toRecord(toolInput)?.tool_use_id) ||
    normalizeText(toRecord(toolInput)?.id) ||
    `${toolName}:${hashLike(rawPayload)}`;

  return {
    id: `permission-${createId()}`,
    sessionId: input.sessionId,
    provider: "claude-code",
    providerSessionId: input.providerSessionId,
    requestKey,
    kind: normalized.kind,
    status: "pending",
    title: normalized.title,
    summary: normalized.summary,
    detail: normalized.detail,
    reason: normalizeText(input.payload.reason) || null,
    toolName,
    command: normalized.command,
    cwd: normalizeText(toRecord(toolInput)?.cwd) || null,
    paths: normalized.paths,
    permissionProfile: null,
    questions: [],
    actions: buildClaudeActions(normalized.kind),
    rawPayload,
    createdAt: input.createdAt,
    updatedAt: input.createdAt,
    resolvedAt: null,
    source: {
      kind: "claude-pre-tool-use",
      resolve: () => undefined,
      timer: null
    }
  };
}

export function normalizeOpenCodePermissionRequest(input: {
  sessionId: string;
  providerSessionId: string;
  permission: Record<string, unknown>;
  createdAt: string;
}): SessionPermissionRequestInternalRecord {
  const requestKey = normalizeText(input.permission.id) || createId();
  const title = normalizeText(input.permission.title) || "OpenCode 请求权限";
    const pattern = normalizeOpenCodePattern(input.permission.pattern ?? input.permission.patterns);
    const metadata = toRecord(input.permission.metadata);
    const normalized = buildOpenCodeKind(
      title,
      metadata,
      pattern,
      normalizeText(input.permission.tool) || normalizeText(input.permission.permission)
    );

  return {
    id: `permission-${createId()}`,
    sessionId: input.sessionId,
    provider: "opencode",
    providerSessionId: input.providerSessionId,
    requestKey,
    kind: normalized.kind,
    status: "pending",
    title,
    summary: normalized.summary,
    detail: normalized.detail,
    reason: normalizeText(metadata?.reason) || null,
      toolName: normalized.toolName,
    command: normalized.command,
    cwd: normalizeText(metadata?.cwd) || null,
    paths: normalized.paths,
    permissionProfile: normalized.permissionProfile,
    questions: [],
    actions: [
      createAction("once", "允许一次", "primary", "只放行这一次"),
      createAction("always", "总是允许", "neutral", "后续匹配请求也默认放行"),
      createAction("reject", "拒绝", "danger", "阻止这次权限申请")
    ],
    rawPayload: stringifyPayload(input.permission),
    createdAt: input.createdAt,
    updatedAt: input.createdAt,
    resolvedAt: null,
    source: {
      kind: "opencode",
      permissionId: requestKey,
      baseUrl: ""
    }
  };
}

export function normalizeCodexServerRequest(
  sessionId: string,
  providerSessionId: string,
  request: CodexServerRequest
): SessionPermissionRequestInternalRecord | null {
  const method = normalizeText(request.method);
  const params = toRecord(request.params);
  const createdAt = nowIso();

  if (!method || !params) {
    return null;
  }

  if (method === "item/commandExecution/requestApproval") {
    const actions = readCodexCommandActions(params.commandActions);
    const command = normalizeText(params.command);
    const host = normalizeText(toRecord(params.networkApprovalContext)?.host);
    const reason = normalizeText(params.reason);
    const summary = command || host || "Codex 请求执行命令";

    return {
      id: `permission-${createId()}`,
      sessionId,
      provider: "codex",
      providerSessionId,
      requestKey: normalizeText(params.itemId) || createId(),
      kind: "command",
      status: "pending",
      title: host ? `Codex 请求访问 ${host}` : "Codex 请求执行命令",
      summary,
      detail: actions.length > 0 ? stringifyPayload(actions) : reason || null,
      reason,
      toolName: null,
      command,
      cwd: normalizeText(params.cwd) || null,
      paths: actions
        .map((action) => normalizeText(action.path))
        .filter((value): value is string => Boolean(value)),
      permissionProfile: null,
      questions: [],
      actions: [
        createAction("accept", "允许", "primary", "只放行这次命令"),
        createAction("acceptForSession", "本会话放行", "neutral", "相同会话后续不再询问"),
        createAction("decline", "拒绝", "danger", "拒绝但继续当前轮次"),
        createAction("cancel", "拒绝并中断", "danger", "拒绝并立即中断当前轮次")
      ],
      rawPayload: stringifyPayload(params),
      createdAt,
      updatedAt: createdAt,
      resolvedAt: null,
      source: {
        kind: "codex-app-server",
        method
      }
    };
  }

  if (method === "item/fileChange/requestApproval") {
    const path = normalizeText(params.grantRoot);

    return {
      id: `permission-${createId()}`,
      sessionId,
      provider: "codex",
      providerSessionId,
      requestKey: normalizeText(params.itemId) || createId(),
      kind: "file_change",
      status: "pending",
      title: "Codex 请求写入文件",
      summary: path || "请求放行文件改动",
      detail: normalizeText(params.reason) || null,
      reason: normalizeText(params.reason) || null,
      toolName: null,
      command: null,
      cwd: null,
      paths: path ? [path] : [],
      permissionProfile: null,
      questions: [],
      actions: [
        createAction("accept", "允许", "primary", "只放行这次改动"),
        createAction("acceptForSession", "本会话放行", "neutral", "后续相同改动不再询问"),
        createAction("decline", "拒绝", "danger", "拒绝但继续当前轮次"),
        createAction("cancel", "拒绝并中断", "danger", "拒绝并立即中断当前轮次")
      ],
      rawPayload: stringifyPayload(params),
      createdAt,
      updatedAt: createdAt,
      resolvedAt: null,
      source: {
        kind: "codex-app-server",
        method
      }
    };
  }

  if (method === "item/permissions/requestApproval") {
    const permissions = toRecord(params.permissions);
    const fileSystem = toRecord(permissions?.fileSystem);
    const network = toRecord(permissions?.network);

    return {
      id: `permission-${createId()}`,
      sessionId,
      provider: "codex",
      providerSessionId,
      requestKey: normalizeText(params.itemId) || createId(),
      kind: "permissions",
      status: "pending",
      title: "Codex 请求附加权限",
      summary: normalizeText(params.reason) || "请求扩大文件或网络权限",
      detail: stringifyPayload(params.permissions),
      reason: normalizeText(params.reason) || null,
      toolName: null,
      command: null,
      cwd: null,
      paths: [
        ...readStringArray(fileSystem?.read),
        ...readStringArray(fileSystem?.write)
      ],
      permissionProfile: {
        readPaths: readStringArray(fileSystem?.read),
        writePaths: readStringArray(fileSystem?.write),
        networkEnabled: typeof network?.enabled === "boolean" ? network.enabled : null
      },
      questions: [],
      actions: [
        createAction("allow_turn", "仅当前轮次放行", "primary", "只把新增权限授予当前轮次"),
        createAction("allow_session", "本会话放行", "neutral", "把新增权限授予当前会话"),
        createAction("deny", "拒绝", "danger", "拒绝这次权限扩展")
      ],
      rawPayload: stringifyPayload(params),
      createdAt,
      updatedAt: createdAt,
      resolvedAt: null,
      source: {
        kind: "codex-app-server",
        method
      }
    };
  }

  if (method === "item/tool/requestUserInput") {
    const questions = Array.isArray(params.questions)
      ? params.questions
          .map((question) => toRecord(question))
          .filter((question): question is Record<string, unknown> => question !== null)
          .map((question) => ({
            id: normalizeText(question.id) || createId(),
            header: normalizeText(question.header) || "问题",
            question: normalizeText(question.question) || "请输入答案",
            allowOther: Boolean(question.isOther),
            secret: Boolean(question.isSecret),
            options: Array.isArray(question.options)
              ? question.options
                  .map((option) => toRecord(option))
                  .filter((option): option is Record<string, unknown> => option !== null)
                  .map((option) => ({
                    label: normalizeText(option.label) || "选项",
                    description: normalizeText(option.description) || null
                  }))
              : []
          }))
      : [];

    return {
      id: `permission-${createId()}`,
      sessionId,
      provider: "codex",
      providerSessionId,
      requestKey: normalizeText(params.itemId) || createId(),
      kind: "user_input",
      status: "pending",
      title: "Codex 请求补充输入",
      summary: questions[0]?.question ?? "需要你补充工具输入",
      detail: null,
      reason: null,
      toolName: null,
      command: null,
      cwd: null,
      paths: [],
      permissionProfile: null,
      questions,
      actions: [
        createAction("submit", "提交", "primary", "提交补充输入")
      ],
      rawPayload: stringifyPayload(params),
      createdAt,
      updatedAt: createdAt,
      resolvedAt: null,
      source: {
        kind: "codex-app-server",
        method
      }
    };
  }

  return null;
}

function buildClaudePreToolUseBridgeResponse(
  action: "allow" | "deny" | "ask",
  reason: string
): Record<string, unknown> {
  return {
    hookSpecificOutput: {
      hookEventName: "PreToolUse",
      permissionDecision: action,
      permissionDecisionReason: reason
    }
  };
}

function buildClaudePermissionRequestBridgeResponse(
  action: "allow" | "deny",
  message: string
): Record<string, unknown> {
  return {
    hookSpecificOutput: {
      hookEventName: "PermissionRequest",
      decision: {
        behavior: action,
        message
      }
    }
  };
}

function buildClaudeDecisionReason(
  action: "allow" | "deny" | "ask",
  title: string,
  resolvedByTimeout: boolean
): string {
  if (action === "allow") {
    return `CodingNS 已批准：${title}`;
  }

  if (action === "deny") {
    return `CodingNS 已拒绝：${title}`;
  }

  return resolvedByTimeout
    ? "CodingNS 未在超时时间内处理，回退 Claude 原生确认"
    : "CodingNS 请求回退 Claude 原生确认";
}

function extractOpenCodePermissionCreatedAt(permission: Record<string, unknown>): string | null {
  const created = toRecord(permission.time)?.created;
  const numeric =
    typeof created === "number"
      ? created
      : Number.parseInt(normalizeText(created) || "", 10);

  if (Number.isFinite(numeric) && numeric > 0) {
    return new Date(numeric).toISOString();
  }

  return null;
}

function buildCodexServerRequestResponsePayload(
  request: SessionPermissionRequestInternalRecord,
  input: SessionPermissionReplyInput
): unknown {
  const action = normalizeText(input.action);

  if (!action) {
    throw new AppError({
      statusCode: 400,
      errorCode: "INVALID_INPUT",
      detail: "Codex 审批回复必须包含 action",
      field: "action"
    });
  }

  if (request.kind === "command") {
    if (
      action !== "accept" &&
      action !== "acceptForSession" &&
      action !== "decline" &&
      action !== "cancel"
    ) {
      throw new AppError({
        statusCode: 400,
        errorCode: "INVALID_INPUT",
        detail: "命令审批只支持 accept、acceptForSession、decline、cancel",
        field: "action"
      });
    }

    return {
      decision: action
    };
  }

  if (request.kind === "file_change") {
    if (
      action !== "accept" &&
      action !== "acceptForSession" &&
      action !== "decline" &&
      action !== "cancel"
    ) {
      throw new AppError({
        statusCode: 400,
        errorCode: "INVALID_INPUT",
        detail: "文件改动审批只支持 accept、acceptForSession、decline、cancel",
        field: "action"
      });
    }

    return {
      decision: action
    };
  }

  if (request.kind === "permissions") {
    if (action !== "allow_turn" && action !== "allow_session" && action !== "deny") {
      throw new AppError({
        statusCode: 400,
        errorCode: "INVALID_INPUT",
        detail: "权限扩展审批只支持 allow_turn、allow_session、deny",
        field: "action"
      });
    }

    if (action === "deny") {
      return {
        permissions: {},
        scope: "turn"
      };
    }

    return {
      permissions: {
        fileSystem: request.permissionProfile
          ? {
              read: request.permissionProfile.readPaths,
              write: request.permissionProfile.writePaths
            }
          : null,
        network:
          request.permissionProfile?.networkEnabled === null
            ? null
            : {
                enabled: request.permissionProfile?.networkEnabled ?? null
              }
      },
      scope: action === "allow_session" ? "session" : "turn"
    };
  }

  if (request.kind === "user_input") {
    if (action !== "submit") {
      throw new AppError({
        statusCode: 400,
        errorCode: "INVALID_INPUT",
        detail: "补充输入请求只支持 submit",
        field: "action"
      });
    }

    const questionIds = new Set(request.questions.map((question) => question.id));
    const answers = Object.fromEntries(
      Object.entries(input.answers ?? {})
        .filter(([questionId]) => questionIds.has(questionId))
        .map(([questionId, values]) => [
          questionId,
          {
            answers: values
          }
        ])
    );

    return {
      answers
    };
  }

  throw new AppError({
    statusCode: 409,
    errorCode: "PERMISSION_REQUEST_REPLY_NOT_SUPPORTED",
    detail: "当前 Codex 请求类型还不支持直接回复",
    field: "requestId"
  });
}

function resolveCodexReplyStatus(
  kind: SessionPermissionRequestKind,
  action: string | undefined
): SessionPermissionRequestStatus {
  const normalizedAction = normalizeText(action);

  if (kind === "user_input") {
    return "approved";
  }

  if (
    normalizedAction === "deny" ||
    normalizedAction === "decline" ||
    normalizedAction === "cancel"
  ) {
    return "declined";
  }

  return "approved";
}

function buildClaudeKind(
  toolName: string,
  toolInput: unknown
): {
  kind: SessionPermissionRequestKind;
  title: string;
  summary: string;
  detail: string | null;
  command: string | null;
  paths: string[];
} {
  const normalizedToolName = toolName.trim().toLowerCase();
  const inputRecord = toRecord(toolInput);
  const command =
    normalizeText(inputRecord?.command) ||
    normalizeText(inputRecord?.cmd) ||
    null;

  if (normalizedToolName === "bash" || normalizedToolName === "shell") {
    return {
      kind: "command",
      title: "Claude 请求执行命令",
      summary: command ?? "Bash 工具需要确认",
      detail: stringifyPayload(toolInput),
      command,
      paths: []
    };
  }

  if (
    normalizedToolName === "edit" ||
    normalizedToolName === "write" ||
    normalizedToolName === "multiedit"
  ) {
    const paths = readClaudePaths(inputRecord);
    return {
      kind: "file_change",
      title: "Claude 请求改动文件",
      summary: paths[0] ?? `${toolName} 工具需要确认`,
      detail: stringifyPayload(toolInput),
      command: null,
      paths
    };
  }

  return {
    kind: "tool_call",
    title: `Claude 请求调用 ${toolName}`,
    summary: toolName,
    detail: stringifyPayload(toolInput),
    command,
    paths: []
  };
}

function buildOpenCodeKind(
  title: string,
  metadata: Record<string, unknown> | null,
  pattern: string[],
  fallbackToolName: string | null
): {
  kind: SessionPermissionRequestKind;
  summary: string;
  detail: string | null;
  toolName: string | null;
  command: string | null;
  paths: string[];
  permissionProfile: SessionPermissionProfileView | null;
} {
  const command = normalizeText(metadata?.command);
  const toolName = normalizeText(metadata?.tool) || fallbackToolName;
  const path = normalizeText(metadata?.path);
  const readPaths = readStringArray(toRecord(metadata?.fileSystem)?.read);
  const writePaths = readStringArray(toRecord(metadata?.fileSystem)?.write);
  const network = toRecord(metadata?.network);
  const summary = command || toolName || path || pattern[0] || title;

  if (command) {
    return {
      kind: "command",
      summary,
      detail: stringifyPayload(metadata),
      toolName,
      command,
      paths: path ? [path] : [],
      permissionProfile: null
    };
  }

  if (path || pattern.length > 0 || writePaths.length > 0) {
    return {
      kind: "file_change",
      summary,
      detail: stringifyPayload(metadata),
      toolName,
      command: null,
      paths: [
        ...(path ? [path] : []),
        ...pattern,
        ...writePaths
      ],
      permissionProfile: null
    };
  }

  if (readPaths.length > 0 || writePaths.length > 0 || typeof network?.enabled === "boolean") {
    return {
      kind: "permissions",
      summary,
      detail: stringifyPayload(metadata),
      toolName,
      command: null,
      paths: [...readPaths, ...writePaths],
      permissionProfile: {
        readPaths,
        writePaths,
        networkEnabled: typeof network?.enabled === "boolean" ? network.enabled : null
      }
    };
  }

  return {
    kind: "tool_call",
    summary,
    detail: stringifyPayload(metadata),
    toolName,
    command: null,
    paths: [],
    permissionProfile: null
  };
}

function readClaudePaths(inputRecord: Record<string, unknown> | null): string[] {
  if (!inputRecord) {
    return [];
  }

  const directPath = normalizeText(inputRecord.file_path) || normalizeText(inputRecord.path);
  const paths = directPath ? [directPath] : [];
  const edits = Array.isArray(inputRecord.edits) ? inputRecord.edits : [];

  for (const edit of edits) {
    const editPath = normalizeText(toRecord(edit)?.file_path) || normalizeText(toRecord(edit)?.path);

    if (editPath && !paths.includes(editPath)) {
      paths.push(editPath);
    }
  }

  return paths;
}

function readCodexCommandActions(value: unknown): CodexCommandActionRecord[] {
  if (!Array.isArray(value)) {
    return [];
  }

  return value
    .map((item) => toRecord(item))
    .filter((item) => item !== null) as CodexCommandActionRecord[];
}

function normalizeOpenCodePattern(value: unknown): string[] {
  if (typeof value === "string") {
    return value.trim() ? [value.trim()] : [];
  }

  if (!Array.isArray(value)) {
    return [];
  }

  return value
    .map((item) => normalizeText(item))
    .filter((item): item is string => Boolean(item));
}

function createAction(
  value: string,
  label: string,
  tone: SessionPermissionRequestActionTone,
  description: string
): SessionPermissionRequestActionView {
  return {
    value,
    label,
    tone,
    description
  };
}

function buildClaudeAllowedScopeKey(
  request: Pick<SessionPermissionRequestInternalRecord, "kind" | "command" | "paths" | "toolName">
): string | null {
  if (request.kind === "command") {
    const normalizedCommand = normalizeText(request.command);
    return normalizedCommand ? `command:${normalizedCommand}` : null;
  }

  if (request.kind === "file_change") {
    const normalizedPaths = request.paths
      .map((path) => normalizeText(path))
      .filter((path): path is string => Boolean(path))
      .sort();

    return normalizedPaths.length > 0 ? `file_change:${normalizedPaths.join("|")}` : null;
  }

  return null;
}

function buildClaudeActions(kind: SessionPermissionRequestKind): SessionPermissionRequestActionView[] {
  const actions: SessionPermissionRequestActionView[] = [
    createAction("allow", "允许", "primary", "只允许这一次")
  ];

  if (kind === "command" || kind === "file_change") {
    actions.push(
      createAction("allow_session", "本会话默认允许", "neutral", "仅对同类操作默认放行")
    );
  }

  actions.push(
    createAction("deny", "拒绝", "danger", "阻止这次工具操作继续执行")
  );

  return actions;
}

function stringifyPayload(value: unknown): string | null {
  if (value === undefined) {
    return null;
  }

  if (typeof value === "string") {
    return value.trim() || null;
  }

  try {
    return JSON.stringify(value, null, 2);
  } catch {
    return String(value);
  }
}

function normalizeText(value: unknown): string | null {
  if (typeof value === "string") {
    const normalized = value.trim();
    return normalized || null;
  }

  if (typeof value === "number" || typeof value === "boolean") {
    return String(value);
  }

  return null;
}

function toRecord(value: unknown): Record<string, unknown> | null {
  if (!value || typeof value !== "object" || Array.isArray(value)) {
    return null;
  }

  return value as Record<string, unknown>;
}

function readStringArray(value: unknown): string[] {
  if (!Array.isArray(value)) {
    return [];
  }

  return value
    .map((item) => normalizeText(item))
    .filter((item): item is string => Boolean(item));
}

function hashLike(input: string | null): string {
  const text = input ?? "";
  let hash = 0;

  for (let index = 0; index < text.length; index += 1) {
    hash = (hash * 31 + text.charCodeAt(index)) >>> 0;
  }

  return hash.toString(16);
}

function requireNonEmptyText(value: unknown, field: string): string {
  const normalized = normalizeText(value);

  if (!normalized) {
    throw new AppError({
      statusCode: 400,
      errorCode: "INVALID_INPUT",
      detail: `${field} 不能为空`,
      field
    });
  }

  return normalized;
}

async function safeReadResponseText(response: Response): Promise<string> {
  try {
    return (await response.text()).trim();
  } catch {
    return "";
  }
}

function extractSseData(frame: string): string | null {
  const lines = frame.split(/\r?\n/);
  const dataLines = lines
    .filter((line) => line.startsWith("data:"))
    .map((line) => line.slice(5).trimStart());

  if (dataLines.length === 0) {
    return null;
  }

  return dataLines.join("\n");
}

function unwrapOpenCodeEventPayload(rawEvent: Record<string, unknown>): Record<string, unknown> | null {
  const properties = toRecord(rawEvent.properties);
  const nestedEvent = toRecord(properties?.event);

  return nestedEvent ?? rawEvent;
}

async function waitForDelay(delayMs: number, signal: AbortSignal): Promise<void> {
  await new Promise<void>((resolve, reject) => {
    const timer = setTimeout(() => {
      cleanup();
      resolve();
    }, delayMs);
    const cleanup = () => {
      clearTimeout(timer);
      signal.removeEventListener("abort", onAbort);
    };
    const onAbort = () => {
      cleanup();
      reject(new Error("ABORTED"));
    };

    signal.addEventListener("abort", onAbort, { once: true });
  });
}

function buildClaudeRawStoreRef(homeDir: string, workspacePath: string, sessionId: string): string {
  return join(homeDir, "projects", workspaceSlug(workspacePath), `${sessionId}.jsonl`);
}

function workspaceSlug(workspacePath: string): string {
  return workspacePath
    .replace(/:/g, "")
    .replace(/[\\/]+/g, "-")
    .replace(/^-+|-+$/g, "")
    .replace(/[^A-Za-z0-9._-]/g, "-");
}
