import { useEffect, useState } from "react";

import type {
  SessionActivityEvent,
  SessionInterruptedEvent,
  SessionPermissionRequestEvent,
  SessionPermissionRequestResolvedEvent,
  SessionRuntimeErrorEvent,
  SessionRuntimeMessageEvent,
  SessionRuntimeStatusEvent
} from "../../../network/realtime-client";
import { RealtimeClient } from "../../../network/realtime-client";
import { logPerfDebug } from "../../../shared/debug/perf-debug";
import { t } from "../../../shared/i18n";
import type {
  ContextUsageDto,
  ProviderCapabilitiesDto,
  ProviderModelOptionDto,
  SessionPermissionRequestDto
} from "../../conversation/api/conversation-api";
import {
  getProviderCapabilities,
  getSessionMessages,
  getSessionPermissionRequests,
  getSessionRuntime,
  interruptSession,
  replySessionPermissionRequest
} from "../../conversation/api/conversation-api";
import type { SessionMessageViewModel } from "../../conversation/runtime/session-runtime-machine";
import { toViewMessage } from "../../conversation/runtime/session-runtime-machine";
import type {
  ButlerControlEventDto,
  ButlerControlSessionDto,
  ButlerOverviewDto,
  ButlerProfileDto,
  ButlerProfilePayload,
  ButlerProviderId
} from "../api/butler-api";
import {
  getButlerControlSession,
  getButlerOverview,
  getButlerProfile,
  getCurrentButlerControlSession,
  initButlerProfile,
  listButlerControlEvents,
  resetButlerControlSession,
  sendButlerControlMessage,
  startButlerControlSession,
  updateButlerProfile
} from "../api/butler-api";

type ButlerRuntimeListener = () => void;
type ButlerHistoryState = "idle" | "loading" | "ready" | "error";

export interface ButlerRuntimeState {
  loading: boolean;
  sending: boolean;
  switchingProvider: boolean;
  initialized: boolean;
  profile: ButlerProfileDto | null;
  activeProvider: ButlerProviderId;
  controlSession: ButlerControlSessionDto | null;
  capabilities: ProviderCapabilitiesDto | null;
  overview: ButlerOverviewDto | null;
  events: ButlerControlEventDto[];
  messages: SessionMessageViewModel[];
  historyState: ButlerHistoryState;
  loadingOlderMessages: boolean;
  olderCursor: string | null;
  hasOlderMessages: boolean;
  runtimeHasActiveRun: boolean | null;
  runtimeCanInterrupt: boolean | null;
  contextUsage: ContextUsageDto | null;
  permissionRequests: SessionPermissionRequestDto[];
  error: string | null;
}

const BUTLER_MESSAGE_PAGE_SIZE = 60;
const BUTLER_TERMINAL_SYNC_DEBOUNCE_MS = 400;
const BUTLER_DIAGNOSTIC_RAW_REF_PREFIX = "butler-diagnostic://";
const BUTLER_PENDING_RUN_GRACE_MS = 15_000;

export class ButlerRuntimeStore {
  private state: ButlerRuntimeState;
  private listeners = new Set<ButlerRuntimeListener>();
  private realtimeClient: RealtimeClient | null = null;
  private realtimeSessionId: string | null = null;
  private selectedControlSessionId: string | null = null;
  private controlSessionReloadInFlight = false;
  private terminalSyncTimer: number | null = null;
  private terminalSyncArmed = false;
  private terminalSyncCompletedControlSessionId: string | null = null;
  private pendingRunControlSession: {
    controlSessionId: string;
    expiresAt: number;
  } | null = null;

  constructor(private readonly workspaceId: string) {
    this.state = {
      loading: true,
      sending: false,
      switchingProvider: false,
      initialized: false,
      profile: null,
      activeProvider: "codex",
      controlSession: null,
      capabilities: createButlerFallbackCapabilities("codex"),
      overview: null,
      events: [],
      messages: [],
      historyState: "idle",
      loadingOlderMessages: false,
      olderCursor: null,
      hasOlderMessages: false,
      runtimeHasActiveRun: null,
      runtimeCanInterrupt: null,
      contextUsage: null,
      permissionRequests: [],
      error: null
    };
  }

  subscribe = (listener: ButlerRuntimeListener) => {
    this.listeners.add(listener);
    return () => {
      this.listeners.delete(listener);
    };
  };

  getState = () => this.state;

  async initialize(): Promise<void> {
    this.patch({
      loading: true,
      error: null
    });

    try {
      const profileResponse = await getButlerProfile();

      if (!profileResponse.initialized || !profileResponse.profile) {
        this.clearPendingRun();
        this.patch({
          loading: false,
          initialized: false,
          profile: null,
          activeProvider: "codex",
          capabilities: createButlerFallbackCapabilities("codex"),
          controlSession: null,
          messages: [],
          historyState: "idle",
          loadingOlderMessages: false,
          olderCursor: null,
          hasOlderMessages: false,
          overview: null,
          events: [],
          runtimeHasActiveRun: null,
          runtimeCanInterrupt: null,
          contextUsage: null,
          permissionRequests: []
        });
        return;
      }

      const profile = profileResponse.profile;
      this.patch({
        initialized: true,
        profile,
        activeProvider: profile.providerId,
        capabilities: createButlerFallbackCapabilities(profile.providerId)
      });
      await this.reloadForProvider(profile.providerId);
      this.patch({
        loading: false
      });
    } catch (error) {
      this.patch({
        loading: false,
        error: toErrorMessage(error)
      });
    }
  }

