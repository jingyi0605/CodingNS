import { useEffect, useMemo, useRef, useState, type FormEvent } from "react";
import { useNavigate, useParams } from "react-router-dom";

import { t } from "../../../shared/i18n";
import { useToast } from "../../../shared/toast";
import { ComposerPanel } from "../../conversation/components/ComposerPanel";
import { MessageTimeline } from "../../conversation/components/MessageTimeline";
import { SessionRuntimeStore } from "../../conversation/runtime/session-runtime-store";
import type { SessionMessageViewModel } from "../../conversation/runtime/session-runtime-machine";
import { useWorkbenchShell } from "../../conversation/components/WorkbenchLayout";
import {
  buildWorkspaceButlerPath
} from "../../workbench/utils/workbench-navigation";
import type {
  ButlerControlEventDto,
  ButlerFollowUpTaskDto,
  ButlerInboxItemDto,
  ButlerLanguageId,
  ButlerOverviewDto,
  ButlerProfilePayload,
  ButlerProviderId,
  ButlerRiskPreferenceId,
  ButlerVerificationDigestDto,
  ButlerSummaryStyleId,
  ButlerToneId
} from "../api/butler-api";
import { listButlerFollowUpTasks, listButlerInboxItems } from "../api/butler-api";
import { BUTLER_INBOX_UPDATED_EVENT } from "../runtime/butler-inbox-events";
import { subscribeButlerRecordsUpdated } from "../runtime/butler-records-events";
import { ButlerRuntimeStore, useButlerRuntimeStore } from "../runtime/butler-runtime-store";

import "./ButlerPage.css";

interface ButlerInitFormState {
  displayName: string;
  providerId: ButlerProviderId;
  agentsMode: "inline" | "file";
  personaTone: ButlerToneId;
  personaLanguage: ButlerLanguageId;
  personaSummaryStyle: ButlerSummaryStyleId;
  focusRiskPreference: ButlerRiskPreferenceId;
  reportPriorityPreset: ButlerReportPriorityPresetId;
}

type ButlerReportPriorityPresetId =
  | "risk-first"
  | "blocker-first"
  | "verification-first"
  | "progress-first";

const REPORT_PRIORITY_PRESET_VALUES: Record<ButlerReportPriorityPresetId, string[]> = {
  "risk-first": ["risk", "blocker", "verification"],
  "blocker-first": ["blocker", "risk", "verification"],
  "verification-first": ["verification", "risk", "blocker"],
  "progress-first": ["progress", "risk", "blocker"]
};
const DEFAULT_BUTLER_SUMMARY_DEBOUNCE_SECONDS = 300;

const DEFAULT_INIT_FORM_STATE: ButlerInitFormState = {
  displayName: "",
  providerId: "codex",
  agentsMode: "inline",
  personaTone: "direct",
  personaLanguage: "zh-CN",
  personaSummaryStyle: "brief",
  focusRiskPreference: "conservative",
  reportPriorityPreset: "risk-first"
};
const BUTLER_AVATARS = ["🦉", "🦊", "🧭", "🛠", "🧠", "🔎", "📚", "🦁", "🤖", "🐳"];

