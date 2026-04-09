import { useCallback, useEffect, useMemo, useRef, useState, type FormEvent } from "react";
import { useNavigate, useParams } from "react-router-dom";

import { t } from "../../../shared/i18n";
import { useToast } from "../../../shared/toast";
import { ComposerPanel } from "../../conversation/components/ComposerPanel";
import { MessageTimeline } from "../../conversation/components/MessageTimeline";
import { SessionRuntimeStore } from "../../conversation/runtime/session-runtime-store";
import type { SessionMessageViewModel } from "../../conversation/runtime/session-runtime-machine";
import { useWorkbenchShell } from "../../conversation/components/WorkbenchLayout";
import { WorkbenchModal } from "../../conversation/components/WorkbenchModal";
import {
  buildWorkspaceButlerPath
} from "../../workbench/utils/workbench-navigation";
import type {
  ButlerControlEventDto,
  ButlerFollowUpTaskRoundDto,
  ButlerFollowUpTaskDto,
  ButlerInboxItemDto,
  ButlerLanguageId,
  ButlerOverviewDto,
  ButlerPatrolPlanDto,
  ButlerProfilePayload,
  ButlerProviderId,
  ButlerRiskPreferenceId,
  ButlerVerificationDigestDto,
  ButlerSummaryStyleId,
  ButlerToneId
} from "../api/butler-api";
import {
  getButlerFollowUpTask,
  listButlerFollowUpTasks,
  listButlerInboxItems,
  listButlerPatrolPlans
} from "../api/butler-api";
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