  async initializeProfile(payload: ButlerProfilePayload): Promise<void> {
    this.patch({
      loading: true,
      error: null
    });

    try {
      const response = await initButlerProfile(payload);

      if (!response.initialized || !response.profile) {
        throw new Error("BUTLER_PROFILE_INIT_FAILED");
      }

      this.patch({
        initialized: true,
        profile: response.profile,
        activeProvider: response.profile.providerId,
        capabilities: createButlerFallbackCapabilities(response.profile.providerId)
      });
      await this.reloadForProvider(response.profile.providerId);
    } catch (error) {
      this.patch({
        error: toErrorMessage(error)
      });
      throw error;
    } finally {
      this.patch({
        loading: false
      });
    }
  }

  async switchProvider(providerId: ButlerProviderId): Promise<void> {
    if (!this.state.initialized || !this.state.profile || this.state.activeProvider === providerId) {
      return;
    }

    const previousState = {
      activeProvider: this.state.activeProvider,
      profile: this.state.profile,
      controlSession: this.state.controlSession,
      capabilities: this.state.capabilities,
      overview: this.state.overview,
      events: this.state.events,
      messages: this.state.messages,
      historyState: this.state.historyState,
      loadingOlderMessages: this.state.loadingOlderMessages,
      olderCursor: this.state.olderCursor,
      hasOlderMessages: this.state.hasOlderMessages,
      runtimeHasActiveRun: this.state.runtimeHasActiveRun,
      runtimeCanInterrupt: this.state.runtimeCanInterrupt,
      contextUsage: this.state.contextUsage
    } satisfies Pick<
      ButlerRuntimeState,
      | "activeProvider"
      | "profile"
      | "controlSession"
      | "capabilities"
      | "overview"
      | "events"
      | "messages"
      | "historyState"
      | "loadingOlderMessages"
      | "olderCursor"
      | "hasOlderMessages"
      | "runtimeHasActiveRun"
      | "runtimeCanInterrupt"
      | "contextUsage"
    >;

    // 切换 provider 必须先清空页面状态，避免不同 provider 的上下文串味。
    this.patch({
      switchingProvider: true,
      error: null,
      activeProvider: providerId,
      controlSession: null,
      messages: [],
      historyState: "idle",
      loadingOlderMessages: false,
      olderCursor: null,
      hasOlderMessages: false,
      overview: null,
      events: [],
      runtimeHasActiveRun: null,
      runtimeCanInterrupt: null,
      contextUsage: null,
      capabilities: createButlerFallbackCapabilities(providerId)
    });

    try {
      const response = await updateButlerProfile({
        providerId
      });

      if (!response.initialized || !response.profile) {
        throw new Error("BUTLER_PROFILE_UPDATE_FAILED");
      }

      this.patch({
        initialized: true,
        profile: response.profile,
        activeProvider: response.profile.providerId
      });
      await Promise.all([
        this.refreshCapabilities(response.profile.providerId),
        this.refreshOverview(),
        this.refreshEvents()
      ]);
      await this.startFreshSession({
        preserveSwitchingState: true
      });
    } catch (error) {
      this.patch({
        ...previousState,
        error: toErrorMessage(error)
      });
      throw error;
    } finally {
      this.patch({
        switchingProvider: false
      });
    }
  }

  async updateProfile(payload: ButlerProfilePayload): Promise<void> {
    if (!this.state.initialized || !this.state.profile) {
      return;
    }

    this.patch({
      loading: true,
      error: null
    });

    try {
      const response = await updateButlerProfile(payload);

      if (!response.initialized || !response.profile) {
        throw new Error("BUTLER_PROFILE_UPDATE_FAILED");
      }

      this.patch({
        initialized: true,
        profile: response.profile,
        activeProvider: response.profile.providerId
      });
    } catch (error) {
      this.patch({
        error: toErrorMessage(error)
      });
      throw error;
    } finally {
      this.patch({
        loading: false
      });
    }
  }

  async sendMessage(
    content: string,
    options?: {
      model?: string | null;
      reasoningLevel?: string | null;
      permissionMode?: string | null;
    }
  ): Promise<void> {
    const normalizedContent = content.trim();

    if (!normalizedContent || !this.state.initialized) {
      return;
    }

    this.patch({
      sending: true,
      error: null
    });

    try {
      const currentControlSession = this.state.controlSession;

      if (!currentControlSession) {
        const started = await startButlerControlSession({
          content: normalizedContent,
          model: options?.model ?? null,
          reasoningLevel: options?.reasoningLevel ?? null,
          permissionMode: options?.permissionMode ?? null
        });
        this.selectedControlSessionId = started.controlSession.id;
        this.patch({
          controlSession: started.controlSession
        });
      } else {
        const sent = await sendButlerControlMessage({
          controlSessionId: currentControlSession.id,
          content: normalizedContent,
          model: options?.model ?? null,
          reasoningLevel: options?.reasoningLevel ?? null,
          permissionMode: options?.permissionMode ?? null
        });
        this.selectedControlSessionId = sent.controlSession.id;
        this.patch({
          controlSession: sent.controlSession
        });
      }

      this.markPendingRun(this.selectedControlSessionId);
      await this.reloadControlSession(this.selectedControlSessionId);
      await Promise.all([this.refreshOverview(), this.refreshEvents()]);
    } catch (error) {
      this.patch({
        error: toErrorMessage(error)
      });
      throw error;
    } finally {
      this.patch({
        sending: false
      });
    }
  }

  async retryMessage(clientRequestId: string): Promise<void> {
    const targetMessage = this.state.messages.find(
      (message) => message.clientRequestId === clientRequestId
    );

    if (!targetMessage || !targetMessage.content.trim()) {
      return;
    }

    await this.sendMessage(targetMessage.content);
  }