export function ButlerPage() {
  const { workspaceId = "" } = useParams();
  const navigate = useNavigate();
  const { showToast } = useToast();
  const { requestNavigationRefresh, setAuxiliaryPanel } = useWorkbenchShell();
  const storeRef = useRef<ButlerRuntimeStore | null>(null);
  const currentWorkspaceIdRef = useRef<string | null>(null);
  const [initForm, setInitForm] = useState<ButlerInitFormState>(DEFAULT_INIT_FORM_STATE);
  const [initializingProfile, setInitializingProfile] = useState(false);
  const [viewKey, setViewKey] = useState(0);
  const [inboxItems, setInboxItems] = useState<ButlerInboxItemDto[]>([]);
  const [followUpTasks, setFollowUpTasks] = useState<ButlerFollowUpTaskDto[]>([]);
  const [analysisOpen, setAnalysisOpen] = useState(false);

  if (!storeRef.current || currentWorkspaceIdRef.current !== workspaceId) {
    storeRef.current = new ButlerRuntimeStore(workspaceId);
    currentWorkspaceIdRef.current = workspaceId;
  }

  const store = storeRef.current;
  const loading = useButlerRuntimeStore(store, (state) => state.loading);
  const sending = useButlerRuntimeStore(store, (state) => state.sending);
  const switchingProvider = useButlerRuntimeStore(store, (state) => state.switchingProvider);
  const initialized = useButlerRuntimeStore(store, (state) => state.initialized);
  const profile = useButlerRuntimeStore(store, (state) => state.profile);
  const activeProvider = useButlerRuntimeStore(store, (state) => state.activeProvider);
  const controlSession = useButlerRuntimeStore(store, (state) => state.controlSession);
  const capabilities = useButlerRuntimeStore(store, (state) => state.capabilities);
  const overview = useButlerRuntimeStore(store, (state) => state.overview);
  const events = useButlerRuntimeStore(store, (state) => state.events);
  const messages = useButlerRuntimeStore(store, (state) => state.messages);
  const historyState = useButlerRuntimeStore(store, (state) => state.historyState);
  const runtimeHasActiveRun = useButlerRuntimeStore(store, (state) => state.runtimeHasActiveRun);
  const runtimeCanInterrupt = useButlerRuntimeStore(store, (state) => state.runtimeCanInterrupt);
  const contextUsage = useButlerRuntimeStore(store, (state) => state.contextUsage);
  const error = useButlerRuntimeStore(store, (state) => state.error);

  const butlerDisplayName = profile?.displayName?.trim() || initForm.displayName.trim() || t("shell.butlerEntry");
  const butlerAvatar = useMemo(() => resolveButlerAvatar(butlerDisplayName), [butlerDisplayName]);
  const liveRuntimeSessionId = controlSession?.session?.sessionId?.trim() || null;
  const liveRuntimeStore = useMemo(() => {
    if (!liveRuntimeSessionId || !controlSession?.session) {
      return null;
    }

    return new SessionRuntimeStore(liveRuntimeSessionId, {
      initialSession: controlSession.session
    });
  }, [liveRuntimeSessionId]);
  const liveRuntime = useButlerLiveRuntime(liveRuntimeStore);
  const effectiveMessages = liveRuntimeStore ? liveRuntime.messages : messages;
  const effectiveHistoryState = liveRuntimeStore ? liveRuntime.historyState : historyState;
  const effectiveRuntimeHasActiveRun =
    liveRuntimeStore ? liveRuntime.runtimeHasActiveRun : runtimeHasActiveRun;
  const effectiveRuntimeCanInterrupt =
    liveRuntimeStore ? liveRuntime.runtimeCanInterrupt : runtimeCanInterrupt;
  const effectiveContextUsage = liveRuntimeStore ? liveRuntime.contextUsage : contextUsage;
  const effectiveLoadingOlderMessages = liveRuntimeStore ? liveRuntime.loadingOlderMessages : false;
  const effectiveHasOlderMessages = liveRuntimeStore ? liveRuntime.hasOlderMessages : false;
  const analysisTasks = useMemo(
    () => followUpTasks.slice(0, 3),
    [followUpTasks]
  );

  useEffect(() => {
    void store.initialize();
  }, [store]);

  useEffect(() => {
    if (!liveRuntimeStore) {
      return;
    }

    void liveRuntimeStore.initialize();

    return () => {
      liveRuntimeStore.destroy();
    };
  }, [liveRuntimeStore]);

  useEffect(() => {
    if (!liveRuntimeStore || !controlSession?.session) {
      return;
    }

    liveRuntimeStore.applyNavigationSession(controlSession.session);
  }, [controlSession?.session, liveRuntimeStore]);

  useEffect(() => {
    if (error) {
      showToast({
        title: t("shell.butlerLoadFailed"),
        description: error,
        tone: "error"
      });
    }
  }, [error, showToast]);

  useEffect(() => {
    if (!initialized) {
      setInboxItems([]);
      setFollowUpTasks([]);
      return;
    }

    let disposed = false;

    async function loadSidebarData() {
      try {
        const [inboxResponse, followUpResponse] = await Promise.all([
          listButlerInboxItems(),
          listButlerFollowUpTasks()
        ]);

        if (!disposed) {
          setInboxItems(inboxResponse.items);
          setFollowUpTasks(followUpResponse.items);
        }
      } catch (loadError) {
        if (disposed) {
          return;
        }

        setInboxItems([]);
        setFollowUpTasks([]);
        showToast({
          title: t("shell.butlerSidebarLoadFailed"),
          description: loadError instanceof Error ? loadError.message : undefined,
          tone: "error"
        });
      }
    }

    void loadSidebarData();

    function handleInboxUpdated() {
      void loadSidebarData();
    }

    const timer = window.setInterval(() => {
      void loadSidebarData();
    }, 15_000);

    window.addEventListener(BUTLER_INBOX_UPDATED_EVENT, handleInboxUpdated);

    return () => {
      disposed = true;
      window.clearInterval(timer);
      window.removeEventListener(BUTLER_INBOX_UPDATED_EVENT, handleInboxUpdated);
    };
  }, [initialized, showToast]);

  useEffect(() => {
    return subscribeButlerRecordsUpdated(() => {
      void store.reloadEventsAndOverview();
    });
  }, [store]);

  const providerOptions = useMemo(
    () => [
      {
        value: "codex",
        label: "Codex"
      },
      {
        value: "claude-code",
        label: "Claude Code"
      }
    ] satisfies Array<{ value: ButlerProviderId; label: string }>,
    []
  );
  const agentsModeOptions = useMemo(
    () => [
      {
        value: "inline",
        label: t("shell.butlerAgentsModeInline")
      },
      {
        value: "file",
        label: t("shell.butlerAgentsModeFile")
      }
    ] satisfies Array<{ value: "inline" | "file"; label: string }>,
    []
  );
  const toneOptions = useMemo(
    () => [
      { value: "direct", label: t("shell.butlerToneDirect") },
      { value: "steady", label: t("shell.butlerToneSteady") },
      { value: "friendly", label: t("shell.butlerToneFriendly") }
    ] satisfies Array<{ value: ButlerToneId; label: string }>,
    []
  );
  const languageOptions = useMemo(
    () => [
      { value: "zh-CN", label: t("shell.butlerLanguageZhCn") },
      { value: "en-US", label: t("shell.butlerLanguageEnUs") },
      { value: "bilingual", label: t("shell.butlerLanguageBilingual") }
    ] satisfies Array<{ value: ButlerLanguageId; label: string }>,
    []
  );
  const summaryStyleOptions = useMemo(
    () => [
      { value: "brief", label: t("shell.butlerSummaryBrief") },
      { value: "structured", label: t("shell.butlerSummaryStructured") },
      { value: "thorough", label: t("shell.butlerSummaryThorough") }
    ] satisfies Array<{ value: ButlerSummaryStyleId; label: string }>,
    []
  );
  const riskPreferenceOptions = useMemo(
    () => [
      { value: "conservative", label: t("shell.butlerRiskConservative") },
      { value: "balanced", label: t("shell.butlerRiskBalanced") },
      { value: "proactive", label: t("shell.butlerRiskProactive") }
    ] satisfies Array<{ value: ButlerRiskPreferenceId; label: string }>,
    []
  );
  const reportPriorityPresetOptions = useMemo(
    () => [
      { value: "risk-first", label: t("shell.butlerReportRiskFirst") },
      { value: "blocker-first", label: t("shell.butlerReportBlockerFirst") },
      { value: "verification-first", label: t("shell.butlerReportVerificationFirst") },
      { value: "progress-first", label: t("shell.butlerReportProgressFirst") }
    ] satisfies Array<{ value: ButlerReportPriorityPresetId; label: string }>,
    []
  );

  const sidePanel = useMemo(
    () => (
      <ButlerAuxiliaryPanel
        overview={overview}
        events={events}
        inboxItems={inboxItems}
        followUpTasks={followUpTasks}
      />
    ),
    [events, followUpTasks, inboxItems, overview]
  );

  useEffect(() => {
    if (!initialized) {
      setAuxiliaryPanel(null);
      return;
    }

    setAuxiliaryPanel(sidePanel);

    return () => {
      setAuxiliaryPanel(null);
    };
  }, [initialized, setAuxiliaryPanel, sidePanel]);

  async function handleProfileInitSubmit(event: FormEvent<HTMLFormElement>) {
    event.preventDefault();
    const displayName = initForm.displayName.trim();

    if (!displayName) {
      showToast({
        title: t("shell.butlerInitNameRequired"),
        tone: "warning"
      });
      return;
    }

    const payload: ButlerProfilePayload = {
      displayName,
      providerId: initForm.providerId,
      agentsMode: initForm.agentsMode,
      persona: {
        tone: initForm.personaTone,
        language: initForm.personaLanguage,
        summaryStyle: initForm.personaSummaryStyle
      },
      focus: {
        projectIds: [],
        riskPreference: initForm.focusRiskPreference,
        reportPriority: REPORT_PRIORITY_PRESET_VALUES[initForm.reportPriorityPreset],
        summaryDebounceSeconds: DEFAULT_BUTLER_SUMMARY_DEBOUNCE_SECONDS
      }
    };

    setInitializingProfile(true);

    try {
      await store.initializeProfile(payload);
      showToast({
        title: t("shell.butlerInitSuccess"),
        tone: "success"
      });
    } catch (submitError) {
      showToast({
        title: t("shell.butlerInitFailed"),
        description: submitError instanceof Error ? submitError.message : undefined,
        tone: "error"
      });
    } finally {
      setInitializingProfile(false);
    }
  }

  async function handleProviderSwitch(providerId: ButlerProviderId) {
    if (providerId === activeProvider) {
      return;
    }

    try {
      await store.switchProvider(providerId);
      resetProjectView(providerId);
      showToast({
        title: t("shell.butlerProviderSwitched"),
        description: t("shell.butlerProviderSwitchedDescription", {
          provider: providerId === "codex" ? "Codex" : "Claude Code"
        }),
        tone: "success"
      });
    } catch (switchError) {
      showToast({
        title: t("shell.butlerProviderSwitchFailed"),
        description: switchError instanceof Error ? switchError.message : undefined,
        tone: "error"
      });
    }
  }

  async function handleStartFreshSession() {
    try {
      resetProjectView(activeProvider);
      await store.startFreshSession();
      showToast({
        title: t("shell.butlerNewSessionStarted"),
        tone: "success"
      });
    } catch (sessionError) {
      showToast({
        title: t("shell.butlerNewSessionFailed"),
        description: sessionError instanceof Error ? sessionError.message : undefined,
        tone: "error"
      });
    }
  }

  function resetProjectView(providerId: ButlerProviderId) {
    setViewKey((current) => current + 1);
    navigate(buildWorkspaceButlerPath(workspaceId), {
      replace: true
    });

    if (providerId) {
      requestNavigationRefresh();
    }
  }

  if (loading && !initialized && !initializingProfile) {
    return (
      <main className="workbench-page butler-page-shell butler-loading-shell">
        <ButlerLoadingState />
      </main>
    );
  }

  if (!initialized) {
    return (
      <main className="workbench-page butler-page-shell">
        <section className="butler-init-panel">
          <header className="butler-panel-header">
            <h1>{t("shell.butlerInitTitle")}</h1>
            <p>{t("shell.butlerInitDescription")}</p>
          </header>

          <form className="butler-init-form" onSubmit={handleProfileInitSubmit}>
            <label className="butler-form-field">
              <span>{t("shell.butlerDisplayNameLabel")}</span>
              <input
                value={initForm.displayName}
                onChange={(event) =>
                  setInitForm((current) => ({
                    ...current,
                    displayName: event.target.value
                  }))
                }
                placeholder={t("shell.butlerDisplayNamePlaceholder")}
              />
              <small>{t("shell.butlerDisplayNameHint")}</small>
            </label>

            <label className="butler-form-field">
              <span>{t("shell.butlerProviderLabel")}</span>
              <select
                value={initForm.providerId}
                onChange={(event) =>
                  setInitForm((current) => ({
                    ...current,
                    providerId: event.target.value as ButlerProviderId
                  }))
                }
              >
                {providerOptions.map((option) => (
                  <option key={option.value} value={option.value}>
                    {option.label}
                  </option>
                ))}
              </select>
            </label>

            <label className="butler-form-field">
              <span>{t("shell.butlerAgentsModeLabel")}</span>
              <select
                value={initForm.agentsMode}
                onChange={(event) =>
                  setInitForm((current) => ({
                    ...current,
                    agentsMode: event.target.value as "inline" | "file"
                  }))
                }
              >
                {agentsModeOptions.map((option) => (
                  <option key={option.value} value={option.value}>
                    {option.label}
                  </option>
                ))}
              </select>
              <small>
                {initForm.agentsMode === "inline"
                  ? t("shell.butlerAgentsModeInlineDescription")
                  : t("shell.butlerAgentsModeFileDescription")}
              </small>
            </label>

            <label className="butler-form-field">
              <span>{t("shell.butlerPersonaToneLabel")}</span>
              <select
                value={initForm.personaTone}
                onChange={(event) =>
                  setInitForm((current) => ({
                    ...current,
                    personaTone: event.target.value as ButlerToneId
                  }))
                }
              >
                {toneOptions.map((option) => (
                  <option key={option.value} value={option.value}>
                    {option.label}
                  </option>
                ))}
              </select>
            </label>

            <label className="butler-form-field">
              <span>{t("shell.butlerPersonaLanguageLabel")}</span>
              <select
                value={initForm.personaLanguage}
                onChange={(event) =>
                  setInitForm((current) => ({
                    ...current,
                    personaLanguage: event.target.value as ButlerLanguageId
                  }))
                }
              >
                {languageOptions.map((option) => (
                  <option key={option.value} value={option.value}>
                    {option.label}
                  </option>
                ))}
              </select>
            </label>

            <label className="butler-form-field">
              <span>{t("shell.butlerPersonaSummaryStyleLabel")}</span>
              <select
                value={initForm.personaSummaryStyle}
                onChange={(event) =>
                  setInitForm((current) => ({
                    ...current,
                    personaSummaryStyle: event.target.value as ButlerSummaryStyleId
                  }))
                }
              >
                {summaryStyleOptions.map((option) => (
                  <option key={option.value} value={option.value}>
                    {option.label}
                  </option>
                ))}
              </select>
            </label>

            <label className="butler-form-field">
              <span>{t("shell.butlerFocusRiskPreferenceLabel")}</span>
              <select
                value={initForm.focusRiskPreference}
                onChange={(event) =>
                  setInitForm((current) => ({
                    ...current,
                    focusRiskPreference: event.target.value as ButlerRiskPreferenceId
                  }))
                }
              >
                {riskPreferenceOptions.map((option) => (
                  <option key={option.value} value={option.value}>
                    {option.label}
                  </option>
                ))}
              </select>
            </label>

            <label className="butler-form-field">
              <span>{t("shell.butlerReportPriorityPresetLabel")}</span>
              <select
                value={initForm.reportPriorityPreset}
                onChange={(event) =>
                  setInitForm((current) => ({
                    ...current,
                    reportPriorityPreset: event.target.value as ButlerReportPriorityPresetId
                  }))
                }
              >
                {reportPriorityPresetOptions.map((option) => (
                  <option key={option.value} value={option.value}>
                    {option.label}
                  </option>
                ))}
              </select>
            </label>

            <button type="submit" disabled={loading || initializingProfile}>
              {loading || initializingProfile
                ? t("shell.butlerInitSubmitting")
                : t("shell.butlerInitSubmit")}
            </button>
          </form>
        </section>
      </main>
    );
  }

  return (
    <main className="workbench-page conversation-page-shell butler-page-shell butler-chat-workspace">
      <header className="workbench-auxiliary-header butler-main-header" data-window-drag-handle="conversation-header">
        <div className="butler-header-main">
          <div
            className="butler-header-analysis-anchor"
            onMouseEnter={() => {
              setAnalysisOpen(true);
            }}
            onMouseLeave={() => {
              setAnalysisOpen(false);
            }}
          >
            <div className="butler-chat-avatar" aria-hidden="true">
              <span>{butlerAvatar}</span>
            </div>
            <div className="butler-main-heading">
              <h1
                tabIndex={0}
                onFocus={() => {
                  setAnalysisOpen(true);
                }}
                onBlur={() => {
                  setAnalysisOpen(false);
                }}
              >
                {butlerDisplayName}
              </h1>
            </div>
            {analysisOpen ? (
              <div className="butler-header-analysis-popover" role="status" aria-live="polite">
                <strong>{t("conversation.butlerAnalysisTitle")}</strong>
                {analysisTasks.length > 0 ? (
                  analysisTasks.map((task) => (
                    <div key={task.id} className="butler-header-analysis-item">
                      <p>
                        {t("conversation.butlerAnalysisObjectiveLabel")}：{task.objective}
                      </p>
                      <p>
                        {t("conversation.butlerAnalysisStatusLabel")}：
                        {resolveFollowUpTaskStatusLabel(task.status)}
                      </p>
                      <p>
                        {t("conversation.butlerAnalysisSummaryLabel")}：
                        {task.lastAutomationSummary
                          || task.waitingReason
                          || t("conversation.butlerAnalysisEmpty")}
                      </p>
                    </div>
                  ))
                ) : (
                  <p>{t("conversation.butlerAnalysisEmpty")}</p>
                )}
              </div>
            ) : null}
          </div>
        </div>
        <div className="butler-toolbar-cluster">
          <div className="butler-provider-switcher">
            <select
              aria-label={t("shell.butlerProviderLabel")}
              value={activeProvider}
              disabled={switchingProvider || sending}
              onChange={(event) => {
                void handleProviderSwitch(event.target.value as ButlerProviderId);
              }}
            >
              {providerOptions.map((option) => (
                <option key={option.value} value={option.value}>
                  {option.label}
                </option>
              ))}
            </select>
          </div>
          <button
            type="button"
            className="terminal-tab-control butler-header-icon-button"
            aria-label={t("shell.butlerNewSessionAction")}
            title={t("shell.butlerNewSessionAction")}
            disabled={loading || sending || switchingProvider}
            onClick={() => {
              void handleStartFreshSession();
            }}
          >
            <span className="terminal-toolbar-icon" aria-hidden="true">
              <ButlerPlusIcon />
            </span>
          </button>
          <button
            type="button"
            className="terminal-tab-control butler-header-icon-button"
            aria-label={t("shell.butlerRefreshAction")}
            title={t("shell.butlerRefreshAction")}
            disabled={loading || sending || switchingProvider}
            onClick={() => {
              void Promise.all([
                store.refreshAll(),
                listButlerInboxItems().then((response) => setInboxItems(response.items)),
                listButlerFollowUpTasks().then((response) => setFollowUpTasks(response.items))
              ]);
            }}
          >
            <span className="terminal-toolbar-icon" aria-hidden="true">
              <ButlerRefreshIcon />
            </span>
          </button>
        </div>
      </header>

      <section className="butler-main-column">
        <div key={`timeline:${activeProvider}:${viewKey}`} className="butler-conversation-shell">
          <MessageTimeline
            sessionId={controlSession?.session?.sessionId}
            messages={effectiveMessages}
            historyState={effectiveHistoryState}
            loadingOlderMessages={effectiveLoadingOlderMessages}
            hasOlderMessages={effectiveHasOlderMessages}
            provider={activeProvider}
            assistantAvatar={
              <span className="butler-message-avatar" aria-hidden="true">
                {butlerAvatar}
              </span>
            }
            onLoadOlderMessages={() => {
              if (!liveRuntimeStore) {
                return;
              }

              void liveRuntimeStore.loadOlderMessages();
            }}
            onRetryMessage={(clientRequestId) => {
              const targetMessage = effectiveMessages.find(
                (message) => message.clientRequestId === clientRequestId
              );

              if (targetMessage?.content.trim()) {
                void store.sendMessage(targetMessage.content);
                return;
              }

              void store.retryMessage(clientRequestId);
            }}
          />

          <div className="butler-composer-shell">
            <ComposerPanel
              capabilities={capabilities}
              draftStorageId={`butler:${activeProvider}:${viewKey}`}
              placeholder={t("shell.butlerComposerPlaceholder", {
                displayName: butlerDisplayName
              })}
              hasActiveRun={effectiveRuntimeHasActiveRun}
              canInterrupt={effectiveRuntimeCanInterrupt}
              contextUsage={effectiveContextUsage}
              isSubmitting={sending || switchingProvider}
              isRunning={effectiveRuntimeHasActiveRun ?? false}
              onSend={async (content, options) => {
                if ((options?.attachments?.length ?? 0) > 0) {
                  showToast({
                    title: t("shell.butlerAttachmentUnsupported"),
                    tone: "warning"
                  });
                }

                await store.sendMessage(content, {
                  model: options?.model ?? null,
                  reasoningLevel: options?.reasoningLevel ?? null,
                  permissionMode: null
                });
                requestNavigationRefresh();
              }}
            />
          </div>
        </div>
      </section>
    </main>
  );
}

