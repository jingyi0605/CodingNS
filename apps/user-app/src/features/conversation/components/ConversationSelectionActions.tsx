import { useEffect, useMemo, useRef, useState, type CSSProperties, type RefObject } from "react";
import { createPortal } from "react-dom";
import { useNavigate } from "react-router-dom";

import { getDefaultSessionPermissionMode } from "../../../preferences/default-session-permission-mode";
import { usePreferencesSelector } from "../../../preferences/preferences-store";
import { usePlatform } from "../../../platform/platform-provider";
import { t } from "../../../shared/i18n";
import { useToast } from "../../../shared/toast";
import {
  forkSession,
  getProviderCapabilities,
  listProviderCapabilities,
  getSessionDetail,
  startLiveSession,
  sendLiveMessage,
  type BuiltinProviderId,
  type ProviderCapabilitiesDto,
  type SessionSummaryDto
} from "../api/conversation-api";
import {
  createDraftCapabilities,
  getProviderDisplayName,
  SESSION_PROVIDER_PICKER_IDS
} from "../capability/provider-ui";
import { useWorkbenchShell } from "./WorkbenchLayout";
import { WorkspaceInboxModal } from "./WorkspaceInboxModal";
import { buildWorkspaceSessionPath } from "../../workbench/utils/workbench-navigation";

interface ConversationSelectionActionsProps {
  containerRef: RefObject<HTMLElement | null>;
  session: SessionSummaryDto | null;
  currentCapabilities: ProviderCapabilitiesDto | null;
}

interface SelectionSnapshot {
  text: string;
  sourceMessageId: string | null;
  rect: {
    left: number;
    top: number;
    right: number;
    bottom: number;
    width: number;
    height: number;
  };
}

const PROVIDER_DEFAULT_MODEL_ID = "provider-default";
const DESKTOP_SELECTION_DIALOG_ESTIMATED_HEIGHT = 420;
const DESKTOP_SELECTION_DIALOG_MAX_HEIGHT = 520;
const MOBILE_SELECTION_DIALOG_MAX_HEIGHT_OFFSET = 32;
const SELECTION_COMMIT_DELAY_MS = 48;

function copyTextWithExecCommand(text: string): boolean {
  if (typeof document === "undefined") {
    return false;
  }

  const textarea = document.createElement("textarea");
  textarea.value = text;
  textarea.setAttribute("readonly", "true");
  textarea.style.position = "fixed";
  textarea.style.opacity = "0";
  textarea.style.pointerEvents = "none";
  document.body.appendChild(textarea);
  textarea.focus();
  textarea.select();

  try {
    return document.execCommand("copy");
  } catch {
    return false;
  } finally {
    document.body.removeChild(textarea);
  }
}

async function writeTextToClipboard(
  text: string,
  platform: ReturnType<typeof usePlatform>
): Promise<void> {
  if (platform.isDesktop) {
    const desktopResult = await platform.bridge.writeClipboardText(text);

    if (desktopResult.ok) {
      return;
    }
  }

  if (typeof navigator !== "undefined" && navigator.clipboard?.writeText) {
    try {
      await navigator.clipboard.writeText(text);
      return;
    } catch {
      // 浏览器剪贴板失败时继续走兼容回退。
    }
  }

  if (copyTextWithExecCommand(text)) {
    return;
  }

  throw new Error(t("conversation.copyContentFailed"));
}

function clamp(value: number, min: number, max: number): number {
  return Math.min(Math.max(value, min), max);
}

function resolveBuiltinProvider(value: string | null | undefined): BuiltinProviderId {
  if (value && SESSION_PROVIDER_PICKER_IDS.includes(value as BuiltinProviderId)) {
    return value as BuiltinProviderId;
  }

  return "codex";
}

function getNodeElement(node: Node | null): Element | null {
  if (!node) {
    return null;
  }

  return node.nodeType === Node.ELEMENT_NODE ? (node as Element) : node.parentElement;
}

function resolveMessageId(node: Node | null): string | null {
  const element = getNodeElement(node);
  return element?.closest("[data-message-id]")?.getAttribute("data-message-id")?.trim() || null;
}