  async interrupt(): Promise<void> {
    const sessionId = this.state.controlSession?.session.sessionId ?? null;

    if (!sessionId) {
      return;
    }

    await interruptSession(sessionId);
    this.clearPendingRun(this.state.controlSession?.id ?? null);
    this.patch({
      runtimeHasActiveRun: false,
      runtimeCanInterrupt: false
    });
  }

  async replyPermissionRequest(
    requestId: string,
    payload: { action: string; answers?: Record<string, string[]> }
  ): Promise<void> {
    const sessionId = this.state.controlSession?.session.sessionId ?? null;

    if (!sessionId) {
      return;
    }

    const request = this.state.permissionRequests.find((item) => item.id === requestId) ?? null;

    if (!request) {
      return;
    }

    const updated = await replySessionPermissionRequest(sessionId, requestId, payload);

    this.patch({
      permissionRequests: upsertPermissionRequest(this.state.permissionRequests, updated)
    });
  }

  async startFreshSession(options?: { preserveSwitchingState?: boolean }): Promise<void> {
    if (!this.state.initialized) {
      return;
    }

    this.teardownRealtime();
    this.selectedControlSessionId = null;
    this.clearPendingRun();
    this.terminalSyncArmed = false;
    this.terminalSyncCompletedControlSessionId = null;
    this.patch({
      sending: false,
      error: null,
      controlSession: null,
      messages: [],
      historyState: "ready",
      loadingOlderMessages: false,
      olderCursor: null,
      hasOlderMessages: false,
      runtimeHasActiveRun: null,
      runtimeCanInterrupt: null,
      contextUsage: null,
      permissionRequests: []
    });

    try {
      await resetButlerControlSession();
    } catch (error) {
      this.patch({
        historyState: "error",
        error: toErrorMessage(error)
      });
      throw error;
    }

    this.patch({
      switchingProvider: options?.preserveSwitchingState ? this.state.switchingProvider : false
    });
  }

  async loadOlderMessages(): Promise<void> {
    const controlSessionId = this.state.controlSession?.id ?? null;
    const sessionId = this.state.controlSession?.session.sessionId ?? null;

    if (
      !sessionId
      || this.state.historyState !== "ready"
      || this.state.loadingOlderMessages
      || !this.state.olderCursor
    ) {
      return;
    }

    this.patch({
      loadingOlderMessages: true,
      error: null
    });

    try {
      const historyPage = await getSessionMessages(
        sessionId,
        this.state.olderCursor,
        BUTLER_MESSAGE_PAGE_SIZE,
        "backward"
      );

      if (
        !controlSessionId
        || this.state.controlSession?.id !== controlSessionId
        || this.state.controlSession?.session.sessionId !== sessionId
      ) {
        this.patch({
          loadingOlderMessages: false
        });
        return;
      }

      const merged = mergeButlerMessages(this.state.messages, sessionId, historyPage.messages);

      this.patch({
        messages: buildButlerVisibleMessages(
          merged,
          this.state.controlSession,
          {
            runningState: this.state.controlSession?.session.runningState ?? "idle",
            runtimeHasActiveRun: this.state.runtimeHasActiveRun ?? false,
            runtimeCanInterrupt: this.state.runtimeCanInterrupt ?? false,
            detail: null,
            errorDetail: this.state.error,
            updatedAt: this.state.controlSession?.updatedAt ?? new Date().toISOString()
          }
        ),
        historyState: "ready",
        loadingOlderMessages: false,
        olderCursor: historyPage.nextCursor,
        hasOlderMessages: Boolean(historyPage.nextCursor)
      });
    } catch (error) {
      this.patch({
        loadingOlderMessages: false,
        error: toErrorMessage(error)
      });
    }
  }

  async refreshAll(): Promise<void> {
    if (!this.state.initialized) {
      return;
    }

    this.patch({
      loading: true,
      error: null
    });

    try {
      await this.reloadForProvider(this.state.activeProvider);
    } finally {
      this.patch({
        loading: false
      });
    }
  }

  async reloadEventsAndOverview(): Promise<void> {
    if (!this.state.initialized) {
      return;
    }

    await Promise.all([this.refreshOverview(), this.refreshEvents()]);
  }

  private async reloadForProvider(providerId: ButlerProviderId): Promise<void> {
    logPerfDebug("butler.runtime.reload_for_provider.start", {
      workspaceId: this.workspaceId,
      providerId,
      selectedControlSessionId: this.selectedControlSessionId
    });
    await Promise.all([this.refreshCapabilities(providerId), this.refreshOverview(), this.refreshEvents()]);
    await this.reloadControlSession(this.selectedControlSessionId);
    logPerfDebug("butler.runtime.reload_for_provider.end", {
      workspaceId: this.workspaceId,
      providerId,
      selectedControlSessionId: this.selectedControlSessionId
    });
  }

  async openControlSession(controlSessionId: string): Promise<void> {
    this.selectedControlSessionId = controlSessionId.trim() || null;
    await this.reloadControlSession(this.selectedControlSessionId);
  }

  async adoptControlSession(controlSession: ButlerControlSessionDto): Promise<void> {
    this.selectedControlSessionId = controlSession.id;
    this.patch({
      controlSession
    });
    await this.reloadControlSession(controlSession.id);
  }