function ButlerAuxiliaryPanel(props: {
  overview: ButlerOverviewDto | null;
  events: ButlerControlEventDto[];
  inboxItems: ButlerInboxItemDto[];
  followUpTasks: ButlerFollowUpTaskDto[];
}) {
  const [activeTab, setActiveTab] = useState<"info" | "automation">("info");

  return (
    <div className="butler-side-column">
      <div className="workbench-auxiliary-header butler-side-header">
        <div className="butler-side-tabs" role="tablist" aria-label={t("shell.butlerSidebarTabsLabel")}>
          <button
            type="button"
            role="tab"
            aria-selected={activeTab === "info"}
            className="butler-side-tab"
            data-active={activeTab === "info"}
            onClick={() => {
              setActiveTab("info");
            }}
          >
            {t("shell.butlerSidebarInfoTab")}
          </button>
          <button
            type="button"
            role="tab"
            aria-selected={activeTab === "automation"}
            className="butler-side-tab"
            data-active={activeTab === "automation"}
            onClick={() => {
              setActiveTab("automation");
            }}
          >
            {t("shell.butlerSidebarAutomationTab")}
          </button>
        </div>
      </div>
      {activeTab === "info" ? (
        <GlobalRecordsSidebarContent
          overview={props.overview}
          events={props.events}
          inboxItems={props.inboxItems}
        />
      ) : (
        <AutomationSidebarContent followUpTasks={props.followUpTasks} />
      )}
    </div>
  );
}

