import { useCallback, useEffect, useRef, useState } from "react";

import { getDefaultSessionPermissionMode } from "../../../preferences/default-session-permission-mode";
import { useLocalUiPreferenceSelector } from "../../../preferences/local-ui-preference-store";
import { usePlatform } from "../../../platform/platform-provider";
import { useHaptics } from "../../../shared/haptics";
import { t } from "../../../shared/i18n";
import { useToast } from "../../../shared/toast";
import {
  forkSession,
  sendLiveMessage,
  type AttachmentPayload,
  type HistoryMessageDto,
  type MessageAttachmentDto,
  type SessionProviderConfigMode,
  type SessionSummaryDto,
  type ProviderId
} from "../api/conversation-api";
import { shouldSupportRunSteering } from "../capability/provider-ui";
import { isSessionRunning } from "../session-activity-display";
import { useSessionSendRecovery } from "../session-send-recovery";
import {
  SessionRuntimeStore,
  useSessionRuntimeStore
} from "./session-runtime-store";
import type { SessionMessageViewModel } from "./session-runtime-machine";

const FOCUS_COMPOSER_EVENT = "workbench:focus-composer";
const RUNTIME_TIMEOUT_TOAST_DELAY_MS = 15_000;
const RUNTIME_THINKING_PLACEHOLDER_HIDE_DELAY_MS = 320;

type PermissionRequestNotificationMode = "always" | "current_only";

interface ForkComposerDraft {
  sourceMessageId: string;
  sourceMessageSnapshot: {
    role: "user" | "assistant" | "tool" | "system";
    kind: "text" | "thinking" | "tool_call" | "tool_result";
    content: string;
  };
  content: string;
  sourceProvider: ProviderId;
  workspaceId: string;
  targetProvider: ProviderId;
  targetModel: string | null;
  targetProviderConfigMode?: SessionProviderConfigMode;
  targetProviderPresetId?: string | null;
}

interface UseLiveSessionControllerInput {
  sessionId: string;
  externalSession: SessionSummaryDto | null;
  bootstrapMessages?: HistoryMessageDto[];
  onSeen?: (sessionId: string, seenAt: string) => void;
  onRequestNavigationRefresh?: () => void;
  onUpsertNavigationSession?: (session: SessionSummaryDto) => void;
  onNavigateToSession?: (workspaceId: string, sessionId: string) => void;
  onBindSessionWorkspace?: (sessionId: string, workspaceId: string | null) => void;
  onResolveMissingSession?: () => void;
  onForkSuccess?: (session: SessionSummaryDto) => void;
  permissionRequestNotificationMode?: PermissionRequestNotificationMode;
  permissionToastIdPrefix?: string;
  isCurrent?: boolean;
  enableRuntimeErrorHandling?: boolean;
  enableCompletionHaptics?: boolean;
  enableThinkingPlaceholder?: boolean;
  enableForkTimelineSanitizer?: boolean;
}

export function focusComposerInput(): void {
  if (typeof window === "undefined") {
    return;
  }

  window.dispatchEvent(new CustomEvent(FOCUS_COMPOSER_EVENT));
}