interface ButlerSettingsFormState {
  displayName: string;
  agentsMode: "inline" | "file";
  agentsFilePath: string;
  agentsContent: string;
  personaTone: ButlerToneId;
  personaLanguage: ButlerLanguageId;
  personaSummaryStyle: ButlerSummaryStyleId;
  focusRiskPreference: ButlerRiskPreferenceId;
  reportPriorityPreset: ButlerReportPriorityPresetId;
  summaryDebounceSeconds: number;
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
const DEFAULT_SETTINGS_FORM_STATE: ButlerSettingsFormState = {
  displayName: "",
  agentsMode: "inline",
  agentsFilePath: "",
  agentsContent: "",
  personaTone: "direct",
  personaLanguage: "zh-CN",
  personaSummaryStyle: "brief",
  focusRiskPreference: "conservative",
  reportPriorityPreset: "risk-first",
  summaryDebounceSeconds: DEFAULT_BUTLER_SUMMARY_DEBOUNCE_SECONDS
};
const SUMMARY_DEBOUNCE_OPTIONS = [
  { value: 60, labelKey: "shell.butlerSummaryDebounceOption1Minute" },
  { value: 180, labelKey: "shell.butlerSummaryDebounceOption3Minutes" },
  { value: 300, labelKey: "shell.butlerSummaryDebounceOption5Minutes" },
  { value: 600, labelKey: "shell.butlerSummaryDebounceOption10Minutes" },
  { value: 900, labelKey: "shell.butlerSummaryDebounceOption15Minutes" },
  { value: 1800, labelKey: "shell.butlerSummaryDebounceOption30Minutes" }
] as const;
const BUTLER_AVATAR_POOLS = {
  builder: ["🧠", "🤖", "🦾", "🛠️", "⚙️", "🧩", "🚀", "🛰️", "🔧", "💡"],
  analyst: ["🦉", "🧭", "🔍", "📚", "🧪", "📐", "🗂️", "📝", "🧮", "📊"],
  direct: ["🦅", "🛡️", "⚡", "🎯", "🪓", "🧱", "🔨", "📌", "🧰", "🏹"],
  steady: ["🐢", "🐘", "🦬", "🦫", "🌲", "⛰️", "🪨", "🧺", "🧷", "🕰️"],
  friendly: ["🐼", "🦊", "🐻", "🐶", "🐱", "🐹", "🐰", "🦄", "🌼", "🍀"],
  default: ["🧠", "🤖", "🦉", "🧩", "📚", "💡", "🛠️", "🚀", "🌟", "🪄", "🧭", "🔮"]
} as const;

export function ButlerPage() {
  const { workspaceId = "" } = useParams();
  const navigate = useNavigate();
  const { showToast } = useToast();
  const { requestNavigationRefresh, setAuxiliaryPanel } = useWorkbenchShell();
  const storeRef = useRef<ButlerRuntimeStore | null>(null);
  const currentWorkspaceIdRef = useRef<string | null>(null);
  const [initForm, setInitForm] = useState<ButlerInitFormState>(DEFAULT_INIT_FORM_STATE);
  const [initializingProfile, setInitializingProfile] = useState(false);
  const [settingsForm, setSettingsForm] = useState<ButlerSettingsFormState>(
    DEFAULT_SETTINGS_FORM_STATE
  );
  const [savingSettings, setSavingSettings] = useState(false);
  const [viewKey, setViewKey] = useState(0);
  const [inboxItems, setInboxItems] = useState<ButlerInboxItemDto[]>([]);
  const [followUpTasks, setFollowUpTasks] = useState<ButlerFollowUpTaskDto[]>([]);
  const [patrolPlans, setPatrolPlans] = useState<ButlerPatrolPlanDto[]>([]);
  const [analysisOpen, setAnalysisOpen] = useState(false);
  const [followUpHistoryOpen, setFollowUpHistoryOpen] = useState(false);
  const [detailTaskId, setDetailTaskId] = useState<string | null>(null);
  const [detailTask, setDetailTask] = useState<ButlerFollowUpTaskDto | null>(null);
  const [detailLoading, setDetailLoading] = useState(false);
  const [detailError, setDetailError] = useState<string | null>(null);

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
  const butlerAvatar = useMemo(
    () =>
      resolveButlerAvatar({
        displayName: butlerDisplayName,
        providerId: profile?.providerId ?? initForm.providerId,
        tone: profile?.persona.tone ?? initForm.personaTone
      }),
    [
      butlerDisplayName,
      initForm.personaTone,
      initForm.providerId,
      profile?.persona.tone,
      profile?.providerId
    ]
  );
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
  const overviewProjectIds = useMemo(
    () => (overview?.projects ?? []).map((project) => project.id).sort(),
    [overview?.projects]
  );
  const handleOpenFollowUpHistory = useCallback(() => {
    setFollowUpHistoryOpen(true);
  }, []);
  const handleSettingsFormChange = useCallback((patch: Partial<ButlerSettingsFormState>) => {
    setSettingsForm((current) => ({
      ...current,
      ...patch
    }));
  }, []);
  const handleOpenFollowUpDetail = useCallback(async (taskId: string) => {
    setFollowUpHistoryOpen(false);
    setDetailTaskId(taskId);
    setDetailTask(null);
    setDetailError(null);
    setDetailLoading(true);

    try {
      const response = await getButlerFollowUpTask(taskId);
      setDetailTask(response.task);
    } catch (detailLoadError) {
      setDetailError(
        detailLoadError instanceof Error
          ? detailLoadError.message
          : t("shell.butlerAutomationRoundLoadFailed")
      );
    } finally {
      setDetailLoading(false);
    }
  }, []);
  const handleSaveSettings = useCallback(async () => {
    if (!profile) {
      return;
    }

    if (!settingsForm.displayName.trim()) {
      showToast({
        title: t("shell.butlerInitNameRequired"),
        tone: "warning"
      });
      return;
    }

    setSavingSettings(true);

    try {
      await store.updateProfile({
        displayName: settingsForm.displayName.trim(),
        agentsMode: settingsForm.agentsMode,
        agentsFilePath: settingsForm.agentsMode === "file" ? settingsForm.agentsFilePath : null,
        agentsContent: settingsForm.agentsContent,
        persona: {
          tone: settingsForm.personaTone,
          language: settingsForm.personaLanguage,
          summaryStyle: settingsForm.personaSummaryStyle
        },
        focus: {
          ...profile.focus,
          riskPreference: settingsForm.focusRiskPreference,
          reportPriority: REPORT_PRIORITY_PRESET_VALUES[settingsForm.reportPriorityPreset],
          summaryDebounceSeconds: settingsForm.summaryDebounceSeconds
        }
      });
      showToast({
        title: t("shell.butlerSettingsSaved"),
        tone: "success"
      });
    } catch (saveError) {
      showToast({
        title: t("shell.butlerSettingsSaveFailed"),
        description: saveError instanceof Error ? saveError.message : undefined,
        tone: "error"
      });
    } finally {
      setSavingSettings(false);
    }
  }, [profile, settingsForm, showToast, store]);

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
    if (!profile) {
      setSettingsForm(DEFAULT_SETTINGS_FORM_STATE);
      return;
    }

    setSettingsForm({
      displayName: profile.displayName,
      agentsMode: profile.agentsMode,
      agentsFilePath: resolveAgentsFilePath(profile),
      agentsContent: profile.agentsContent,
      personaTone: profile.persona.tone,
      personaLanguage: profile.persona.language,
      personaSummaryStyle: profile.persona.summaryStyle,
      focusRiskPreference: profile.focus.riskPreference,
      reportPriorityPreset: resolveReportPriorityPreset(profile.focus.reportPriority),
      summaryDebounceSeconds:
        profile.focus.summaryDebounceSeconds ?? DEFAULT_SETTINGS_FORM_STATE.summaryDebounceSeconds
    });
  }, [profile]);

  useEffect(() => {
    if (!initialized) {
      setInboxItems([]);
      setFollowUpTasks([]);
      setPatrolPlans([]);
      return;
    }

    let disposed = false;

    async function loadSidebarData() {
      try {
        const [inboxResponse, followUpResponse, patrolPlanResponses] = await Promise.all([
          listButlerInboxItems(),
          listButlerFollowUpTasks(),
          Promise.all(overviewProjectIds.map((projectId) => listButlerPatrolPlans(projectId)))
        ]);

        if (!disposed) {
          setInboxItems(inboxResponse.items);
          setFollowUpTasks(followUpResponse.items);
          setPatrolPlans(patrolPlanResponses.flatMap((response) => response.items));
        }
      } catch (loadError) {
        if (disposed) {
          return;
        }

        setInboxItems([]);
        setFollowUpTasks([]);
        setPatrolPlans([]);
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
  }, [initialized, overviewProjectIds, showToast]);

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
  // 初始化阶段把当前选择整理成可读标签，左侧预览直接复用，别再维护第二份状态。
  const initSelectedProviderLabel = resolveOptionLabel(providerOptions, initForm.providerId);
  const initSelectedAgentsModeLabel = resolveOptionLabel(agentsModeOptions, initForm.agentsMode);
  const initSelectedToneLabel = resolveOptionLabel(toneOptions, initForm.personaTone);
  const initSelectedLanguageLabel = resolveOptionLabel(languageOptions, initForm.personaLanguage);
  const initSelectedSummaryStyleLabel = resolveOptionLabel(
    summaryStyleOptions,
    initForm.personaSummaryStyle
  );
  const initSelectedRiskPreferenceLabel = resolveOptionLabel(
    riskPreferenceOptions,
    initForm.focusRiskPreference
  );
  const initSelectedReportPriorityLabel = resolveOptionLabel(
    reportPriorityPresetOptions,
    initForm.reportPriorityPreset
  );
  const initSelectedAgentsModeDescription =
    initForm.agentsMode === "inline"
      ? t("shell.butlerAgentsModeInlineDescription")
      : t("shell.butlerAgentsModeFileDescription");
  const initPreviewTags = [
    initSelectedAgentsModeLabel,
    initSelectedLanguageLabel,
    initSelectedRiskPreferenceLabel
  ];

  const sidePanel = useMemo(
    () => (
      <ButlerAuxiliaryPanel
        overview={overview}
        events={events}
        inboxItems={inboxItems}
        followUpTasks={followUpTasks}
        patrolPlans={patrolPlans}
        settingsForm={settingsForm}
        savingSettings={savingSettings}
        onOpenFollowUpHistory={handleOpenFollowUpHistory}
        onOpenFollowUpDetail={handleOpenFollowUpDetail}
        onSettingsFormChange={handleSettingsFormChange}
        onSaveSettings={() => {
          void handleSaveSettings();
        }}
      />
    ),
    [
      events,
      handleOpenFollowUpHistory,
      followUpTasks,
      handleOpenFollowUpDetail,
      handleSaveSettings,
      handleSettingsFormChange,
      inboxItems,
      overview,
      patrolPlans,
      savingSettings,
      settingsForm
    ]
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
      <main className="workbench-page butler-page-shell butler-init-shell">
        <div className="butler-init-backdrop" aria-hidden="true">
          <span className="butler-init-glow butler-init-glow-primary" />
          <span className="butler-init-glow butler-init-glow-secondary" />
        </div>

        <div className="butler-init-layout">
            <aside className="butler-init-sidebar">
              <section className="butler-init-hero-card">
                <div className="butler-init-hero-copy">
                  <h1>{t("shell.butlerInitTitle")}</h1>
                  <p>{t("shell.butlerInitDescription")}</p>
                </div>
              </section>

              <section className="butler-init-preview-card">
                <header className="butler-init-section-header">
                  <div>
                    <h2>{t("shell.butlerInitPreviewTitle")}</h2>
                  </div>
                </header>

                <div className="butler-init-preview-identity">
                  <div className="butler-init-preview-nameplate">
                    <div className="butler-chat-avatar butler-init-preview-avatar">
                      <span>{butlerAvatar}</span>
                    </div>
                    <strong>{butlerDisplayName}</strong>
                  </div>
                  <span className="butler-init-preview-provider">{initSelectedProviderLabel}</span>
                </div>

                <div className="butler-init-chip-list">
                  {initPreviewTags.map((tag) => (
                    <span key={tag} className="butler-init-chip">
                      {tag}
                    </span>
                  ))}
                </div>

                <div className="butler-init-preview-rows">
                  <div className="butler-init-preview-row">
                    <span>{t("shell.butlerPersonaToneLabel")}</span>
                    <strong>{initSelectedToneLabel}</strong>
                  </div>
                  <div className="butler-init-preview-row">
                    <span>{t("shell.butlerInitPreviewRuleLabel")}</span>
                    <strong>{initSelectedAgentsModeLabel}</strong>
                  </div>
                  <div className="butler-init-preview-row">
                    <span>{t("shell.butlerPersonaSummaryStyleLabel")}</span>
                    <strong>{initSelectedSummaryStyleLabel}</strong>
                  </div>
                  <div className="butler-init-preview-row">
                    <span>{t("shell.butlerReportPriorityPresetLabel")}</span>
                    <strong>{initSelectedReportPriorityLabel}</strong>
                  </div>
                </div>

              </section>
            </aside>

            <form className="butler-init-form" onSubmit={handleProfileInitSubmit}>
              <section className="butler-init-form-section">
                <header className="butler-init-section-header">
                  <div>
                    <h2>{t("shell.butlerInitBasicsTitle")}</h2>
                  </div>
                </header>

                <div className="butler-init-basic-grid">
                  <label className="butler-form-field">
                    <span>{t("shell.butlerDisplayNameLabel")}</span>
                    <input
                      className="butler-form-control"
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
                      className="butler-form-control"
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

                  <label className="butler-form-field butler-form-field-wide">
                    <span>{t("shell.butlerAgentsModeLabel")}</span>
                    <select
                      className="butler-form-control"
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
                    <small>{initSelectedAgentsModeDescription}</small>
                  </label>
                </div>
              </section>

              <section className="butler-init-form-section">
                <header className="butler-init-section-header">
                  <div>
                    <h2>{t("shell.butlerInitPersonaTitle")}</h2>
                  </div>
                </header>

                <div className="butler-init-persona-grid">
                  <label className="butler-form-field">
                    <span>{t("shell.butlerPersonaToneLabel")}</span>
                    <select
                      className="butler-form-control"
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
                      className="butler-form-control"
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
                      className="butler-form-control"
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
                </div>
              </section>

              <section className="butler-init-form-section">
                <header className="butler-init-section-header">
                  <div>
                    <h2>{t("shell.butlerInitPreferenceTitle")}</h2>
                  </div>
                </header>

                <div className="butler-init-preferences-grid">
                  <label className="butler-form-field">
                    <span>{t("shell.butlerFocusRiskPreferenceLabel")}</span>
                    <select
                      className="butler-form-control"
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
                      className="butler-form-control"
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
                </div>
              </section>

              <div className="butler-init-actions">
                <button
                  className="butler-init-submit"
                  type="submit"
                  disabled={loading || initializingProfile}
                >
                  {loading || initializingProfile
                    ? t("shell.butlerInitSubmitting")
                    : t("shell.butlerInitSubmit")}
                </button>
              </div>
            </form>
        </div>
      </main>
    );
  }

  return (
    <>
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
      <WorkbenchModal
        open={followUpHistoryOpen}
        title={t("shell.butlerFollowUpHistoryTitle")}
        description={t("shell.butlerFollowUpHistoryDescription")}
        onClose={() => {
          setFollowUpHistoryOpen(false);
        }}
      >
        <FollowUpHistoryPanel
          tasks={followUpTasks}
          onOpenFollowUpDetail={handleOpenFollowUpDetail}
          onClose={() => {
            setFollowUpHistoryOpen(false);
          }}
        />
      </WorkbenchModal>
      <WorkbenchModal
        open={detailTaskId !== null}
        title={t("shell.butlerAutomationRoundDetailsTitle")}
        description={detailTask?.sessionTitle?.trim() || detailTask?.projectName || t("shell.butlerAutomationRoundDetailsDescription")}
        onClose={() => {
          setDetailTaskId(null);
          setDetailTask(null);
          setDetailError(null);
          setDetailLoading(false);
        }}
      >
        <FollowUpRoundDetailsPanel
          task={detailTask}
          loading={detailLoading}
          error={detailError}
        />
      </WorkbenchModal>
    </>
  );
}