function GlobalRecordsSidebarContent(props: {
  overview: ButlerOverviewDto | null;
  events: ButlerControlEventDto[];
  inboxItems: ButlerInboxItemDto[];
}) {
  const followUpRecords = useMemo(
    () => buildFollowUpRecords(props.events),
    [props.events]
  );
  const verificationRecords = useMemo(
    () => buildVerificationRecords(props.overview?.verifications ?? []),
    [props.overview?.verifications]
  );
  const todoRecords = useMemo(
    () => buildTodoRecords(props.inboxItems),
    [props.inboxItems]
  );

  return (
    <>
      <GlobalRecordCard
        title={t("shell.butlerInfoFollowUpRecordsTitle")}
        description={t("shell.butlerInfoFollowUpRecordsDescription")}
        items={followUpRecords}
        emptyText={t("shell.butlerInfoFollowUpRecordsEmpty")}
      />
      <GlobalRecordCard
        title={t("shell.butlerInfoVerificationRecordsTitle")}
        description={t("shell.butlerInfoVerificationRecordsDescription")}
        items={verificationRecords}
        emptyText={t("shell.butlerInfoVerificationRecordsEmpty")}
      />
      <GlobalRecordCard
        title={t("shell.butlerInfoTodoRecordsTitle")}
        description={t("shell.butlerInfoTodoRecordsDescription")}
        items={todoRecords}
        emptyText={t("shell.butlerInfoTodoRecordsEmpty")}
      />
    </>
  );
}