export function useLiveSessionController(input: UseLiveSessionControllerInput) {
  const storeRef = useRef<SessionRuntimeStore | null>(null);
  const currentSessionIdRef = useRef<string | null>(null);
  const [sending, setSending] = useState(false);
  const [replyingPermissionRequestId, setReplyingPermissionRequestId] = useState<string | null>(null);
  const [deletingQueueItemId, setDeletingQueueItemId] = useState<string | null>(null);
  const [steeringQueueItemId, setSteeringQueueItemId] = useState<string | null>(null);
  const [forkDraft, setForkDraft] = useState<ForkComposerDraft | null>(null);
  const toast = useToast();
  const { showToast } = toast;
  const dismissToast = toast.dismissToast ?? (() => {});
  const notifyOnPermissionRequest = useLocalUiPreferenceSelector(
    (state) => state.notificationPreferences.notifyOnPermissionRequest
  );
  const platform = usePlatform();
  const haptics = useHaptics();
  const lastRuntimeErrorSignatureRef = useRef<string | null>(null);
  const pendingRuntimeErrorSignatureRef = useRef<string | null>(null);
  const delayedRuntimeToastTimerRef = useRef<number | null>(null);
  const previousRunningStateRef = useRef<string | null>(input.externalSession?.runningState ?? null);
  const notifiedPermissionRequestIdsRef = useRef<Set<string>>(new Set());

  if (!storeRef.current || currentSessionIdRef.current !== input.sessionId) {
    storeRef.current?.destroy();
    storeRef.current = new SessionRuntimeStore(input.sessionId, {
      initialSession: input.externalSession,
      bootstrapMessages: input.bootstrapMessages ?? [],
      onSeen: input.onSeen
    });
    currentSessionIdRef.current = input.sessionId;
  }

  const store = storeRef.current;
  const session = useSessionRuntimeStore(store, (state) => state.session);
  const capabilities = useSessionRuntimeStore(store, (state) => state.capabilities);
  const runtimeHasActiveRun = useSessionRuntimeStore(store, (state) => state.runtimeHasActiveRun);
  const runtimeCanInterrupt = useSessionRuntimeStore(store, (state) => state.runtimeCanInterrupt);
  const messages = useSessionRuntimeStore(store, (state) => state.messages);
  const permissionRequests = useSessionRuntimeStore(store, (state) => state.permissionRequests);
  const queuedMessages = useSessionRuntimeStore(store, (state) => state.queuedMessages);
  const contextUsage = useSessionRuntimeStore(store, (state) => state.contextUsage);
  const historyState = useSessionRuntimeStore(store, (state) => state.historyState);
  const runtimeErrorCode = useSessionRuntimeStore(store, (state) => state.errorCode);
  const runtimeErrorDetail = useSessionRuntimeStore(store, (state) => state.errorDetail);
  const runtimeInterruptSource = useSessionRuntimeStore(store, (state) => state.interruptSource);
  const loadingOlderMessages = useSessionRuntimeStore(store, (state) => state.loadingOlderMessages);
  const hasOlderMessages = useSessionRuntimeStore(store, (state) => state.hasOlderMessages);
  const connectionState = useSessionRuntimeStore(store, (state) => state.connectionState);
  const isRunning = isSessionRunning(session);
  const optimisticInterruptibleSendInFlight = sending && !forkDraft;
  const composerHasActiveRun =
    isRunning || runtimeHasActiveRun === true || optimisticInterruptibleSendInFlight
      ? true
      : runtimeHasActiveRun;
  const composerCanInterrupt =
    runtimeCanInterrupt === true || optimisticInterruptibleSendInFlight
      ? true
      : runtimeCanInterrupt;
  const composerIsRunning = isRunning || optimisticInterruptibleSendInFlight;
  const canSteerQueuedMessage =
    session?.provider === capabilities?.provider && shouldSupportRunSteering(capabilities);
  const hasPendingQueuedMessages = queuedMessages.some(
    (item) => item.status === "queued" || item.status === "dispatching"
  );
  const sessionSummary = session ?? input.externalSession ?? null;
  const timelineMessages = input.enableForkTimelineSanitizer === false
    ? messages
    : sanitizeForkTimelineMessages(sessionSummary, messages);
  const runtimeThinkingPlaceholderVisible = useStableRuntimeThinkingPlaceholder({
    sessionId: input.sessionId,
    provider: session?.provider ?? null,
    runningState: session?.runningState ?? null,
    activityState: session?.activityState ?? null,
    runtimeHasActiveRun,
    messages: timelineMessages
  });
  const runtimeThinkingPlaceholder =
    input.enableThinkingPlaceholder === false || !runtimeThinkingPlaceholderVisible
      ? null
      : t("conversation.runtimeThinkingPlaceholder", {
          provider: t("conversation.providerCodex")
        });

  useSessionSendRecovery({
    sending,
    setSending,
    session,
    runtimeHasActiveRun,
    runtimeCanInterrupt
  });

  useEffect(() => {
    store.applyNavigationSession(input.externalSession);
  }, [input.externalSession, store]);

  useEffect(() => {
    void store.initialize();

    return () => {
      store.destroy();
      if (storeRef.current === store) {
        storeRef.current = null;
      }
    };
  }, [store]);

  useEffect(() => {
    setForkDraft(null);
    notifiedPermissionRequestIdsRef.current.clear();
  }, [input.sessionId]);

  useEffect(() => {
    if (!input.onBindSessionWorkspace) {
      return;
    }

    input.onBindSessionWorkspace(input.sessionId, session?.workspaceId ?? null);

    return () => {
      input.onBindSessionWorkspace?.(input.sessionId, null);
    };
  }, [input.onBindSessionWorkspace, input.sessionId, session?.workspaceId]);

  useEffect(() => {
    if (input.enableCompletionHaptics === false) {
      return;
    }

    const previousRunningState = previousRunningStateRef.current;
    const nextRunningState = session?.runningState ?? null;
    const wasActive =
      previousRunningState === "starting"
      || previousRunningState === "running"
      || previousRunningState === "reconnecting";

    if (wasActive && nextRunningState === "completed") {
      void haptics.trigger("success");
    }

    previousRunningStateRef.current = nextRunningState;
  }, [haptics, input.enableCompletionHaptics, session?.runningState]);

  useEffect(() => {
    const notificationMode = input.permissionRequestNotificationMode ?? "always";

    if (notificationMode === "current_only" && !input.isCurrent) {
      return;
    }

    const pendingRequests = permissionRequests.filter((request) => request.status === "pending");
    const sessionWorkspaceId = session?.workspaceId ?? input.externalSession?.workspaceId ?? null;

    for (const request of pendingRequests) {
      if (notifiedPermissionRequestIdsRef.current.has(request.id)) {
        continue;
      }

      notifiedPermissionRequestIdsRef.current.add(request.id);
      if (!notifyOnPermissionRequest) {
        continue;
      }

      showToast({
        id: `${input.permissionToastIdPrefix ?? "permission-request"}-${request.id}`,
        title: t("conversation.permissionRequestToastTitle"),
        description: request.title,
        tone: "warning",
        durationMs: 8_000,
        action:
          sessionWorkspaceId && input.onNavigateToSession
            ? {
                label: t("shell.contextOpenSession"),
                onClick: () => {
                  input.onNavigateToSession?.(sessionWorkspaceId, input.sessionId);
                }
              }
            : undefined
      });
      void platform.bridge.showNotification(
        t("conversation.permissionRequestToastTitle"),
        request.title
      );
    }
  }, [
    input.externalSession?.workspaceId,
    input.isCurrent,
    input.onNavigateToSession,
    input.permissionRequestNotificationMode,
    input.permissionToastIdPrefix,
    input.sessionId,
    notifyOnPermissionRequest,
    permissionRequests,
    platform.bridge,
    session?.workspaceId,
    showToast
  ]);

  useEffect(() => {
    if (input.enableRuntimeErrorHandling === false) {
      return;
    }

    return () => {
      if (delayedRuntimeToastTimerRef.current !== null) {
        window.clearTimeout(delayedRuntimeToastTimerRef.current);
        delayedRuntimeToastTimerRef.current = null;
      }
    };
  }, [input.enableRuntimeErrorHandling]);

  useEffect(() => {
    if (input.enableRuntimeErrorHandling === false) {
      return;
    }

    if (runtimeErrorCode !== "SESSION_NOT_FOUND" && runtimeErrorCode !== "WORKSPACE_NOT_FOUND") {
      return;
    }

    dismissToast("conversation-runtime-error");
    input.onResolveMissingSession?.();
  }, [
    dismissToast,
    input.enableRuntimeErrorHandling,
    input.onResolveMissingSession,
    runtimeErrorCode
  ]);

  useEffect(() => {
    if (input.enableRuntimeErrorHandling === false) {
      return;
    }

    if (runtimeErrorCode === "SESSION_NOT_FOUND" || runtimeErrorCode === "WORKSPACE_NOT_FOUND") {
      if (delayedRuntimeToastTimerRef.current !== null) {
        window.clearTimeout(delayedRuntimeToastTimerRef.current);
        delayedRuntimeToastTimerRef.current = null;
      }

      pendingRuntimeErrorSignatureRef.current = null;
      lastRuntimeErrorSignatureRef.current = null;
      dismissToast("conversation-runtime-error");
      return;
    }

    if (!runtimeErrorCode || !runtimeErrorDetail) {
      if (delayedRuntimeToastTimerRef.current !== null) {
        window.clearTimeout(delayedRuntimeToastTimerRef.current);
        delayedRuntimeToastTimerRef.current = null;
      }

      pendingRuntimeErrorSignatureRef.current = null;
      lastRuntimeErrorSignatureRef.current = null;
      dismissToast("conversation-runtime-error");
      return;
    }

    const signature = `${runtimeErrorCode}:${runtimeErrorDetail}`;

    if (
      lastRuntimeErrorSignatureRef.current === signature
      || pendingRuntimeErrorSignatureRef.current === signature
    ) {
      return;
    }

    if (delayedRuntimeToastTimerRef.current !== null) {
      window.clearTimeout(delayedRuntimeToastTimerRef.current);
      delayedRuntimeToastTimerRef.current = null;
    }

    if (shouldDelayRuntimeErrorToast(session?.provider ?? null, runtimeErrorCode, runtimeErrorDetail)) {
      pendingRuntimeErrorSignatureRef.current = signature;
      delayedRuntimeToastTimerRef.current = window.setTimeout(() => {
        pendingRuntimeErrorSignatureRef.current = null;
        delayedRuntimeToastTimerRef.current = null;
        lastRuntimeErrorSignatureRef.current = signature;
        showToast({
          id: "conversation-runtime-error",
          title: t("conversation.runtimeErrorTitle"),
          description: runtimeErrorDetail,
          tone: "error",
          durationMs: null
        });
      }, RUNTIME_TIMEOUT_TOAST_DELAY_MS);
      return;
    }

    pendingRuntimeErrorSignatureRef.current = null;
    lastRuntimeErrorSignatureRef.current = signature;
    showToast({
      id: "conversation-runtime-error",
      title: t("conversation.runtimeErrorTitle"),
      description: runtimeErrorDetail,
      tone: "error",
      durationMs: null
    });
  }, [
    dismissToast,
    input.enableRuntimeErrorHandling,
    runtimeErrorCode,
    runtimeErrorDetail,
    session?.provider,
    showToast
  ]);

  const sendForkDraftMessage = useCallback(async (
    content: string,
    options?: {
      model?: string;
      reasoningLevel?: string;
      providerConfigMode?: SessionProviderConfigMode;
      providerPresetId?: string | null;
      attachments?: AttachmentPayload[];
      attachmentMeta?: MessageAttachmentDto[];
    }
  ): Promise<void> => {
    const activeForkDraft = forkDraft;

    if (!activeForkDraft) {
      await store.sendMessage(content, {
        model: options?.model,
        reasoningLevel: options?.reasoningLevel,
        providerConfigMode: options?.providerConfigMode,
        providerPresetId: options?.providerPresetId ?? null,
        attachments: options?.attachments,
        attachmentMeta: options?.attachmentMeta
      });
      input.onRequestNavigationRefresh?.();
      return;
    }

    let forkedSession: SessionSummaryDto | null = null;

    try {
      forkedSession = await forkSession(input.sessionId, {
        sourceType: "message",
        sourceMessageId: activeForkDraft.sourceMessageId,
        sourceMessageSnapshot: activeForkDraft.sourceMessageSnapshot,
        strategy: "auto",
        targetProvider: activeForkDraft.targetProvider,
        providerConfigMode: activeForkDraft.targetProviderConfigMode ?? options?.providerConfigMode,
        providerPresetId: activeForkDraft.targetProviderPresetId ?? options?.providerPresetId ?? null
      });
      input.onUpsertNavigationSession?.(forkedSession);

      await sendLiveMessage(forkedSession.sessionId, {
        content,
        clientRequestId: createClientRequestId(),
        model: activeForkDraft.targetModel,
        reasoningLevel: options?.reasoningLevel ?? null,
        permissionMode: getDefaultSessionPermissionMode(),
        attachments: options?.attachments ?? [],
        providerConfigMode: activeForkDraft.targetProviderConfigMode ?? options?.providerConfigMode,
        providerPresetId: activeForkDraft.targetProviderPresetId ?? options?.providerPresetId ?? null
      });

      setForkDraft(null);
      input.onRequestNavigationRefresh?.();
      input.onNavigateToSession?.(forkedSession.workspaceId, forkedSession.sessionId);
      input.onForkSuccess?.(forkedSession);
    } catch (error) {
      if (forkedSession) {
        input.onUpsertNavigationSession?.(forkedSession);
        input.onRequestNavigationRefresh?.();
      }

      throw error;
    }
  }, [
    forkDraft,
    input,
    store
  ]);

  const send = useCallback(async (
    content: string,
    options?: {
      model?: string;
      reasoningLevel?: string;
      providerConfigMode?: SessionProviderConfigMode;
      providerPresetId?: string | null;
      attachments?: AttachmentPayload[];
      attachmentMeta?: MessageAttachmentDto[];
    }
  ): Promise<void> => {
    setSending(true);

    try {
      await sendForkDraftMessage(content, options);
    } finally {
      setSending(false);
    }
  }, [sendForkDraftMessage]);

  const queue = useCallback(async (
    content: string,
    options?: {
      model?: string;
      reasoningLevel?: string;
      providerConfigMode?: SessionProviderConfigMode;
      providerPresetId?: string | null;
      attachments?: AttachmentPayload[];
      attachmentMeta?: MessageAttachmentDto[];
    }
  ): Promise<void> => {
    setSending(true);

    try {
      if (forkDraft) {
        await sendForkDraftMessage(content, options);
      } else {
        await store.enqueueMessage(content, {
          model: options?.model,
          reasoningLevel: options?.reasoningLevel,
          providerConfigMode: options?.providerConfigMode,
          providerPresetId: options?.providerPresetId ?? null,
          attachments: options?.attachments,
          attachmentMeta: options?.attachmentMeta
        });
      }
    } finally {
      setSending(false);
    }
  }, [forkDraft, sendForkDraftMessage, store]);

  const replyPermissionRequest = useCallback(async (
    requestId: string,
    payload: { action: string; answers?: Record<string, string[]> }
  ): Promise<void> => {
    setReplyingPermissionRequestId(requestId);

    try {
      await store.replyPermissionRequest(requestId, payload);
    } catch (error) {
      showToast({
        title: t("conversation.permissionRequestReplyFailed"),
        description: error instanceof Error ? error.message : undefined,
        tone: "error"
      });
    } finally {
      setReplyingPermissionRequestId(null);
    }
  }, [showToast, store]);

  const deleteQueuedMessage = useCallback(async (queueItemId: string): Promise<void> => {
    setDeletingQueueItemId(queueItemId);

    try {
      await store.deleteQueuedMessage(queueItemId);
    } finally {
      setDeletingQueueItemId(null);
    }
  }, [store]);

  const steerQueuedMessage = useCallback(async (queueItemId: string): Promise<void> => {
    setSteeringQueueItemId(queueItemId);

    try {
      await store.steerQueuedMessage(queueItemId);
      input.onRequestNavigationRefresh?.();
    } finally {
      setSteeringQueueItemId(null);
    }
  }, [input.onRequestNavigationRefresh, store]);

  const interrupt = useCallback(async (): Promise<void> => {
    await store.interrupt();
    input.onRequestNavigationRefresh?.();
  }, [input.onRequestNavigationRefresh, store]);

  return {
    session: sessionSummary,
    capabilities,
    runtimeHasActiveRun,
    runtimeCanInterrupt,
    messages,
    timelineMessages,
    permissionRequests,
    queuedMessages,
    contextUsage,
    historyState,
    runtimeErrorCode,
    runtimeErrorDetail,
    runtimeInterruptSource,
    loadingOlderMessages,
    hasOlderMessages,
    connectionState,
    sending,
    replyingPermissionRequestId,
    deletingQueueItemId,
    steeringQueueItemId,
    forkDraft,
    setForkDraft,
    composerHasActiveRun,
    composerCanInterrupt,
    composerIsRunning,
    canSteerQueuedMessage,
    hasPendingQueuedMessages,
    runtimeThinkingPlaceholder,
    reconnect: store.reconnect.bind(store),
    loadOlderMessages: store.loadOlderMessages.bind(store),
    retryMessage: store.retryMessage.bind(store),
    send,
    queue,
    interrupt,
    replyPermissionRequest,
    deleteQueuedMessage,
    steerQueuedMessage
  };
}