function ButlerAuxiliaryPanel(props: {
  overview: ButlerOverviewDto | null;
  events: ButlerControlEventDto[];
  inboxItems: ButlerInboxItemDto[];
  followUpTasks: ButlerFollowUpTaskDto[];
  patrolPlans: ButlerPatrolPlanDto[];
  settingsForm: ButlerSettingsFormState;
  savingSettings: boolean;
  onOpenFollowUpHistory: () => void;
  onOpenFollowUpDetail: (taskId: string) => Promise<void>;
  onSettingsFormChange: (patch: Partial<ButlerSettingsFormState>) => void;
  onSaveSettings: () => void;
}) {
  const [activeTab, setActiveTab] = useState<"info" | "automation" | "settings">("info");
  const tabs = [
    { id: "info", label: t("shell.butlerSidebarInfoTab") },
    { id: "automation", label: t("shell.butlerSidebarAutomationTab") },
    { id: "settings", label: t("shell.butlerSidebarSettingsTab") }
  ] as const;

  return (
    <div className="butler-side-column">
      <div className="workbench-auxiliary-header butler-side-header">
        <div
          className="workbench-info-tabs butler-side-tabs"
          role="tablist"
          aria-label={t("shell.butlerSidebarTabsLabel")}
        >
          {tabs.map((tab) => (
            <button
              key={tab.id}
              type="button"
              role="tab"
              aria-selected={activeTab === tab.id}
              className={activeTab === tab.id ? "workbench-info-tab active" : "workbench-info-tab"}
              onClick={() => {
                setActiveTab(tab.id);
              }}
            >
              {tab.label}
            </button>
          ))}
        </div>
      </div>
      {activeTab === "info" ? (
        <GlobalRecordsSidebarContent
          overview={props.overview}
          inboxItems={props.inboxItems}
          followUpTasks={props.followUpTasks}
          onOpenFollowUpHistory={props.onOpenFollowUpHistory}
          onOpenFollowUpDetail={props.onOpenFollowUpDetail}
        />
      ) : activeTab === "automation" ? (
        <AutomationSidebarContent
          overview={props.overview}
          followUpTasks={props.followUpTasks}
          patrolPlans={props.patrolPlans}
        />
      ) : (
        <SettingsSidebarContent
          settingsForm={props.settingsForm}
          savingSettings={props.savingSettings}
          onSettingsFormChange={props.onSettingsFormChange}
          onSaveSettings={props.onSaveSettings}
        />
      )}
    </div>
  );
}