function AutomationSidebarContent(props: {
  followUpTasks: ButlerFollowUpTaskDto[];
}) {
  const activeTasks = useMemo(
    () => [...props.followUpTasks]
      .filter((task) => task.status === "active" || task.status === "waiting_user")
      .sort((left, right) => {
        const leftPriority = left.status === "waiting_user" ? 0 : 1;
        const rightPriority = right.status === "waiting_user" ? 0 : 1;

        if (leftPriority !== rightPriority) {
          return leftPriority - rightPriority;
        }

        return parseIsoTime(left.nextCheckAt) - parseIsoTime(right.nextCheckAt);
      }),
    [props.followUpTasks]
  );
  const completedTasks = useMemo(
    () => [...props.followUpTasks]
      .filter((task) => task.status !== "active" && task.status !== "waiting_user")
      .sort((left, right) => parseIsoTime(right.updatedAt) - parseIsoTime(left.updatedAt)),
    [props.followUpTasks]
  );

  return (
    <>
      <AutomationRecordCard
        title={t("shell.butlerAutomationActiveTitle")}
        description={t("shell.butlerAutomationActiveDescription")}
        tasks={activeTasks}
        emptyText={t("shell.butlerAutomationActiveEmpty")}
      />
      <AutomationRecordCard
        title={t("shell.butlerAutomationCompletedTitle")}
        description={t("shell.butlerAutomationCompletedDescription")}
        tasks={completedTasks}
        emptyText={t("shell.butlerAutomationCompletedEmpty")}
      />
    </>
  );
}