function createClientRequestId(): string {
  const nativeCrypto = globalThis.crypto;

  if (nativeCrypto && typeof nativeCrypto.randomUUID === "function") {
    return nativeCrypto.randomUUID();
  }

  return `${Date.now()}-${Math.random().toString(16).slice(2)}`;
}

function shouldDelayRuntimeErrorToast(
  provider: ProviderId | null,
  errorCode: string,
  errorDetail: string
): boolean {
  if (provider !== "opencode") {
    return false;
  }

  return (
    errorCode === "OPENCODE_REQUEST_TIMEOUT"
    || errorCode === "PROVIDER_RUNTIME_TIMEOUT"
    || /\bSERVER_TIMEOUT\b/i.test(errorDetail)
    || /timeout/i.test(errorDetail)
    || /超时/.test(errorDetail)
  );
}

function useStableRuntimeThinkingPlaceholder(input: {
  sessionId: string;
  provider: ProviderId | null;
  runningState: string | null;
  activityState: string | null | undefined;
  runtimeHasActiveRun: boolean | null;
  messages: SessionMessageViewModel[];
}): boolean {
  const visibility = resolveRuntimeThinkingPlaceholderVisibility(input);
  const [visible, setVisible] = useState(visibility === "show");
  const hideTimerRef = useRef<number | null>(null);

  useEffect(() => {
    if (hideTimerRef.current !== null) {
      window.clearTimeout(hideTimerRef.current);
      hideTimerRef.current = null;
    }

    setVisible(visibility === "show");
  }, [input.sessionId]);

  useEffect(() => {
    if (visibility === "show") {
      if (hideTimerRef.current !== null) {
        window.clearTimeout(hideTimerRef.current);
        hideTimerRef.current = null;
      }

      setVisible(true);
      return;
    }

    if (visibility === "hide_immediately") {
      if (hideTimerRef.current !== null) {
        window.clearTimeout(hideTimerRef.current);
        hideTimerRef.current = null;
      }

      setVisible(false);
      return;
    }

    if (!visible || hideTimerRef.current !== null) {
      return;
    }

    hideTimerRef.current = window.setTimeout(() => {
      hideTimerRef.current = null;
      setVisible(false);
    }, RUNTIME_THINKING_PLACEHOLDER_HIDE_DELAY_MS);
  }, [visibility, visible]);

  useEffect(() => {
    return () => {
      if (hideTimerRef.current !== null) {
        window.clearTimeout(hideTimerRef.current);
      }
    };
  }, []);

  return visible;
}