function GlobalRecordsSidebarContent(props: {
  overview: ButlerOverviewDto | null;
  inboxItems: ButlerInboxItemDto[];
  followUpTasks: ButlerFollowUpTaskDto[];
  onOpenFollowUpHistory: () => void;
  onOpenFollowUpDetail: (taskId: string) => Promise<void>;
}) {
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
      <FollowUpStatusCard
        tasks={props.followUpTasks}
        onOpenFollowUpHistory={props.onOpenFollowUpHistory}
        onOpenFollowUpDetail={props.onOpenFollowUpDetail}
      />
      <GlobalRecordCard
        title={t("shell.butlerInfoVerificationRecordsTitle")}
        items={verificationRecords}
        emptyText={t("shell.butlerInfoVerificationRecordsEmpty")}
      />
      <GlobalRecordCard
        title={t("shell.butlerInfoTodoRecordsTitle")}
        items={todoRecords}
        emptyText={t("shell.butlerInfoTodoRecordsEmpty")}
      />
    </>
  );
}

function AutomationSidebarContent(props: {
  overview: ButlerOverviewDto | null;
  followUpTasks: ButlerFollowUpTaskDto[];
  patrolPlans: ButlerPatrolPlanDto[];
}) {
  const automationTasks = useMemo(
    () => buildAutomationTaskItems(props.patrolPlans, props.followUpTasks, props.overview),
    [props.followUpTasks, props.overview, props.patrolPlans]
  );
  const automationRuns = useMemo(
    () => buildAutomationRunItems(props.followUpTasks, props.overview),
    [props.followUpTasks, props.overview]
  );

  return (
    <>
      <AutomationTaskOverviewCard
        items={automationTasks}
        emptyText={t("shell.butlerAutomationTasksEmpty")}
      />
      <AutomationRunOverviewCard
        items={automationRuns}
        emptyText={t("shell.butlerAutomationRunsEmpty")}
      />
    </>
  );
}