function GlobalRecordCard(props: {
  title: string;
  description: string;
  items: Array<{
    title: string;
    content: string;
  }>;
  emptyText: string;
}) {
  return (
    <section className="butler-side-card surface-card">
      <header>
        <h2>{props.title}</h2>
        <p>{props.description}</p>
      </header>
      {props.items.length > 0 ? (
        <div className="butler-record-list">
          {props.items.map((item) => (
            <SimpleInfoBlock key={`${item.title}:${item.content}`} title={item.title} content={item.content} />
          ))}
        </div>
      ) : (
        <p className="butler-secondary-text">{props.emptyText}</p>
      )}
    </section>
  );
}

function SimpleInfoBlock(props: {
  title: string;
  content: string;
}) {
  return (
    <div className="butler-simple-info-block">
      <span>{props.title}</span>
      <strong>{props.content}</strong>
    </div>
  );
}

function AutomationRecordCard(props: {
  title: string;
  description: string;
  tasks: ButlerFollowUpTaskDto[];
  emptyText: string;
}) {
  return (
    <section className="butler-side-card surface-card">
      <header>
        <h2>{props.title}</h2>
        <p>{props.description}</p>
      </header>
      {props.tasks.length > 0 ? (
        <div className="butler-record-list">
          {props.tasks.map((task) => (
            <AutomationTaskCard key={task.id} task={task} />
          ))}
        </div>
      ) : (
        <p className="butler-secondary-text">{props.emptyText}</p>
      )}
    </section>
  );
}