function buildSelectionPrompt(selectionText: string, actionPrompt: string): string {
  const normalizedQuestion = actionPrompt.trim() || t("conversation.selectionActionDefaultPrompt");

  return [
    normalizedQuestion,
    "",
    t("conversation.selectionActionQuotedLabel"),
    "```text",
    selectionText.trim(),
    "```"
  ].join("\n");
}

function buildSelectionSnapshot(container: HTMLElement): SelectionSnapshot | null {
  if (typeof window === "undefined") {
    return null;
  }

  const currentSelection = window.getSelection();

  if (!currentSelection || currentSelection.rangeCount === 0 || currentSelection.isCollapsed) {
    return null;
  }

  const range = currentSelection.getRangeAt(0);
  const startElement = getNodeElement(range.startContainer);
  const endElement = getNodeElement(range.endContainer);

  if (!startElement || !endElement || !container.contains(startElement) || !container.contains(endElement)) {
    return null;
  }

  const text = currentSelection.toString().trim();

  if (!text) {
    return null;
  }

  const rect = range.getBoundingClientRect();

  if (!rect.width && !rect.height) {
    return null;
  }

  const startMessageId = resolveMessageId(range.startContainer);
  const endMessageId = resolveMessageId(range.endContainer);

  return {
    text,
    sourceMessageId:
      startMessageId && startMessageId === endMessageId
        ? startMessageId
        : null,
    rect: {
      left: rect.left,
      top: rect.top,
      right: rect.right,
      bottom: rect.bottom,
      width: rect.width,
      height: rect.height
    }
  };
}