function resolveRuntimeThinkingPlaceholderVisibility(
  input: {
    provider: ProviderId | null;
    runningState: string | null;
    activityState: string | null | undefined;
    runtimeHasActiveRun: boolean | null;
    messages: SessionMessageViewModel[];
  }
): "show" | "hide_immediately" | "hide_deferred" {
  const { provider, runningState, activityState, runtimeHasActiveRun, messages } = input;

  if (provider !== "codex") {
    return "hide_immediately";
  }

  const latestUserIndex = findLatestRuntimePlaceholderUserIndex(messages);

  if (latestUserIndex < 0) {
    return "hide_immediately";
  }

  if (hasAssistantReplyAfterUser(messages, latestUserIndex)) {
    return "hide_immediately";
  }

  if (hasActiveRuntimeIndicator(runningState, activityState, runtimeHasActiveRun)) {
    return "show";
  }

  return "hide_deferred";
}

function hasActiveRuntimeIndicator(
  runningState: string | null,
  activityState: string | null | undefined,
  runtimeHasActiveRun: boolean | null
): boolean {
  return (
    runtimeHasActiveRun === true
    || activityState === "running"
    || runningState === "starting"
    || runningState === "running"
    || runningState === "reconnecting"
  );
}

function hasAssistantReplyAfterUser(
  messages: SessionMessageViewModel[],
  latestUserIndex: number
): boolean {
  return messages.slice(latestUserIndex + 1).some((message) => {
    return message.role === "assistant" && (message.kind === "text" || message.kind === "thinking");
  });
}

function findLatestRuntimePlaceholderUserIndex(messages: SessionMessageViewModel[]): number {
  let latestUserIndex = -1;

  for (let index = messages.length - 1; index >= 0; index -= 1) {
    const message = messages[index];

    if (message.role === "user" && message.kind === "text") {
      latestUserIndex = index;
      break;
    }
  }

  return latestUserIndex;
}

function sanitizeForkTimelineMessages(
  session: SessionSummaryDto | null,
  messages: SessionMessageViewModel[]
): SessionMessageViewModel[] {
  if (
    !session
    || session.forkSourceType !== "message"
    || typeof session.inheritedPrefixMessageCount !== "number"
    || session.inheritedPrefixMessageCount < 0
  ) {
    return messages;
  }

  const childCreatedAt = session.createdAt?.trim() || "";

  if (childCreatedAt.length === 0) {
    return messages;
  }

  const inheritedBoundary = Math.max(0, session.inheritedPrefixMessageCount);

  return messages.filter((message) => {
    if (message.sequence <= inheritedBoundary) {
      return true;
    }

    return message.timestamp >= childCreatedAt;
  });
}