  private async reloadControlSession(controlSessionId?: string | null): Promise<void> {
    const currentControlSessionId = this.state.controlSession?.id ?? null;
    const isBackgroundReload =
      this.state.historyState === "ready"
      && currentControlSessionId !== null
      && (controlSessionId === null
        || controlSessionId === undefined
        || controlSessionId === currentControlSessionId);
    logPerfDebug("butler.runtime.reload_control_session.start", {
      workspaceId: this.workspaceId,
      requestedControlSessionId: controlSessionId ?? null,
      currentControlSessionId,
      currentSessionId: this.state.controlSession?.session?.sessionId ?? null,
      currentMessages: this.state.messages.length,
      currentHistoryState: this.state.historyState,
      backgroundReload: isBackgroundReload
    });
    if (!isBackgroundReload) {
      this.patch({
        historyState: "loading"
      });
    }

    try {
      const response = controlSessionId
        ? await getButlerControlSession(controlSessionId)
        : await getCurrentButlerControlSession();
      const controlSession = response.controlSession;

      if (!controlSession) {
        this.selectedControlSessionId = null;
        this.clearPendingRun();
        this.terminalSyncArmed = false;
        this.terminalSyncCompletedControlSessionId = null;
        this.teardownRealtime();
        this.patch({
          controlSession: null,
          messages: [],
          historyState: "ready",
          loadingOlderMessages: false,
          olderCursor: null,
          hasOlderMessages: false,
          runtimeHasActiveRun: null,
          runtimeCanInterrupt: null,
          contextUsage: null,
          permissionRequests: []
        });
        logPerfDebug("butler.runtime.reload_control_session.empty", {
          workspaceId: this.workspaceId,
          requestedControlSessionId: controlSessionId ?? null
        });
        return;
      }

      this.selectedControlSessionId = controlSession.id;

      const [historyPage, runtime, permissionResponse] = await Promise.all([
        // Butler 对话页打开时必须先展示最新一页；长会话如果从 forward 读第一页，
        // 会把已经看到的最近消息回退成最早的旧历史。
        getSessionMessages(controlSession.session.sessionId, null, BUTLER_MESSAGE_PAGE_SIZE, "backward"),
        getSessionRuntime(controlSession.session.sessionId),
        getSessionPermissionRequests(controlSession.session.sessionId)
      ]);
      const resolvedControlSession = this.resolvePendingRunControlSession(controlSession, runtime);
      if (this.state.controlSession?.id !== controlSession.id) {
        this.terminalSyncCompletedControlSessionId = null;
      }
      this.terminalSyncArmed =
        runtime.hasActiveRun || resolvedControlSession.status === "running";
      if (runtime.hasActiveRun) {
        this.clearPendingRun(controlSession.id);
        this.terminalSyncCompletedControlSessionId = null;
      } else if (!this.terminalSyncArmed) {
        this.terminalSyncCompletedControlSessionId = controlSession.id;
      }
      const viewMessages = historyPage.messages.map((message) =>
        toViewMessage(controlSession.session.sessionId, message)
      );
      this.ensureRealtimeSubscription(controlSession.session.sessionId, historyPage.cursor);

      this.patch({
        controlSession: resolvedControlSession,
        messages: buildButlerVisibleMessages(viewMessages, resolvedControlSession, {
          runningState: runtime.runningState,
          runtimeHasActiveRun: runtime.hasActiveRun,
          runtimeCanInterrupt: runtime.canInterrupt,
          detail: runtime.detail,
          errorDetail: runtime.errorDetail,
          updatedAt: runtime.updatedAt
        }),
        historyState: "ready",
        loadingOlderMessages: false,
        olderCursor: historyPage.nextCursor,
        hasOlderMessages: Boolean(historyPage.nextCursor),
        runtimeHasActiveRun: runtime.hasActiveRun,
        runtimeCanInterrupt: runtime.canInterrupt,
        contextUsage: runtime.contextUsage,
        permissionRequests: permissionResponse.items
      });
      logPerfDebug("butler.runtime.reload_control_session.end", {
        workspaceId: this.workspaceId,
        controlSessionId: controlSession.id,
        sessionId: controlSession.session.sessionId,
        messages: viewMessages.length,
        historyState: "ready",
        hasActiveRun: runtime.hasActiveRun,
        canInterrupt: runtime.canInterrupt,
        terminalSyncArmed: this.terminalSyncArmed,
        terminalSyncCompletedControlSessionId: this.terminalSyncCompletedControlSessionId
      });
    } catch (error) {
      this.patch({
        historyState: "error",
        error: toErrorMessage(error)
      });
      logPerfDebug("butler.runtime.reload_control_session.error", {
        workspaceId: this.workspaceId,
        requestedControlSessionId: controlSessionId ?? null,
        message: toErrorMessage(error)
      });
    }
  }

  private async refreshCapabilities(providerId: ButlerProviderId): Promise<void> {
    try {
      const capabilities = await getProviderCapabilities(providerId, this.workspaceId);
      this.patch({
        capabilities
      });
    } catch {
      this.patch({
        capabilities: createButlerFallbackCapabilities(providerId)
      });
    }
  }

  private async refreshOverview(): Promise<void> {
    try {
      const response = await getButlerOverview();
      this.patch({
        overview: response.overview
      });
    } catch (error) {
      this.patch({
        error: toErrorMessage(error)
      });
    }
  }

  private async refreshEvents(): Promise<void> {
    try {
      const response = await listButlerControlEvents();
      this.patch({
        events: response.items
      });
    } catch (error) {
      this.patch({
        error: toErrorMessage(error)
      });
    }
  }

  private patch(partial: Partial<ButlerRuntimeState>): void {
    this.state = {
      ...this.state,
      ...partial
    };
    this.emit();
  }

  private emit(): void {
    for (const listener of this.listeners) {
      listener();
    }
  }