function GlobalRecordCard(props: {
  title: string;
  items: Array<{
    title: string;
    content: string;
  }>;
  emptyText: string;
}) {
  return (
    <section className="butler-side-card">
      <header>
        <h2>{props.title}</h2>
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

function FollowUpStatusCard(props: {
  tasks: ButlerFollowUpTaskDto[];
  onOpenFollowUpHistory: () => void;
  onOpenFollowUpDetail: (taskId: string) => Promise<void>;
}) {
  const recentTasks = useMemo(
    () => [...props.tasks]
      .sort((left, right) => parseIsoTime(resolveFollowUpTaskUpdatedAt(right)) - parseIsoTime(resolveFollowUpTaskUpdatedAt(left)))
      .slice(0, 5),
    [props.tasks]
  );

  return (
    <section className="butler-side-card">
      <header>
        <div className="butler-card-header-copy">
          <h2>{t("shell.butlerInfoFollowUpRecordsTitle")}</h2>
        </div>
        <button
          type="button"
          className="secondary-button butler-side-header-action"
          onClick={props.onOpenFollowUpHistory}
        >
          {t("shell.butlerFollowUpHistoryAction")}
        </button>
      </header>
      {recentTasks.length > 0 ? (
        <div className="butler-record-list">
          {recentTasks.map((task) => (
            <FollowUpStatusItem
              key={task.id}
              task={task}
              onOpenFollowUpDetail={props.onOpenFollowUpDetail}
            />
          ))}
        </div>
      ) : (
        <p className="butler-secondary-text">{t("shell.butlerInfoFollowUpRecordsEmpty")}</p>
      )}
    </section>
  );
}

function FollowUpHistoryPanel(props: {
  tasks: ButlerFollowUpTaskDto[];
  onOpenFollowUpDetail: (taskId: string) => Promise<void>;
  onClose: () => void;
}) {
  const sortedTasks = useMemo(
    () => [...props.tasks]
      .sort((left, right) => parseIsoTime(resolveFollowUpTaskUpdatedAt(right)) - parseIsoTime(resolveFollowUpTaskUpdatedAt(left))),
    [props.tasks]
  );

  return (
    <div className="butler-follow-up-history-panel">
      {sortedTasks.length > 0 ? (
        <div className="butler-record-list">
          {sortedTasks.map((task) => (
            <FollowUpStatusItem
              key={task.id}
              task={task}
              onOpenFollowUpDetail={async (taskId) => {
                props.onClose();
                await props.onOpenFollowUpDetail(taskId);
              }}
            />
          ))}
        </div>
      ) : (
        <p className="butler-secondary-text">{t("shell.butlerInfoFollowUpRecordsEmpty")}</p>
      )}
    </div>
  );
}

function FollowUpStatusItem(props: {
  task: ButlerFollowUpTaskDto;
  onOpenFollowUpDetail: (taskId: string) => Promise<void>;
}) {
  const { task } = props;
  const title = task.sessionTitle?.trim() || task.projectName;
  const summary = task.waitingReason?.trim() || task.lastAutomationSummary?.trim() || task.objective;

  return (
    <article className="butler-follow-up-status-card">
      <header className="butler-follow-up-status-header">
        <div className="butler-follow-up-status-title-group">
          <strong>{title}</strong>
          <span>{task.projectName}</span>
        </div>
        <span className="butler-automation-status-badge" data-status={task.status}>
          {resolveFollowUpTaskStatusLabel(task.status)}
        </span>
      </header>
      <div className="butler-follow-up-status-body">
        <p>{summary}</p>
      </div>
      <footer className="butler-follow-up-status-footer">
        <span>{formatIsoDateTime(resolveFollowUpTaskUpdatedAt(task))}</span>
        <button
          type="button"
          className="secondary-button butler-follow-up-status-action"
          onClick={() => {
            void props.onOpenFollowUpDetail(task.id);
          }}
        >
          {t("shell.butlerAutomationViewRoundsAction")}
        </button>
      </footer>
    </article>
  );
}

interface AutomationTaskItem {
  id: string;
  title: string;
  projectName: string;
  taskTypeLabel: string;
  statusLabel: string;
  nextRunAt: string | null;
  lastRunAt: string | null;
}

interface AutomationRunItem {
  id: string;
  title: string;
  projectName: string;
  sourceLabel: string;
  statusLabel: string;
  summary: string;
  createdAt: string;
}

function AutomationTaskOverviewCard(props: {
  items: AutomationTaskItem[];
  emptyText: string;
}) {
  return (
    <section className="butler-side-card">
      <header>
        <h2>{t("shell.butlerAutomationTasksTitle")}</h2>
      </header>
      {props.items.length > 0 ? (
        <div className="butler-record-list">
          {props.items.map((item) => (
            <article key={item.id} className="butler-automation-card">
              <header className="butler-automation-card-header">
                <div className="butler-automation-card-title-group">
                  <strong>{item.title}</strong>
                  <span>{item.projectName}</span>
                </div>
                <span className="butler-automation-status-badge" data-status="active">
                  {item.statusLabel}
                </span>
              </header>
              <div className="butler-automation-card-body">
                <div className="butler-automation-row">
                  <span>{t("shell.butlerAutomationTaskTypeLabel")}</span>
                  <strong>{item.taskTypeLabel}</strong>
                </div>
                <div className="butler-automation-row">
                  <span>{t("shell.butlerAutomationTaskLastRunLabel")}</span>
                  <strong>{formatIsoDateTime(item.lastRunAt)}</strong>
                </div>
              </div>
              <footer className="butler-automation-card-footer">
                <span>{t("shell.butlerAutomationTaskNextRunLabel")}</span>
                <strong>{formatIsoDateTime(item.nextRunAt)}</strong>
              </footer>
            </article>
          ))}
        </div>
      ) : (
        <p className="butler-secondary-text">{props.emptyText}</p>
      )}
    </section>
  );
}

function AutomationRunOverviewCard(props: {
  items: AutomationRunItem[];
  emptyText: string;
}) {
  return (
    <section className="butler-side-card">
      <header>
        <h2>{t("shell.butlerAutomationRunsTitle")}</h2>
      </header>
      {props.items.length > 0 ? (
        <div className="butler-record-list">
          {props.items.map((item) => (
            <article key={item.id} className="butler-automation-card">
              <header className="butler-automation-card-header">
                <div className="butler-automation-card-title-group">
                  <strong>{item.title}</strong>
                  <span>{item.projectName}</span>
                </div>
                <span className="butler-automation-status-badge" data-status="active">
                  {item.statusLabel}
                </span>
              </header>
              <div className="butler-automation-card-body">
                <div className="butler-automation-row">
                  <span>{t("shell.butlerAutomationRunSourceLabel")}</span>
                  <strong>{item.sourceLabel}</strong>
                </div>
                <div className="butler-automation-row">
                  <span>{t("shell.butlerAutomationRunSummaryLabel")}</span>
                  <strong>{item.summary}</strong>
                </div>
              </div>
              <footer className="butler-automation-card-footer">
                <span>{t("shell.butlerAutomationRunProcessedAtLabel")}</span>
                <strong>{formatIsoDateTime(item.createdAt)}</strong>
              </footer>
            </article>
          ))}
        </div>
      ) : (
        <p className="butler-secondary-text">{props.emptyText}</p>
      )}
    </section>
  );
}

function SettingsSidebarContent(props: {
  settingsForm: ButlerSettingsFormState;
  savingSettings: boolean;
  onSettingsFormChange: (patch: Partial<ButlerSettingsFormState>) => void;
  onSaveSettings: () => void;
}) {
  return (
    <section className="butler-side-card butler-settings-panel">
      <header>
        <h2>{t("shell.butlerSettingsTitle")}</h2>
      </header>
      <label className="butler-form-field">
        <span>{t("shell.butlerDisplayNameLabel")}</span>
        <input
          aria-label={t("shell.butlerDisplayNameLabel")}
          className="butler-form-control"
          value={props.settingsForm.displayName}
          disabled={props.savingSettings}
          onChange={(event) => {
            props.onSettingsFormChange({
              displayName: event.target.value
            });
          }}
        />
      </label>
      <label className="butler-form-field">
        <span>{t("shell.butlerAgentsModeLabel")}</span>
        <select
          aria-label={t("shell.butlerAgentsModeLabel")}
          className="butler-form-control"
          value={props.settingsForm.agentsMode}
          disabled={props.savingSettings}
          onChange={(event) => {
            props.onSettingsFormChange({
              agentsMode: event.target.value as ButlerSettingsFormState["agentsMode"]
            });
          }}
        >
          <option value="inline">{t("shell.butlerAgentsModeInline")}</option>
          <option value="file">{t("shell.butlerAgentsModeFile")}</option>
        </select>
        <small>
          {props.settingsForm.agentsMode === "file"
            ? t("shell.butlerAgentsModeFileDescription")
            : t("shell.butlerAgentsModeInlineDescription")}
        </small>
      </label>
      {props.settingsForm.agentsMode === "file" ? (
        <label className="butler-form-field">
          <span>{t("shell.butlerAgentsFilePathLabel")}</span>
          <input
            aria-label={t("shell.butlerAgentsFilePathLabel")}
            className="butler-form-control butler-settings-file-path"
            value={props.settingsForm.agentsFilePath}
            readOnly
            disabled={props.savingSettings}
          />
        </label>
      ) : null}
      <label className="butler-form-field">
        <span>{t("shell.butlerAgentsContentLabel")}</span>
        <textarea
          aria-label={t("shell.butlerAgentsContentLabel")}
          className="butler-form-control butler-settings-agents-editor"
          rows={10}
          value={props.settingsForm.agentsContent}
          disabled={props.savingSettings}
          placeholder={t("shell.butlerAgentsContentPlaceholder")}
          onChange={(event) => {
            props.onSettingsFormChange({
              agentsContent: event.target.value
            });
          }}
        />
        <small>{t("shell.butlerAgentsContentHint")}</small>
      </label>
      <label className="butler-form-field">
        <span>{t("shell.butlerPersonaToneLabel")}</span>
        <select
          aria-label={t("shell.butlerPersonaToneLabel")}
          className="butler-form-control"
          value={props.settingsForm.personaTone}
          disabled={props.savingSettings}
          onChange={(event) => {
            props.onSettingsFormChange({
              personaTone: event.target.value as ButlerToneId
            });
          }}
        >
          <option value="direct">{t("shell.butlerToneDirect")}</option>
          <option value="steady">{t("shell.butlerToneSteady")}</option>
          <option value="friendly">{t("shell.butlerToneFriendly")}</option>
        </select>
      </label>
      <label className="butler-form-field">
        <span>{t("shell.butlerPersonaLanguageLabel")}</span>
        <select
          aria-label={t("shell.butlerPersonaLanguageLabel")}
          className="butler-form-control"
          value={props.settingsForm.personaLanguage}
          disabled={props.savingSettings}
          onChange={(event) => {
            props.onSettingsFormChange({
              personaLanguage: event.target.value as ButlerLanguageId
            });
          }}
        >
          <option value="zh-CN">{t("shell.butlerLanguageZhCn")}</option>
          <option value="en-US">{t("shell.butlerLanguageEnUs")}</option>
          <option value="bilingual">{t("shell.butlerLanguageBilingual")}</option>
        </select>
      </label>
      <label className="butler-form-field">
        <span>{t("shell.butlerPersonaSummaryStyleLabel")}</span>
        <select
          aria-label={t("shell.butlerPersonaSummaryStyleLabel")}
          className="butler-form-control"
          value={props.settingsForm.personaSummaryStyle}
          disabled={props.savingSettings}
          onChange={(event) => {
            props.onSettingsFormChange({
              personaSummaryStyle: event.target.value as ButlerSummaryStyleId
            });
          }}
        >
          <option value="brief">{t("shell.butlerSummaryBrief")}</option>
          <option value="structured">{t("shell.butlerSummaryStructured")}</option>
          <option value="thorough">{t("shell.butlerSummaryThorough")}</option>
        </select>
      </label>
      <label className="butler-form-field">
        <span>{t("shell.butlerFocusRiskPreferenceLabel")}</span>
        <select
          aria-label={t("shell.butlerFocusRiskPreferenceLabel")}
          className="butler-form-control"
          value={props.settingsForm.focusRiskPreference}
          disabled={props.savingSettings}
          onChange={(event) => {
            props.onSettingsFormChange({
              focusRiskPreference: event.target.value as ButlerRiskPreferenceId
            });
          }}
        >
          <option value="conservative">{t("shell.butlerRiskConservative")}</option>
          <option value="balanced">{t("shell.butlerRiskBalanced")}</option>
          <option value="proactive">{t("shell.butlerRiskProactive")}</option>
        </select>
      </label>
      <label className="butler-form-field">
        <span>{t("shell.butlerReportPriorityPresetLabel")}</span>
        <select
          aria-label={t("shell.butlerReportPriorityPresetLabel")}
          className="butler-form-control"
          value={props.settingsForm.reportPriorityPreset}
          disabled={props.savingSettings}
          onChange={(event) => {
            props.onSettingsFormChange({
              reportPriorityPreset: event.target.value as ButlerReportPriorityPresetId
            });
          }}
        >
          <option value="risk-first">{t("shell.butlerReportRiskFirst")}</option>
          <option value="blocker-first">{t("shell.butlerReportBlockerFirst")}</option>
          <option value="verification-first">{t("shell.butlerReportVerificationFirst")}</option>
          <option value="progress-first">{t("shell.butlerReportProgressFirst")}</option>
        </select>
      </label>
      <label className="butler-form-field">
        <span>{t("shell.butlerSummaryDebounceLabel")}</span>
        <select
          aria-label={t("shell.butlerSummaryDebounceLabel")}
          className="butler-form-control"
          value={String(props.settingsForm.summaryDebounceSeconds)}
          disabled={props.savingSettings}
          onChange={(event) => {
            props.onSettingsFormChange({
              summaryDebounceSeconds: Number(event.target.value)
            });
          }}
        >
          {SUMMARY_DEBOUNCE_OPTIONS.map((option) => (
            <option key={option.value} value={option.value}>
              {t(option.labelKey)}
            </option>
          ))}
        </select>
      </label>
      <div className="butler-inline-actions">
        <button
          type="button"
          className="primary-button"
          disabled={props.savingSettings}
          onClick={props.onSaveSettings}
        >
          {props.savingSettings ? t("shell.butlerSettingsSaving") : t("shell.butlerSettingsSaveAction")}
        </button>
      </div>
    </section>
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

function resolveFollowUpTaskUpdatedAt(task: ButlerFollowUpTaskDto): string {
  return task.updatedAt || task.lastAutomationAt || task.lastCheckedAt || task.createdAt;
}

function buildAutomationTaskItems(
  patrolPlans: ButlerPatrolPlanDto[],
  followUpTasks: ButlerFollowUpTaskDto[],
  overview: ButlerOverviewDto | null
): AutomationTaskItem[] {
  const projectNameById = new Map(
    (overview?.projects ?? []).map((project) => [project.id, project.name] as const)
  );
  const planItems = patrolPlans.map<AutomationTaskItem>((plan) => ({
    id: `patrol-plan:${plan.id}`,
    title: plan.name,
    projectName: projectNameById.get(plan.projectId) ?? plan.projectId,
    taskTypeLabel: resolveAutomationTaskTypeLabel("patrol_plan", plan.triggerType),
    statusLabel: plan.enabled ? t("shell.butlerAutomationTaskEnabled") : t("shell.butlerAutomationTaskDisabled"),
    nextRunAt: plan.nextRunAt,
    lastRunAt: plan.lastScheduledAt
  }));
  const followUpItems = followUpTasks.map<AutomationTaskItem>((task) => ({
    id: `follow-up:${task.id}`,
    title: task.sessionTitle?.trim() || task.projectName,
    projectName: task.projectName,
    taskTypeLabel: resolveAutomationTaskTypeLabel("follow_up"),
    statusLabel: resolveFollowUpTaskStatusLabel(task.status),
    nextRunAt: task.nextCheckAt,
    lastRunAt: task.lastAutomationAt || task.lastCheckedAt || task.updatedAt
  }));

  return [...planItems, ...followUpItems]
    .sort((left, right) => {
      const leftNext = parseIsoTime(left.nextRunAt);
      const rightNext = parseIsoTime(right.nextRunAt);

      if (leftNext !== rightNext) {
        if (leftNext === 0) {
          return 1;
        }

        if (rightNext === 0) {
          return -1;
        }

        return leftNext - rightNext;
      }

      return parseIsoTime(right.lastRunAt) - parseIsoTime(left.lastRunAt);
    })
    .slice(0, 10);
}

function buildAutomationRunItems(
  followUpTasks: ButlerFollowUpTaskDto[],
  overview: ButlerOverviewDto | null
): AutomationRunItem[] {
  const projectNameById = new Map(
    (overview?.projects ?? []).map((project) => [project.id, project.name] as const)
  );
  const patrolRunItems = (overview?.patrols ?? []).map<AutomationRunItem>((run) => ({
    id: `patrol-run:${run.id}`,
    title: t("shell.butlerAutomationPatrolRunTitle"),
    projectName: projectNameById.get(run.projectId) ?? run.projectId,
    sourceLabel: resolveAutomationRunSourceLabel("patrol_run"),
    statusLabel: run.status,
    summary: run.summary?.trim() || t("shell.butlerAutomationRunEmptySummary"),
    createdAt: run.finishedAt || run.startedAt || run.createdAt
  }));
  const followUpRunItems = followUpTasks.flatMap<AutomationRunItem>((task) =>
    (task.rounds ?? []).map((round) => ({
      id: `follow-up-round:${task.id}:${round.roundNumber}`,
      title: `${task.sessionTitle?.trim() || task.projectName} · ${t("shell.butlerAutomationRoundLabel", { round: round.roundNumber })}`,
      projectName: task.projectName,
      sourceLabel: resolveAutomationRunSourceLabel("follow_up_round"),
      statusLabel: resolveFollowUpTaskStatusLabel(round.status),
      summary: round.summary?.trim() || t("shell.butlerAutomationRunEmptySummary"),
      createdAt: round.createdAt
    }))
  );

  return [...patrolRunItems, ...followUpRunItems]
    .sort((left, right) => parseIsoTime(right.createdAt) - parseIsoTime(left.createdAt))
    .slice(0, 12);
}

function FollowUpRoundDetailsPanel(props: {
  task: ButlerFollowUpTaskDto | null;
  loading: boolean;
  error: string | null;
}) {
  if (props.loading) {
    return <p className="butler-secondary-text">{t("shell.butlerAutomationRoundLoading")}</p>;
  }

  if (props.error) {
    return <p className="butler-secondary-text">{props.error}</p>;
  }

  if (!props.task) {
    return <p className="butler-secondary-text">{t("shell.butlerAutomationRoundEmpty")}</p>;
  }

  const rounds = [...(props.task.rounds ?? [])]
    .sort((left, right) => parseIsoTime(right.createdAt) - parseIsoTime(left.createdAt));

  return (
    <div className="butler-follow-up-rounds">
      <div className="butler-follow-up-round-summary">
        <strong>{props.task.objective}</strong>
        <span>
          {t("conversation.butlerCurrentFollowUpProgress", {
            current: props.task.autoContinueCount,
            max: props.task.maxAutoContinueCount ?? 5
          })}
        </span>
      </div>
      {rounds.length > 0 ? (
        <div className="butler-follow-up-round-list">
          {rounds.map((round) => (
            <article key={`${round.roundNumber}:${round.createdAt}`} className="butler-follow-up-round-card">
              <header className="butler-follow-up-round-header">
                <div>
                  <strong>{t("shell.butlerAutomationRoundLabel", { round: round.roundNumber })}</strong>
                  <span>{resolveFollowUpRoundKindLabel(round.kind)}</span>
                </div>
                <span>{formatIsoDateTime(round.createdAt)}</span>
              </header>
              <div className="butler-follow-up-round-body">
                <p>
                  {t("shell.butlerAutomationRoundProcessedAtLabel")}：
                  {formatIsoDateTime(round.createdAt)}
                </p>
                <p>
                  {t("shell.butlerAutomationRoundStatusLabel")}：
                  {resolveFollowUpTaskStatusLabel(round.status)}
                </p>
                {round.observedRunningState ? (
                  <p>
                    {t("shell.butlerAutomationRoundObservedStateLabel")}：
                    {round.observedRunningState}
                  </p>
                ) : null}
                <p>
                  {t("shell.butlerAutomationRoundSummaryLabel")}：
                  {round.summary || t("conversation.butlerAnalysisEmpty")}
                </p>
                {round.waitingReason ? (
                  <p>
                    {t("shell.butlerAutomationRoundWaitingReasonLabel")}：
                    {round.waitingReason}
                  </p>
                ) : null}
                {round.continuePrompt ? (
                  <p>
                    {t("shell.butlerAutomationRoundPromptLabel")}：
                    {round.continuePrompt}
                  </p>
                ) : null}
              </div>
            </article>
          ))}
        </div>
      ) : (
        <p className="butler-secondary-text">{t("shell.butlerAutomationRoundEmpty")}</p>
      )}
    </div>
  );
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

function resolveReportPriorityPreset(reportPriority: string[]): ButlerReportPriorityPresetId {
  for (const [preset, priorities] of Object.entries(REPORT_PRIORITY_PRESET_VALUES)) {
    if (
      priorities.length === reportPriority.length
      && priorities.every((value, index) => value === reportPriority[index])
    ) {
      return preset as ButlerReportPriorityPresetId;
    }
  }

  return "risk-first";
}

function resolveAgentsFilePath(profile: {
  workspacePath: string;
  agentsFilePath: string | null;
}): string {
  if (profile.agentsFilePath?.trim()) {
    return profile.agentsFilePath.trim();
  }

  const separator = profile.workspacePath.includes("\\") ? "\\" : "/";
  const normalizedWorkspacePath = profile.workspacePath.replace(/[\\/]+$/, "");
  return `${normalizedWorkspacePath}${separator}AGENTS.md`;
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

function resolveFollowUpRoundKindLabel(kind: ButlerFollowUpTaskRoundDto["kind"]): string {
  switch (kind) {
    case "started":
      return t("shell.butlerAutomationRoundKindStarted");
    case "continue":
      return t("shell.butlerAutomationRoundKindContinue");
    case "queued":
      return t("shell.butlerAutomationRoundKindQueued");
    case "waiting_user":
      return t("shell.butlerAutomationRoundKindWaitingUser");
    case "completed":
      return t("shell.butlerAutomationRoundKindCompleted");
    case "failed":
      return t("shell.butlerAutomationRoundKindFailed");
    case "cancelled":
      return t("shell.butlerAutomationRoundKindCancelled");
    case "limit_reached":
      return t("shell.butlerAutomationRoundKindLimitReached");
    default:
      return kind;
  }
}

function resolveAutomationTaskTypeLabel(
  kind: "patrol_plan" | "follow_up",
  triggerType?: ButlerPatrolPlanDto["triggerType"]
): string {
  if (kind === "follow_up") {
    return t("shell.butlerAutomationTaskTypeFollowUp");
  }

  switch (triggerType) {
    case "interval":
      return t("shell.butlerAutomationTaskTypeInterval");
    case "cron":
      return t("shell.butlerAutomationTaskTypeCron");
    case "manual":
    default:
      return t("shell.butlerAutomationTaskTypeManual");
  }
}

function resolveAutomationRunSourceLabel(kind: "patrol_run" | "follow_up_round"): string {
  return kind === "patrol_run"
    ? t("shell.butlerAutomationRunSourcePatrol")
    : t("shell.butlerAutomationRunSourceFollowUp");
}

function resolveButlerAvatar(input: {
  displayName: string;
  providerId: ButlerProviderId;
  tone: ButlerToneId;
}): string {
  const normalized = input.displayName.trim();
  const hashSeed = `${normalized}:${input.providerId}:${input.tone}`;
  const emojiPool = resolveButlerAvatarPool(input);

  if (!hashSeed) {
    return BUTLER_AVATAR_POOLS.default[0]!;
  }

  const codePointTotal = Array.from(hashSeed).reduce((total, character) => {
    const codePoint = character.codePointAt(0) ?? 0;
    return total + codePoint;
  }, 0);

  return emojiPool[codePointTotal % emojiPool.length]!;
}

function resolveButlerAvatarPool(input: {
  displayName: string;
  providerId: ButlerProviderId;
  tone: ButlerToneId;
}): readonly string[] {
  const normalized = input.displayName.trim().toLowerCase();

  // 先看名字有没有明显语义，再回退到供应商和语气，保证同一助手稳定落在同一组头像里。
  if (/(bot|ai|智能|助手|助理|管家|buddy|helper)/.test(normalized)) {
    return BUTLER_AVATAR_POOLS.builder;
  }

  if (/(书|学|知|研|析|查|review|audit|scan)/.test(normalized)) {
    return BUTLER_AVATAR_POOLS.analyst;
  }

  if (input.tone === "friendly") {
    return BUTLER_AVATAR_POOLS.friendly;
  }

  if (input.tone === "steady") {
    return BUTLER_AVATAR_POOLS.steady;
  }

  if (input.tone === "direct") {
    return input.providerId === "claude-code"
      ? BUTLER_AVATAR_POOLS.analyst
      : BUTLER_AVATAR_POOLS.direct;
  }

  if (input.providerId === "claude-code") {
    return BUTLER_AVATAR_POOLS.analyst;
  }

  return BUTLER_AVATAR_POOLS.default;
}

function resolveOptionLabel<T extends string>(
  options: ReadonlyArray<{ value: T; label: string }>,
  value: T
): string {
  return options.find((option) => option.value === value)?.label ?? value;
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