function AutomationTaskCard(props: {
  task: ButlerFollowUpTaskDto;
}) {
  const { task } = props;
  const title = task.sessionTitle?.trim() || task.projectName;
  const latestSummary = task.lastAutomationSummary?.trim() || task.objective;
  const statusLabel = resolveFollowUpTaskStatusLabel(task.status);
  const primaryMeta = task.status === "waiting_user"
    ? t("shell.butlerAutomationWaitingReasonLabel")
    : t("shell.butlerAutomationLatestAssessmentLabel");
  const primaryContent = task.status === "waiting_user"
    ? task.waitingReason?.trim() || latestSummary
    : latestSummary;
  const footerLabel = task.status === "active" || task.status === "waiting_user"
    ? t("shell.butlerAutomationNextCheckLabel")
    : t("shell.butlerAutomationFinishedAtLabel");
  const footerValue = task.status === "active" || task.status === "waiting_user"
    ? formatIsoDateTime(task.nextCheckAt || task.lastCheckedAt)
    : formatIsoDateTime(task.completedAt || task.updatedAt);

  return (
    <article className="butler-automation-card">
      <header className="butler-automation-card-header">
        <div className="butler-automation-card-title-group">
          <strong>{title}</strong>
          <span>{task.projectName}</span>
        </div>
        <span className="butler-automation-status-badge" data-status={task.status}>
          {statusLabel}
        </span>
      </header>
      <div className="butler-automation-card-body">
        <div className="butler-automation-row">
          <span>{t("shell.butlerAutomationObjectiveLabel")}</span>
          <strong>{task.objective}</strong>
        </div>
        <div className="butler-automation-row">
          <span>{primaryMeta}</span>
          <strong>{primaryContent}</strong>
        </div>
      </div>
      <footer className="butler-automation-card-footer">
        <span>{footerLabel}</span>
        <strong>{footerValue}</strong>
      </footer>
    </article>
  );
}

function ButlerLoadingState() {
  return (
    <section className="butler-loading-panel" role="status" aria-live="polite">
      <div className="butler-loading-orb" aria-hidden="true">
        <span className="butler-loading-ring butler-loading-ring-primary" />
        <span className="butler-loading-ring butler-loading-ring-secondary" />
        <span className="butler-loading-core" />
      </div>
      <div className="butler-loading-copy">
        <h1>{t("shell.butlerLoadingTitle")}</h1>
        <p>{t("shell.butlerLoadingDescription")}</p>
      </div>
    </section>
  );
}

function formatIsoDateTime(value: string | null | undefined): string {
  if (!value) {
    return "-";
  }

  const date = new Date(value);

  if (Number.isNaN(date.getTime())) {
    return value;
  }

  return new Intl.DateTimeFormat(undefined, {
    year: "numeric",
    month: "2-digit",
    day: "2-digit",
    hour: "2-digit",
    minute: "2-digit"
  }).format(date);
}

function buildFollowUpRecords(events: ButlerControlEventDto[]): Array<{ title: string; content: string }> {
  return [...events]
    .filter((event) => event.actionType === "resume-session")
    .sort((left, right) => parseIsoTime(right.createdAt) - parseIsoTime(left.createdAt))
    .slice(0, 5)
    .map((event) => ({
      title: event.title?.trim() || t("shell.butlerInfoFollowUpUntitled"),
      content:
        event.content?.trim()
        || t("shell.butlerInfoFollowUpFallback", {
          updatedAt: formatIsoDateTime(event.createdAt)
        })
    }));
}