  private ensureRealtimeSubscription(sessionId: string, cursor: string | null): void {
    if (this.realtimeClient && this.realtimeSessionId === sessionId) {
      this.realtimeClient.updateCursor(cursor);
      logPerfDebug("butler.runtime.realtime.reuse", {
        workspaceId: this.workspaceId,
        sessionId,
        cursor
      });
      return;
    }

    this.teardownRealtime();
    this.realtimeSessionId = sessionId;
    logPerfDebug("butler.runtime.realtime.subscribe", {
      workspaceId: this.workspaceId,
      sessionId,
      cursor
    });
    this.realtimeClient = new RealtimeClient({
      sessionId,
      cursor,
      limit: BUTLER_MESSAGE_PAGE_SIZE,
      onConnectionChange: () => undefined,
      onSubscribed: () => undefined,
      onEnvelope: (event) => {
        this.handleRealtimeMessages(event.sessionId, event.messages);
      },
      onOlderHistory: (event) => {
        this.handleRealtimeMessages(event.sessionId, event.messages);
      },
      onRuntimeMessage: (event) => {
        this.handleRealtimeRuntimeMessage(event);
      },
      onActivity: (event) => {
        this.handleRealtimeActivity(event);
      },
      onRuntimeStatus: (event) => {
        this.handleRealtimeStatus(event);
      },
      onRuntimeError: (event) => {
        this.handleRealtimeRuntimeError(event);
      },
      onInterrupted: (event) => {
        this.handleRealtimeInterrupted(event);
      },
      onPermissionRequest: (event) => {
        this.handlePermissionRequest(event);
      },
      onPermissionRequestResolved: (event) => {
        this.handlePermissionRequestResolved(event);
      },
      onError: (event) => {
        if (!this.isActiveControlSession(event.sessionId ?? null)) {
          return;
        }

        this.patch({
          error: event.detail
        });
      },
      onUnauthorized: () => {
        this.patch({
          error: t("common.unauthorized")
        });
      }
    });
    this.realtimeClient.start();
  }

  private teardownRealtime(): void {
    this.clearTerminalSyncTimer();
    if (this.realtimeSessionId) {
      logPerfDebug("butler.runtime.realtime.teardown", {
        workspaceId: this.workspaceId,
        sessionId: this.realtimeSessionId
      });
    }
    this.realtimeClient?.close();
    this.realtimeClient = null;
    this.realtimeSessionId = null;
  }

  private clearTerminalSyncTimer(): void {
    if (this.terminalSyncTimer === null) {
      return;
    }

    window.clearTimeout(this.terminalSyncTimer);
    this.terminalSyncTimer = null;
  }

  private scheduleTerminalSessionSync(reason: string, detail: Record<string, unknown>): void {
    this.clearTerminalSyncTimer();
    logPerfDebug("butler.runtime.terminal_sync.scheduled", {
      workspaceId: this.workspaceId,
      controlSessionId: this.state.controlSession?.id ?? null,
      reason,
      ...detail
    });
    this.terminalSyncTimer = window.setTimeout(() => {
      this.terminalSyncTimer = null;

      if (this.controlSessionReloadInFlight) {
        logPerfDebug("butler.runtime.terminal_sync.skipped_inflight", {
          workspaceId: this.workspaceId,
          controlSessionId: this.state.controlSession?.id ?? null,
          reason,
          ...detail
        });
        return;
      }

      this.controlSessionReloadInFlight = true;
      this.terminalSyncCompletedControlSessionId = this.state.controlSession?.id ?? null;
      logPerfDebug("butler.runtime.terminal_sync.start", {
        workspaceId: this.workspaceId,
        controlSessionId: this.state.controlSession?.id ?? null,
        reason,
        ...detail
      });
      void this.reloadControlSession()
        .finally(() => {
          this.controlSessionReloadInFlight = false;
          logPerfDebug("butler.runtime.terminal_sync.end", {
            workspaceId: this.workspaceId,
            controlSessionId: this.state.controlSession?.id ?? null,
            reason,
            ...detail
          });
        });
    }, BUTLER_TERMINAL_SYNC_DEBOUNCE_MS);
  }

  private handleRealtimeMessages(
    sessionId: string,
    incoming: Parameters<typeof toViewMessage>[1][]
  ): void {
    if (!this.isActiveControlSession(sessionId)) {
      logPerfDebug("butler.runtime.realtime.messages.ignored", {
        workspaceId: this.workspaceId,
        sessionId,
        incoming: incoming.length,
        activeSessionId: this.state.controlSession?.session.sessionId ?? null
      });
      return;
    }

    const merged = mergeButlerMessages(this.state.messages, sessionId, incoming);
    this.patch({
      messages: buildButlerVisibleMessages(
        merged,
        this.state.controlSession,
        {
          runningState:
            this.state.controlSession?.session.runningState ?? "idle",
          runtimeHasActiveRun: this.state.runtimeHasActiveRun ?? false,
          runtimeCanInterrupt: this.state.runtimeCanInterrupt ?? false,
          detail: null,
          errorDetail: this.state.error,
          updatedAt: this.state.controlSession?.updatedAt ?? new Date().toISOString()
        }
      ),
      historyState: "ready"
    });
    this.promotePendingRunFromMessages(sessionId, incoming);
    logPerfDebug("butler.runtime.realtime.messages", {
      workspaceId: this.workspaceId,
      sessionId,
      incoming: incoming.length,
      messages: merged.length
    });
  }

  private handleRealtimeRuntimeMessage(event: SessionRuntimeMessageEvent): void {
    this.handleRealtimeMessages(event.sessionId, [event.message]);
  }