export function ConversationSelectionActions({
  containerRef,
  session,
  currentCapabilities
}: ConversationSelectionActionsProps) {
  const navigate = useNavigate();
  const platform = usePlatform();
  const { showToast } = useToast();
  const {
    shellMode,
    requestNavigationRefresh,
    selectWorkspace,
    upsertNavigationSession
  } = useWorkbenchShell();
  const providerPreferences = usePreferencesSelector((state) => state.profile.providers);
  const [selection, setSelection] = useState<SelectionSnapshot | null>(null);
  const [actionDialogOpen, setActionDialogOpen] = useState(false);
  const [actionPrompt, setActionPrompt] = useState("");
  const [includeContext, setIncludeContext] = useState(false);
  const [selectedProvider, setSelectedProvider] = useState<BuiltinProviderId>(
    resolveBuiltinProvider(session?.provider)
  );
  const [selectedModel, setSelectedModel] = useState(PROVIDER_DEFAULT_MODEL_ID);
  const [providerCapabilities, setProviderCapabilities] = useState<ProviderCapabilitiesDto | null>(null);
  const [providerCapabilitiesMap, setProviderCapabilitiesMap] = useState<
    Partial<Record<BuiltinProviderId, ProviderCapabilitiesDto>>
  >({});
  const [loadingCapabilities, setLoadingCapabilities] = useState(false);
  const [submittingAction, setSubmittingAction] = useState(false);
  const [todoModalOpen, setTodoModalOpen] = useState(false);
  const [todoCreationRequestId, setTodoCreationRequestId] = useState(0);
  const [todoDraft, setTodoDraft] = useState<{ title: string; content: string } | null>(null);
  const [viewportSize, setViewportSize] = useState(() => ({
    width: typeof window === "undefined" ? 0 : window.innerWidth,
    height: typeof window === "undefined" ? 0 : window.innerHeight
  }));
  const actionDialogLockedRef = useRef(false);
  const pointerSelectionActiveRef = useRef(false);
  const pendingSelectionRef = useRef<SelectionSnapshot | null>(null);
  const selectionCommitTimerRef = useRef<number | null>(null);
  const isMobileSelectionDialog = shellMode === "mobile" || platform.isMobile;

  const preferredModelForProvider = useMemo(() => {
    return (provider: BuiltinProviderId): string =>
      providerPreferences[provider]?.defaultModel?.trim() || PROVIDER_DEFAULT_MODEL_ID;
  }, [providerPreferences]);
  const effectiveCapabilities = useMemo(() => {
    if (selectedProvider === session?.provider && currentCapabilities) {
      return currentCapabilities;
    }

    return providerCapabilities ?? createDraftCapabilities(selectedProvider);
  }, [currentCapabilities, providerCapabilities, selectedProvider, session?.provider]);
  const modelOptions = useMemo(() => {
    const fallbackOptions = createDraftCapabilities(selectedProvider).modelOptions ?? [];
    return effectiveCapabilities.modelOptions?.length
      ? effectiveCapabilities.modelOptions
      : fallbackOptions;
  }, [effectiveCapabilities.modelOptions, selectedProvider]);
  const currentModelOption = useMemo(
    () => modelOptions.find((item) => item.id === selectedModel) ?? modelOptions[0] ?? null,
    [modelOptions, selectedModel]
  );
  const selectedProviderDisabledReason = useMemo(() => {
    const selectedCapabilities =
      providerCapabilitiesMap[selectedProvider]
      ?? (selectedProvider === session?.provider ? currentCapabilities : providerCapabilities);

    if (!selectedCapabilities || selectedCapabilities.canStartSession !== false) {
      return null;
    }

    return selectedCapabilities.limitations[0] ?? t("conversation.capabilityDenied");
  }, [currentCapabilities, providerCapabilities, providerCapabilitiesMap, selectedProvider, session?.provider]);
  const toolbarStyle = useMemo<CSSProperties | null>(() => {
    if (!selection || typeof window === "undefined") {
      return null;
    }

    const containerRect = containerRef.current?.getBoundingClientRect();
    const minLeft = containerRect ? Math.max(80, containerRect.left + 80) : 96;
    const maxLeft = containerRect
      ? Math.min(viewportSize.width - 80, containerRect.right - 80)
      : viewportSize.width - 96;
    const minTop = containerRect ? Math.max(12, containerRect.top + 12) : 12;
    const maxTop = containerRect ? Math.max(minTop, containerRect.bottom - 48) : Math.max(12, viewportSize.height - 48);
    const centerX = selection.rect.left + selection.rect.width / 2;

    return {
      left: clamp(centerX, minLeft, Math.max(minLeft, maxLeft)),
      top: clamp(selection.rect.top - 48, minTop, maxTop)
    };
  }, [containerRef, selection, viewportSize.height, viewportSize.width]);
  const actionDialogStyle = useMemo<CSSProperties | null>(() => {
    if (!selection || typeof window === "undefined") {
      return null;
    }

    const containerRect = containerRef.current?.getBoundingClientRect();
    const safeContainerLeft = containerRect?.left ?? 0;
    const safeContainerRight = containerRect?.right ?? viewportSize.width;
    const safeContainerTop = containerRect?.top ?? 0;
    const safeContainerBottom = containerRect?.bottom ?? viewportSize.height;

    if (isMobileSelectionDialog) {
      return {
        left: viewportSize.width / 2,
        top: viewportSize.height / 2,
        width: Math.min(420, Math.max(280, viewportSize.width - 24)),
        maxHeight: Math.max(260, viewportSize.height - MOBILE_SELECTION_DIALOG_MAX_HEIGHT_OFFSET),
        transform: "translate(-50%, -50%)"
      };
    }

    const availableWidth = Math.max(
      280,
      Math.min(viewportSize.width - 24, safeContainerRight - safeContainerLeft - 24)
    );
    const width = Math.min(420, availableWidth);
    const centerX = selection.rect.left + selection.rect.width / 2;
    const minLeft = Math.max(12, safeContainerLeft + 12);
    const maxLeft = Math.max(minLeft, Math.min(viewportSize.width - width - 12, safeContainerRight - width - 12));
    const maxHeight = Math.min(
      DESKTOP_SELECTION_DIALOG_MAX_HEIGHT,
      Math.max(280, safeContainerBottom - safeContainerTop - 24),
      Math.max(280, viewportSize.height - 24)
    );
    const minTop = Math.max(12, safeContainerTop + 12);
    const maxTop = Math.max(minTop, Math.min(viewportSize.height - maxHeight - 12, safeContainerBottom - maxHeight - 12));
    const preferredTop = selection.rect.top - DESKTOP_SELECTION_DIALOG_ESTIMATED_HEIGHT - 18;

    return {
      left: clamp(centerX - width / 2, minLeft, maxLeft),
      top: clamp(preferredTop, minTop, maxTop),
      width,
      maxHeight
    };
  }, [containerRef, isMobileSelectionDialog, selection, viewportSize.height, viewportSize.width]);

  useEffect(() => {
    if (typeof window === "undefined") {
      return;
    }

    const handleResize = () => {
      setViewportSize({
        width: window.innerWidth,
        height: window.innerHeight
      });
    };

    handleResize();
    window.addEventListener("resize", handleResize);
    return () => {
      window.removeEventListener("resize", handleResize);
    };
  }, []);

  useEffect(() => {
    if (!session) {
      if (selectionCommitTimerRef.current !== null && typeof window !== "undefined") {
        window.clearTimeout(selectionCommitTimerRef.current);
        selectionCommitTimerRef.current = null;
      }

      pendingSelectionRef.current = null;
      pointerSelectionActiveRef.current = false;
      setSelection(null);
      setActionDialogOpen(false);
      return;
    }

    const nextProvider = resolveBuiltinProvider(session.provider);
    setSelectedProvider(nextProvider);
    setSelectedModel(preferredModelForProvider(nextProvider));
  }, [preferredModelForProvider, session]);

  useEffect(() => {
    if (!session || !containerRef.current || typeof window === "undefined") {
      if (selectionCommitTimerRef.current !== null) {
        window.clearTimeout(selectionCommitTimerRef.current);
        selectionCommitTimerRef.current = null;
      }

      pendingSelectionRef.current = null;
      pointerSelectionActiveRef.current = false;
      setSelection(null);
      return;
    }

    const container = containerRef.current;

    const commitSelection = (nextSelection: SelectionSnapshot | null) => {
      if (actionDialogLockedRef.current) {
        return;
      }

      pendingSelectionRef.current = nextSelection;
      setSelection(nextSelection);

      if (!nextSelection) {
        setActionDialogOpen(false);
      }
    };

    const clearSelectionCommitTimer = () => {
      if (selectionCommitTimerRef.current === null) {
        return;
      }

      window.clearTimeout(selectionCommitTimerRef.current);
      selectionCommitTimerRef.current = null;
    };

    const scheduleSelectionCommit = (
      nextSelection: SelectionSnapshot | null,
      options?: { immediate?: boolean }
    ) => {
      pendingSelectionRef.current = nextSelection;
      clearSelectionCommitTimer();

      if (options?.immediate) {
        commitSelection(nextSelection);
        return;
      }

      selectionCommitTimerRef.current = window.setTimeout(() => {
        selectionCommitTimerRef.current = null;
        commitSelection(pendingSelectionRef.current);
      }, SELECTION_COMMIT_DELAY_MS);
    };

    const updateSelection = () => {
      const nextSelection = buildSelectionSnapshot(container);

      if (pointerSelectionActiveRef.current) {
        pendingSelectionRef.current = nextSelection;
        return;
      }

      scheduleSelectionCommit(nextSelection);
    };

    const refreshSelection = () => {
      const nextSelection = buildSelectionSnapshot(container);

      if (pointerSelectionActiveRef.current) {
        pendingSelectionRef.current = nextSelection;
        return;
      }

      scheduleSelectionCommit(nextSelection, { immediate: true });
    };

    const handlePointerDown = (event: PointerEvent) => {
      if (!(event.target instanceof Node) || !container.contains(event.target)) {
        return;
      }

      pointerSelectionActiveRef.current = true;
      clearSelectionCommitTimer();
    };

    const settleSelection = () => {
      if (!pointerSelectionActiveRef.current) {
        return;
      }

      pointerSelectionActiveRef.current = false;
      scheduleSelectionCommit(buildSelectionSnapshot(container));
    };

    document.addEventListener("pointerdown", handlePointerDown);
    document.addEventListener("selectionchange", updateSelection);
    window.addEventListener("pointerup", settleSelection);
    window.addEventListener("pointercancel", settleSelection);
    window.addEventListener("mouseup", settleSelection);
    window.addEventListener("touchend", settleSelection);
    window.addEventListener("resize", refreshSelection);
    window.addEventListener("scroll", refreshSelection, true);

    return () => {
      clearSelectionCommitTimer();
      document.removeEventListener("pointerdown", handlePointerDown);
      document.removeEventListener("selectionchange", updateSelection);
      window.removeEventListener("pointerup", settleSelection);
      window.removeEventListener("pointercancel", settleSelection);
      window.removeEventListener("mouseup", settleSelection);
      window.removeEventListener("touchend", settleSelection);
      window.removeEventListener("resize", refreshSelection);
      window.removeEventListener("scroll", refreshSelection, true);
    };
  }, [containerRef, session]);

  useEffect(() => {
    if (!actionDialogOpen || !selection?.sourceMessageId) {
      setIncludeContext(false);
    }
  }, [actionDialogOpen, selection?.sourceMessageId]);

  useEffect(() => {
    if (!actionDialogOpen || !session) {
      return;
    }

    let cancelled = false;

    if (selectedProvider === session.provider && currentCapabilities) {
      setLoadingCapabilities(false);
      setProviderCapabilities(currentCapabilities);
      return () => {
        cancelled = true;
      };
    }

    setLoadingCapabilities(true);
    setProviderCapabilities(createDraftCapabilities(selectedProvider));
    void getProviderCapabilities(selectedProvider, session.workspaceId)
      .then((result) => {
        if (!cancelled) {
          setProviderCapabilities(result);
        }
      })
      .catch(() => {
        if (!cancelled) {
          setProviderCapabilities(createDraftCapabilities(selectedProvider));
        }
      })
      .finally(() => {
        if (!cancelled) {
          setLoadingCapabilities(false);
        }
      });

    return () => {
      cancelled = true;
    };
  }, [actionDialogOpen, currentCapabilities, selectedProvider, session]);

  useEffect(() => {
    if (!actionDialogOpen || !session) {
      setProviderCapabilitiesMap({});
      return;
    }

    let cancelled = false;

    void listProviderCapabilities(SESSION_PROVIDER_PICKER_IDS, session.workspaceId).then((nextCapabilities) => {
      if (!cancelled) {
        setProviderCapabilitiesMap(nextCapabilities as Partial<Record<BuiltinProviderId, ProviderCapabilitiesDto>>);
      }
    });

    return () => {
      cancelled = true;
    };
  }, [actionDialogOpen, session]);

  useEffect(() => {
    if (!actionDialogOpen || !session) {
      return;
    }

    const selectableProviders = SESSION_PROVIDER_PICKER_IDS.filter((providerId) => {
      const capabilities = providerCapabilitiesMap[providerId];
      return !capabilities || capabilities.canStartSession !== false;
    });

    if (selectableProviders.length === 0) {
      return;
    }

    if (selectableProviders.includes(selectedProvider)) {
      return;
    }

    const nextProvider = selectableProviders[0];
    setSelectedProvider(nextProvider);
    setSelectedModel(preferredModelForProvider(nextProvider));
  }, [actionDialogOpen, preferredModelForProvider, providerCapabilitiesMap, selectedProvider, session]);

  useEffect(() => {
    const preferredModel = preferredModelForProvider(selectedProvider);

    if (modelOptions.some((item) => item.id === selectedModel)) {
      return;
    }

    if (modelOptions.some((item) => item.id === preferredModel)) {
      setSelectedModel(preferredModel);
      return;
    }

    setSelectedModel(modelOptions[0]?.id ?? PROVIDER_DEFAULT_MODEL_ID);
  }, [modelOptions, preferredModelForProvider, selectedModel, selectedProvider]);

  useEffect(() => {
    if (!actionDialogOpen) {
      actionDialogLockedRef.current = false;
      return;
    }

    actionDialogLockedRef.current = true;
  }, [actionDialogOpen]);

  useEffect(() => {
    if (typeof window === "undefined") {
      return;
    }

    const handleKeyDown = (event: KeyboardEvent) => {
      if (event.key !== "Escape") {
        return;
      }

      setActionDialogOpen(false);
      setSelection(null);
      actionDialogLockedRef.current = false;
    };

    window.addEventListener("keydown", handleKeyDown);
    return () => {
      window.removeEventListener("keydown", handleKeyDown);
    };
  }, []);

  async function handleCopy() {
    if (!selection) {
      return;
    }

    try {
      await writeTextToClipboard(selection.text, platform);
      showToast({
        title: t("conversation.copyContentSuccess"),
        tone: "success"
      });
    } catch (error) {
      showToast({
        title: error instanceof Error ? error.message : t("conversation.copyContentFailed"),
        tone: "error"
      });
    }
  }

  function handleCreateTodo() {
    if (!selection) {
      return;
    }

    setTodoDraft({
      title: "",
      content: selection.text
    });
    setTodoCreationRequestId((current) => current + 1);
    setTodoModalOpen(true);
    setActionDialogOpen(false);
    setSelection(null);
    actionDialogLockedRef.current = false;
  }

  function handleOpenActionDialog() {
    if (!selection || !session) {
      return;
    }

    const nextProvider = resolveBuiltinProvider(session.provider);
    setSelectedProvider(nextProvider);
    setSelectedModel(preferredModelForProvider(nextProvider));
    setActionPrompt("");
    setIncludeContext(false);
    setActionDialogOpen(true);
  }

  async function handleSubmitAction() {
    if (!selection || !session) {
      return;
    }

    if (selectedProviderDisabledReason) {
      showToast({
        title: selectedProviderDisabledReason,
        tone: "error"
      });
      return;
    }

    setSubmittingAction(true);

    try {
      const content = buildSelectionPrompt(selection.text, actionPrompt);
      const model = currentModelOption?.id === PROVIDER_DEFAULT_MODEL_ID ? null : currentModelOption?.id ?? null;
      let nextSession: SessionSummaryDto | null = null;

      if (includeContext && selection.sourceMessageId) {
        nextSession = await forkSession(session.sessionId, {
          sourceType: "message",
          sourceMessageId: selection.sourceMessageId,
          strategy: "auto",
          targetProvider: selectedProvider,
          sessionKind: "annotation",
          annotationSourceMessageId: selection.sourceMessageId,
          annotationSourceText: selection.text
        });
        upsertNavigationSession(nextSession);

        await sendLiveMessage(nextSession.sessionId, {
          content,
          clientRequestId:
            globalThis.crypto?.randomUUID?.() ?? `selection-action-${Date.now()}-${Math.random().toString(16).slice(2)}`,
          model,
          permissionMode: getDefaultSessionPermissionMode()
        });
      } else {
        const response = await startLiveSession({
          workspaceId: session.workspaceId,
          provider: selectedProvider,
          content,
          clientRequestId:
            globalThis.crypto?.randomUUID?.() ?? `selection-action-${Date.now()}-${Math.random().toString(16).slice(2)}`,
          model,
          permissionMode: getDefaultSessionPermissionMode(),
          parentSessionId: session.sessionId,
          sessionKind: "annotation",
          annotationSourceMessageId: selection.sourceMessageId ?? null,
          annotationSourceText: selection.text
        });

        nextSession = response.session ?? await getSessionDetail(response.sessionId);
      }

      upsertNavigationSession(nextSession);
      requestNavigationRefresh();
      selectWorkspace(nextSession.workspaceId);
      navigate(buildWorkspaceSessionPath(nextSession.workspaceId, nextSession.sessionId));
      setActionDialogOpen(false);
      setSelection(null);
      actionDialogLockedRef.current = false;
    } catch (error) {
      showToast({
        title: error instanceof Error ? error.message : t("conversation.selectionActionFailed"),
        tone: "error"
      });
    } finally {
      setSubmittingAction(false);
    }
  }

  function closeActionDialog(clearSelection = false) {
    setActionDialogOpen(false);
    actionDialogLockedRef.current = false;

    if (clearSelection) {
      setSelection(null);
    }
  }

  if (!session || !selection || !toolbarStyle || typeof document === "undefined") {
    return (
      <WorkspaceInboxModal
        open={todoModalOpen}
        preferredWorkspaceId={session?.workspaceId ?? null}
        preferredSessionId={session?.sessionId ?? null}
        creationRequestId={todoCreationRequestId}
        initialDraft={todoDraft}
        onClose={() => setTodoModalOpen(false)}
      />
    );
  }

  return (
    <>
      {createPortal(
        <>
          <div
            className="conversation-selection-toolbar"
            style={toolbarStyle}
            onMouseDown={(event) => event.preventDefault()}
          >
            <button type="button" className="conversation-selection-action" onClick={() => void handleCopy()}>
              {t("conversation.copyAction")}
            </button>
            <button type="button" className="conversation-selection-action" onClick={handleCreateTodo}>
              {t("conversation.selectionTodoAction")}
            </button>
            <button type="button" className="conversation-selection-action is-primary" onClick={handleOpenActionDialog}>
              {t("conversation.selectionActionButton")}
            </button>
          </div>
          {actionDialogOpen && actionDialogStyle ? (
            <>
              <div
                className={`conversation-selection-dialog-backdrop${isMobileSelectionDialog ? " is-mobile" : ""}`}
                onMouseDown={() => closeActionDialog(false)}
              />
              <div
                className={`conversation-selection-action-dialog workbench-modal-card surface-card${isMobileSelectionDialog ? " is-centered" : ""}`}
                style={actionDialogStyle}
                role="dialog"
                aria-modal="true"
                aria-label={t("conversation.selectionActionButton")}
                onMouseDown={(event) => event.stopPropagation()}
              >
                <div className="conversation-selection-action-dialog-header workbench-modal-header">
                  <div className="workbench-modal-title-wrap">
                    <h2>{t("conversation.selectionActionButton")}</h2>
                  </div>
                  <button
                    type="button"
                    className="conversation-selection-action-dialog-close workbench-modal-close"
                    aria-label={t("common.close")}
                    onClick={() => closeActionDialog(false)}
                  >
                    ×
                  </button>
                </div>
                <p className="conversation-selection-action-dialog-quote">{selection.text}</p>
                <label className="conversation-selection-field workbench-modal-field">
                  <span>{t("conversation.selectionActionPromptLabel")}</span>
                  <textarea
                    value={actionPrompt}
                    rows={4}
                    placeholder={t("conversation.selectionActionPromptPlaceholder")}
                    onChange={(event) => setActionPrompt(event.target.value)}
                  />
                </label>
                <label className="conversation-selection-checkbox">
                  <input
                    type="checkbox"
                    checked={includeContext}
                    disabled={!selection.sourceMessageId}
                    onChange={(event) => setIncludeContext(event.target.checked)}
                  />
                  <span>{t("conversation.selectionActionIncludeContext")}</span>
                </label>
                {!selection.sourceMessageId ? (
                  <p className="conversation-selection-hint">
                    {t("conversation.selectionActionContextUnavailable")}
                  </p>
                ) : null}
                {selectedProviderDisabledReason ? (
                  <p className="conversation-selection-hint">{selectedProviderDisabledReason}</p>
                ) : null}
                <div className="conversation-selection-grid">
                  <label className="conversation-selection-field workbench-modal-field">
                    <span>{t("conversation.forkTargetProviderLabel")}</span>
                    <select
                      value={selectedProvider}
                      onChange={(event) => {
                        const nextProvider = event.target.value as BuiltinProviderId;
                        setSelectedProvider(nextProvider);
                        setSelectedModel(preferredModelForProvider(nextProvider));
                      }}
                    >
                      {SESSION_PROVIDER_PICKER_IDS.map((providerId) => (
                        <option
                          key={providerId}
                          value={providerId}
                          disabled={providerCapabilitiesMap[providerId]?.canStartSession === false}
                        >
                          {getProviderDisplayName(providerId, "full")}
                        </option>
                      ))}
                    </select>
                  </label>
                  <label className="conversation-selection-field workbench-modal-field">
                    <span>{t("conversation.forkTargetModelLabel")}</span>
                    <select
                      value={selectedModel}
                      disabled={loadingCapabilities || Boolean(selectedProviderDisabledReason)}
                      onChange={(event) => setSelectedModel(event.target.value)}
                    >
                      {modelOptions.map((item) => (
                        <option key={item.id} value={item.id}>
                          {item.name}
                        </option>
                      ))}
                    </select>
                  </label>
                </div>
                <div className="conversation-selection-actions">
                  <button
                    type="button"
                    className="secondary-button"
                    onClick={() => closeActionDialog(false)}
                  >
                    {t("common.cancel")}
                  </button>
                  <button
                    type="button"
                    className="primary-button"
                    disabled={submittingAction || Boolean(selectedProviderDisabledReason)}
                    onClick={() => void handleSubmitAction()}
                  >
                    {submittingAction ? t("conversation.sendingState") : t("conversation.selectionActionSubmit")}
                  </button>
                </div>
              </div>
            </>
          ) : null}
        </>,
        document.body
      )}
      <WorkspaceInboxModal
        open={todoModalOpen}
        preferredWorkspaceId={session.workspaceId}
        preferredSessionId={session.sessionId}
        creationRequestId={todoCreationRequestId}
        initialDraft={todoDraft}
        onClose={() => setTodoModalOpen(false)}
      />
    </>
  );
}