function buildVerificationRecords(
  verifications: ButlerVerificationDigestDto[]
): Array<{ title: string; content: string }> {
  return [...verifications]
    .sort((left, right) => parseIsoTime(resolveVerificationTime(right)) - parseIsoTime(resolveVerificationTime(left)))
    .slice(0, 5)
    .map((verification) => ({
      title: verification.targetRef?.trim() || verification.verificationType,
      content:
        verification.summary?.trim()
        || t("shell.butlerInfoVerificationFallback", {
          status: verification.status
        })
    }));
}

function buildTodoRecords(items: ButlerInboxItemDto[]): Array<{ title: string; content: string }> {
  return items.slice(0, 5).map((item) => ({
    title: item.title,
    content: `${item.projectName} · ${resolveTodoStatusLabel(item.status)}`
  }));
}

function resolveVerificationTime(verification: ButlerVerificationDigestDto): string | null {
  return verification.finishedAt || verification.startedAt || verification.createdAt;
}

function parseIsoTime(value: string | null | undefined): number {
  if (!value) {
    return 0;
  }

  const time = new Date(value).getTime();
  return Number.isNaN(time) ? 0 : time;
}

function resolveTodoStatusLabel(status: ButlerInboxItemDto["status"]): string {
  switch (status) {
    case "pending":
      return t("shell.butlerInfoTodoPending");
    case "in_progress":
      return t("shell.butlerInfoTodoInProgress");
    case "closed":
      return t("shell.butlerInfoTodoClosed");
    default:
      return t("shell.butlerInfoTodoPending");
  }
}

function resolveFollowUpTaskStatusLabel(status: ButlerFollowUpTaskDto["status"]): string {
  switch (status) {
    case "active":
      return t("shell.butlerAutomationStatusActive");
    case "waiting_user":
      return t("shell.butlerAutomationStatusWaitingUser");
    case "completed":
      return t("shell.butlerAutomationStatusCompleted");
    case "failed":
      return t("shell.butlerAutomationStatusFailed");
    case "cancelled":
      return t("shell.butlerAutomationStatusCancelled");
    default:
      return t("shell.butlerAutomationStatusActive");
  }
}

function resolveButlerAvatar(displayName: string): string {
  const normalized = displayName.trim();

  if (!normalized) {
    return BUTLER_AVATARS[0]!;
  }

  const codePointTotal = Array.from(normalized).reduce((total, character) => {
    const codePoint = character.codePointAt(0) ?? 0;
    return total + codePoint;
  }, 0);

  return BUTLER_AVATARS[codePointTotal % BUTLER_AVATARS.length]!;
}

function ButlerPlusIcon() {
  return (
    <svg width="16" height="16" viewBox="0 0 24 24" fill="none" stroke="currentColor" strokeWidth="2">
      <line x1="12" y1="5" x2="12" y2="19" />
      <line x1="5" y1="12" x2="19" y2="12" />
    </svg>
  );
}

function ButlerRefreshIcon() {
  return (
    <svg viewBox="0 0 16 16" aria-hidden="true">
      <path
        d="M12.8 5.2A5.5 5.5 0 1 0 13.5 8h-1.8A3.7 3.7 0 1 1 10.6 5l-1.4 1.4h4V2l-1.4 1.4z"
        fill="currentColor"
      />
    </svg>
  );
}

function useButlerLiveRuntime(runtimeStore: SessionRuntimeStore | null): {
  messages: SessionMessageViewModel[];
  historyState: "idle" | "loading" | "ready" | "error";
  loadingOlderMessages: boolean;
  hasOlderMessages: boolean;
  runtimeHasActiveRun: boolean | null;
  runtimeCanInterrupt: boolean | null;
  contextUsage: ReturnType<SessionRuntimeStore["getState"]>["contextUsage"];
} {
  const [snapshot, setSnapshot] = useState(() => createEmptyButlerLiveRuntimeSnapshot());

  useEffect(() => {
    if (!runtimeStore) {
      setSnapshot(createEmptyButlerLiveRuntimeSnapshot());
      return;
    }

    const syncSnapshot = () => {
      const state = runtimeStore.getState();

      setSnapshot({
        messages: state.messages,
        historyState: state.historyState,
        loadingOlderMessages: state.loadingOlderMessages,
        hasOlderMessages: state.hasOlderMessages,
        runtimeHasActiveRun: state.runtimeHasActiveRun,
        runtimeCanInterrupt: state.runtimeCanInterrupt,
        contextUsage: state.contextUsage
      });
    };

    syncSnapshot();
    return runtimeStore.subscribe(syncSnapshot);
  }, [runtimeStore]);

  return snapshot;
}

function createEmptyButlerLiveRuntimeSnapshot() {
  return {
    messages: [] as SessionMessageViewModel[],
    historyState: "ready" as "idle" | "loading" | "ready" | "error",
    loadingOlderMessages: false,
    hasOlderMessages: false,
    runtimeHasActiveRun: null as boolean | null,
    runtimeCanInterrupt: null as boolean | null,
    contextUsage: null as ReturnType<SessionRuntimeStore["getState"]>["contextUsage"]
  };
}