  private handleRealtimeActivity(event: SessionActivityEvent): void {
    if (!this.isActiveControlSession(event.sessionId)) {
      return;
    }

    if (event.hasActiveRun) {
      this.terminalSyncArmed = true;
      this.terminalSyncCompletedControlSessionId = null;
    }
    const currentControlSessionId = this.state.controlSession?.id ?? null;
    const shouldSyncTerminalState =
      !event.hasActiveRun
      && this.terminalSyncArmed
      && currentControlSessionId !== null
      && this.terminalSyncCompletedControlSessionId !== currentControlSessionId;
    logPerfDebug("butler.runtime.realtime.activity", {
      workspaceId: this.workspaceId,
      sessionId: event.sessionId,
      hasActiveRun: event.hasActiveRun,
      canInterrupt: event.canInterrupt,
      updatedAt: event.updatedAt,
      shouldSyncTerminalState,
      terminalSyncArmed: this.terminalSyncArmed,
      terminalSyncCompletedControlSessionId: this.terminalSyncCompletedControlSessionId
    });
    this.patchActiveControlSessionRuntimeState({
      runningState: event.runningState,
      hasActiveRun: event.hasActiveRun,
      canInterrupt: event.canInterrupt,
      updatedAt: event.updatedAt
    });

    if (shouldSyncTerminalState) {
      this.scheduleTerminalSessionSync("activity_terminal", {
        sessionId: event.sessionId,
        updatedAt: event.updatedAt
      });
    }
  }

  private handleRealtimeStatus(event: SessionRuntimeStatusEvent): void {
    if (!this.isActiveControlSession(event.sessionId)) {
      return;
    }

    const nextHasActiveRun = event.status === "starting" || event.status === "running";
    if (nextHasActiveRun) {
      this.terminalSyncArmed = true;
      this.terminalSyncCompletedControlSessionId = null;
    }
    const isTerminalStatus =
      event.status === "completed" || event.status === "failed" || event.status === "interrupted";
    const currentControlSessionId = this.state.controlSession?.id ?? null;
    const shouldSyncTerminalState =
      isTerminalStatus
      && (!nextHasActiveRun)
      && this.terminalSyncArmed
      && currentControlSessionId !== null
      && this.terminalSyncCompletedControlSessionId !== currentControlSessionId;
    logPerfDebug("butler.runtime.realtime.status", {
      workspaceId: this.workspaceId,
      sessionId: event.sessionId,
      status: event.status,
      timestamp: event.timestamp,
      shouldSyncTerminalState,
      terminalSyncArmed: this.terminalSyncArmed,
      terminalSyncCompletedControlSessionId: this.terminalSyncCompletedControlSessionId
    });
    this.patchActiveControlSessionRuntimeState({
      runningState: event.status,
      hasActiveRun: nextHasActiveRun,
      canInterrupt: nextHasActiveRun,
      updatedAt: event.timestamp
    });

    if (shouldSyncTerminalState) {
      this.scheduleTerminalSessionSync("status_terminal", {
        sessionId: event.sessionId,
        status: event.status,
        timestamp: event.timestamp
      });
    }
  }

  private handleRealtimeRuntimeError(event: SessionRuntimeErrorEvent): void {
    if (!this.isActiveControlSession(event.sessionId)) {
      return;
    }

    logPerfDebug("butler.runtime.realtime.error", {
      workspaceId: this.workspaceId,
      sessionId: event.sessionId,
      detail: event.detail,
      errorCode: event.error_code
    });
    this.patchActiveControlSessionRuntimeState({
      runningState: "failed",
      hasActiveRun: false,
      canInterrupt: false,
      updatedAt: event.timestamp,
      status: "failed",
      error: event.detail
    });
    void this.reloadControlSession();
  }

  private handleRealtimeInterrupted(event: SessionInterruptedEvent): void {
    if (!this.isActiveControlSession(event.sessionId)) {
      return;
    }

    logPerfDebug("butler.runtime.realtime.interrupted", {
      workspaceId: this.workspaceId,
      sessionId: event.sessionId,
      detail: event.detail
    });
    this.patchActiveControlSessionRuntimeState({
      runningState: "interrupted",
      hasActiveRun: false,
      canInterrupt: false,
      updatedAt: event.timestamp,
      error: event.detail
    });
    void this.reloadControlSession();
  }

  private handlePermissionRequest(event: SessionPermissionRequestEvent): void {
    if (!this.isActiveControlSession(event.sessionId)) {
      return;
    }

    this.patch({
      permissionRequests: upsertPermissionRequest(this.state.permissionRequests, event.request)
    });
  }

  private handlePermissionRequestResolved(event: SessionPermissionRequestResolvedEvent): void {
    if (!this.isActiveControlSession(event.sessionId)) {
      return;
    }

    this.patch({
      permissionRequests: upsertPermissionRequest(this.state.permissionRequests, event.request)
    });
  }

  private patchActiveControlSessionRuntimeState(input: {
    runningState: ButlerControlSessionDto["session"]["runningState"];
    hasActiveRun: boolean;
    canInterrupt: boolean;
    updatedAt: string;
    status?: ButlerControlSessionDto["status"];
    error?: string | null;
  }): void {
    const currentControlSession = this.state.controlSession;

    if (!currentControlSession) {
      this.patch({
        runtimeHasActiveRun: input.hasActiveRun,
        runtimeCanInterrupt: input.canInterrupt,
        ...(input.error !== undefined ? { error: input.error } : {})
      });
      return;
    }

    this.clearPendingRun(currentControlSession.id);

    const nextStatus =
      input.status
      ?? deriveButlerControlSessionStatus(
        currentControlSession.status,
        input.runningState,
        input.hasActiveRun
      );

    this.patch({
      controlSession: {
        ...currentControlSession,
        status: nextStatus,
        updatedAt: input.updatedAt,
        session: {
          ...currentControlSession.session,
          runningState: input.runningState,
          activitySource: "runtime",
          activityState: deriveButlerSessionActivityState(
            currentControlSession.session.activityState,
            input.runningState,
            input.hasActiveRun
          ),
          lastEventAt: input.updatedAt,
          updatedAt: input.updatedAt
        }
      },
      runtimeHasActiveRun: input.hasActiveRun,
      runtimeCanInterrupt: input.canInterrupt,
      ...(input.error !== undefined ? { error: input.error } : {})
    });
  }

  private markPendingRun(controlSessionId: string | null): void {
    if (!controlSessionId) {
      return;
    }

    this.pendingRunControlSession = {
      controlSessionId,
      expiresAt: Date.now() + BUTLER_PENDING_RUN_GRACE_MS
    };
  }

  private clearPendingRun(controlSessionId?: string | null): void {
    if (!this.pendingRunControlSession) {
      return;
    }

    if (
      controlSessionId === undefined
      || controlSessionId === null
      || this.pendingRunControlSession.controlSessionId === controlSessionId
    ) {
      this.pendingRunControlSession = null;
    }
  }

  private hasPendingRun(controlSessionId: string | null): boolean {
    if (!controlSessionId || !this.pendingRunControlSession) {
      return false;
    }

    if (this.pendingRunControlSession.controlSessionId !== controlSessionId) {
      return false;
    }

    if (this.pendingRunControlSession.expiresAt <= Date.now()) {
      this.pendingRunControlSession = null;
      return false;
    }

    return true;
  }

  private resolvePendingRunControlSession(
    controlSession: ButlerControlSessionDto,
    runtime: {
      runningState: ButlerControlSessionDto["session"]["runningState"];
      hasActiveRun: boolean;
      updatedAt: string;
    }
  ): ButlerControlSessionDto {
    if (!this.hasPendingRun(controlSession.id)) {
      return controlSession;
    }

    if (
      runtime.hasActiveRun
      || isButlerRuntimeRunningState(runtime.runningState)
      || isButlerRuntimeTerminalState(runtime.runningState)
      || isButlerRuntimeRunningState(controlSession.session.runningState)
      || isButlerRuntimeTerminalState(controlSession.session.runningState)
      || controlSession.status === "failed"
      || controlSession.status === "closed"
    ) {
      this.clearPendingRun(controlSession.id);
      return controlSession;
    }

    const updatedAt = runtime.updatedAt || controlSession.updatedAt || new Date().toISOString();
    return {
      ...controlSession,
      status: "running",
      updatedAt,
      session: {
        ...controlSession.session,
        runningState: "starting",
        activitySource: "inferred",
        activityState: "running",
        lastEventAt: updatedAt,
        updatedAt
      }
    };
  }

  private promotePendingRunFromMessages(
    sessionId: string,
    incoming: Parameters<typeof toViewMessage>[1][]
  ): void {
    const currentControlSession = this.state.controlSession;

    if (
      !currentControlSession
      || currentControlSession.session.sessionId !== sessionId
      || !this.hasPendingRun(currentControlSession.id)
      || this.state.runtimeHasActiveRun === true
      || isButlerRuntimeRunningState(currentControlSession.session.runningState)
      || isButlerRuntimeTerminalState(currentControlSession.session.runningState)
      || incoming.length === 0
    ) {
      return;
    }

    const updatedAt = incoming.at(-1)?.timestamp ?? new Date().toISOString();
    this.patch({
      controlSession: {
        ...currentControlSession,
        status: "running",
        updatedAt,
        session: {
          ...currentControlSession.session,
          runningState: "running",
          activitySource: "inferred",
          activityState: "running",
          lastEventAt: updatedAt,
          updatedAt
        }
      }
    });
  }

  private isActiveControlSession(sessionId: string | null): boolean {
    return Boolean(sessionId && this.state.controlSession?.session.sessionId === sessionId);
  }
}

export function useButlerRuntimeStore<T>(
  store: ButlerRuntimeStore,
  selector: (state: ButlerRuntimeState) => T
): T {
  const [value, setValue] = useState(() => selector(store.getState()));

  useEffect(() => {
    setValue(selector(store.getState()));
    return store.subscribe(() => {
      setValue(selector(store.getState()));
    });
  }, [selector, store]);

  return value;
}

function createButlerFallbackCapabilities(provider: ButlerProviderId): ProviderCapabilitiesDto {
  const modelOptions: ProviderModelOptionDto[] = [
    {
      id: "provider-default",
      name: t("conversation.modelUseCliDefault"),
      usesProviderDefault: true
    }
  ];

  return {
    provider,
    canStartSession: true,
    canResumeSession: true,
    canSendMessage: true,
    inRunInputMode: provider === "claude-code" ? "streaming_guidance" : "none",
    supportsSubagents: false,
    supportsInterrupt: true,
    supportsStructuredToolCalls: true,
    supportsTokenUsage: true,
    supportsAttachments: false,
    supportsPermissionPrompt: true,
    supportsCheckpoint: false,
    supportsQueueWhileRunning: false,
    supportsRunSteering: false,
    supportsSlashMenu: false,
    supportsReasoningSelector: true,
    modelOptions,
    defaultReasoningLevel: null,
    limitations: []
  };
}

function mergeButlerMessages(
  current: SessionMessageViewModel[],
  sessionId: string,
  incoming: Parameters<typeof toViewMessage>[1][]
): SessionMessageViewModel[] {
  const merged = new Map<string, SessionMessageViewModel>();

  for (const message of current.filter((item) => !isButlerDiagnosticMessage(item))) {
    merged.set(resolveButlerMessageKey(message), message);
  }

  for (const message of incoming) {
    const view = toViewMessage(sessionId, message);
    merged.set(resolveButlerMessageKey(view), view);
  }

  return [...merged.values()].sort((left, right) => {
    if (left.sequence !== right.sequence) {
      return left.sequence - right.sequence;
    }

    return left.timestamp.localeCompare(right.timestamp);
  });
}

function resolveButlerMessageKey(message: Pick<SessionMessageViewModel, "id" | "rawRef">): string {
  return message.id || message.rawRef;
}

function upsertPermissionRequest(
  current: SessionPermissionRequestDto[],
  incoming: SessionPermissionRequestDto
): SessionPermissionRequestDto[] {
  const next = current.filter((item) => item.id !== incoming.id);
  next.push(incoming);
  next.sort((left, right) => {
    if (left.status !== right.status) {
      return left.status === "pending" ? -1 : 1;
    }

    return right.createdAt.localeCompare(left.createdAt);
  });
  return next;
}

function buildButlerVisibleMessages(
  messages: SessionMessageViewModel[],
  controlSession: ButlerControlSessionDto | null,
  runtime: {
    runningState: string | null;
    runtimeHasActiveRun: boolean | null;
    runtimeCanInterrupt: boolean | null;
    detail: string | null;
    errorDetail: string | null;
    updatedAt: string | null;
  }
): SessionMessageViewModel[] {
  const authoritativeMessages = messages.filter((message) => !isButlerDiagnosticMessage(message));

  if (authoritativeMessages.length > 0 || !controlSession) {
    return authoritativeMessages;
  }

  const diagnosticContent = buildButlerEmptyOutputDiagnostic(controlSession, runtime);

  if (!diagnosticContent) {
    return authoritativeMessages;
  }

  return [
    ...authoritativeMessages,
    createButlerDiagnosticMessage(controlSession, diagnosticContent, runtime.updatedAt)
  ];
}

function buildButlerEmptyOutputDiagnostic(
  controlSession: ButlerControlSessionDto,
  runtime: {
    runningState: string | null;
    runtimeHasActiveRun: boolean | null;
    detail: string | null;
    errorDetail: string | null;
  }
): string | null {
  if (runtime.runtimeHasActiveRun) {
    return null;
  }

  const terminalState = runtime.runningState;
  const sessionFailed = controlSession.status === "failed" || terminalState === "failed";
  const sessionTerminal =
    sessionFailed
    || terminalState === "completed"
    || terminalState === "interrupted"
    || (terminalState === "idle" && controlSession.status !== "running");

  if (!sessionTerminal) {
    return null;
  }

  const detail =
    controlSession.lastSummary?.trim()
    || runtime.errorDetail?.trim()
    || runtime.detail?.trim()
    || null;

  const lines = [
    sessionFailed
      ? "本轮助手会话已结束，但没有收到可展示的助手消息。"
      : "本轮助手会话已结束，但 provider 没有返回可展示的助手消息。"
  ];

  if (detail) {
    lines.push("");
    lines.push(`诊断信息：${detail}`);
  }

  return lines.join("\n");
}

function createButlerDiagnosticMessage(
  controlSession: ButlerControlSessionDto,
  content: string,
  updatedAt: string | null
): SessionMessageViewModel {
  const sequenceBase = Number.isFinite(controlSession.session.messageCount)
    ? controlSession.session.messageCount
    : 0;

  return {
    id: `butler-diagnostic-${controlSession.id}`,
    sessionId: controlSession.session.sessionId,
    role: "system",
    kind: "text",
    content,
    toolCall: null,
    attachments: [],
    attachmentPayloads: null,
    origin: "system",
    originRef: controlSession.id,
    timestamp: updatedAt ?? controlSession.updatedAt,
    sequence: sequenceBase + 1,
    rawRef: `${BUTLER_DIAGNOSTIC_RAW_REF_PREFIX}${controlSession.id}`,
    deliveryState: "sent",
    clientRequestId: null
  };
}

function isButlerDiagnosticMessage(message: Pick<SessionMessageViewModel, "rawRef">): boolean {
  return message.rawRef.startsWith(BUTLER_DIAGNOSTIC_RAW_REF_PREFIX);
}

function toErrorMessage(error: unknown): string {
  if (error instanceof Error) {
    return error.message;
  }

  return String(error);
}

function deriveButlerControlSessionStatus(
  currentStatus: ButlerControlSessionDto["status"],
  runningState: ButlerControlSessionDto["session"]["runningState"],
  hasActiveRun: boolean
): ButlerControlSessionDto["status"] {
  if (
    hasActiveRun
    || runningState === "starting"
    || runningState === "running"
    || runningState === "reconnecting"
  ) {
    return "running";
  }

  if (runningState === "failed") {
    return "failed";
  }

  if (currentStatus === "closed") {
    return "closed";
  }

  return "idle";
}

function deriveButlerSessionActivityState(
  currentState: ButlerControlSessionDto["session"]["activityState"],
  runningState: ButlerControlSessionDto["session"]["runningState"],
  hasActiveRun: boolean
): ButlerControlSessionDto["session"]["activityState"] {
  if (
    hasActiveRun
    || runningState === "starting"
    || runningState === "running"
    || runningState === "reconnecting"
  ) {
    return "running";
  }

  if (
    runningState === "completed"
    || runningState === "interrupted"
    || runningState === "failed"
  ) {
    return "completed_unread";
  }

  if (currentState === "running") {
    return "idle";
  }

  return currentState;
}

function isButlerRuntimeRunningState(
  runningState: ButlerControlSessionDto["session"]["runningState"]
): boolean {
  return (
    runningState === "starting"
    || runningState === "running"
    || runningState === "reconnecting"
  );
}

function isButlerRuntimeTerminalState(
  runningState: ButlerControlSessionDto["session"]["runningState"]
): boolean {
  return (
    runningState === "completed"
    || runningState === "failed"
    || runningState === "interrupted"
  );
}
