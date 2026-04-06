import { useEffect, useMemo, useRef, useState, type FormEvent, type ReactNode } from "react";
import { useNavigate, useParams, useSearchParams } from "react-router-dom";

import { t } from "../../../shared/i18n";
import { useToast } from "../../../shared/toast";
import {
  getSessionMessages,
  type HistoryMessageDto
} from "../../conversation/api/conversation-api";
import { ComposerPanel } from "../../conversation/components/ComposerPanel";
import { MessageTimeline } from "../../conversation/components/MessageTimeline";
import { SessionRuntimeStore } from "../../conversation/runtime/session-runtime-store";
import type { SessionMessageViewModel } from "../../conversation/runtime/session-runtime-machine";
import { useWorkbenchShell } from "../../conversation/components/WorkbenchLayout";
import {
  buildWorkspaceButlerPath,
  buildWorkspaceSessionPath
} from "../../workbench/utils/workbench-navigation";
import type {
  ButlerControlEventDto,
  ButlerLanguageId,
  ButlerOverviewDto,
  ButlerProfilePayload,
  ButlerProjectContextDto,
  ButlerProjectDigestDto,
  ButlerProviderId,
  ButlerRiskPreferenceId,
  ButlerSearchHitDto,
  ButlerSearchResultDto,
  ButlerSessionDigestDto,
  ButlerSummaryStyleId,
  ButlerToneId
} from "../api/butler-api";
import {
  getButlerProjectContext,
  openButlerProjectAction,
  resumeButlerProjectSessionAction,
  searchButlerSummaries,
  startButlerPatrolAction,
  startButlerVerificationAction
} from "../api/butler-api";
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
  personaTone: ButlerToneId;
  personaLanguage: ButlerLanguageId;
  personaSummaryStyle: ButlerSummaryStyleId;
  focusRiskPreference: ButlerRiskPreferenceId;
  reportPriorityPreset: ButlerReportPriorityPresetId;
  agentsContent: string;
  summaryDebounceSeconds: number;
}

interface ButlerSearchPreviewState {
  hitKey: string | null;
  sessionId: string | null;
  loading: boolean;
  error: string | null;
  messages: HistoryMessageDto[];
}

type ButlerSidebarTabId = "info" | "automation" | "skills" | "settings";

type ButlerReportPriorityPresetId =
  | "risk-first"
  | "blocker-first"
  | "verification-first"
  | "progress-first";

interface ButlerFocusQuery {
  butlerSessionId: string | null;
  patrolRunId: string | null;
  verificationRunId: string | null;
}

const REPORT_PRIORITY_PRESET_VALUES: Record<ButlerReportPriorityPresetId, string[]> = {
  "risk-first": ["risk", "blocker", "verification"],
  "blocker-first": ["blocker", "risk", "verification"],
  "verification-first": ["verification", "risk", "blocker"],
  "progress-first": ["progress", "risk", "blocker"]
};

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
  personaTone: "direct",
  personaLanguage: "zh-CN",
  personaSummaryStyle: "brief",
  focusRiskPreference: "conservative",
  reportPriorityPreset: "risk-first",
  agentsContent: "",
  summaryDebounceSeconds: 300
};
const DEFAULT_SEARCH_PREVIEW_STATE: ButlerSearchPreviewState = {
  hitKey: null,
  sessionId: null,
  loading: false,
  error: null,
  messages: []
};
const SUMMARY_DEBOUNCE_OPTIONS = [
  { value: 60, labelKey: "shell.butlerSummaryDebounceOption1Minute" },
  { value: 180, labelKey: "shell.butlerSummaryDebounceOption3Minutes" },
  { value: 300, labelKey: "shell.butlerSummaryDebounceOption5Minutes" },
  { value: 600, labelKey: "shell.butlerSummaryDebounceOption10Minutes" },
  { value: 900, labelKey: "shell.butlerSummaryDebounceOption15Minutes" },
  { value: 1800, labelKey: "shell.butlerSummaryDebounceOption30Minutes" }
] as const;

const BUTLER_AVATARS = ["🦉", "🦊", "🧭", "🛠", "🧠", "🔎", "📚", "🦁", "🤖", "🐳"];

export function ButlerPage() {
  const { workspaceId = "" } = useParams();
  const [searchParams] = useSearchParams();
  const navigate = useNavigate();
  const { showToast } = useToast();
  const { requestNavigationRefresh, setAuxiliaryPanel } = useWorkbenchShell();
  const storeRef = useRef<ButlerRuntimeStore | null>(null);
  const currentWorkspaceIdRef = useRef<string | null>(null);
  const [initForm, setInitForm] = useState<ButlerInitFormState>(DEFAULT_INIT_FORM_STATE);
  const [initializingProfile, setInitializingProfile] = useState(false);
  const [viewKey, setViewKey] = useState(0);
  const [settingsForm, setSettingsForm] = useState<ButlerSettingsFormState>(DEFAULT_SETTINGS_FORM_STATE);
  const [savingSettings, setSavingSettings] = useState(false);
  const [projectContext, setProjectContext] = useState<ButlerProjectContextDto | null>(null);
  const [projectContextLoading, setProjectContextLoading] = useState(false);
  const [projectContextError, setProjectContextError] = useState<string | null>(null);
  const [projectActionKey, setProjectActionKey] = useState<string | null>(null);
  const [activeSidebarTab, setActiveSidebarTab] = useState<ButlerSidebarTabId>("info");
  const [searchQuery, setSearchQuery] = useState("");
  const [searchIncludeArchived, setSearchIncludeArchived] = useState(false);
  const [searchLoading, setSearchLoading] = useState(false);
  const [searchError, setSearchError] = useState<string | null>(null);
  const [searchResult, setSearchResult] = useState<ButlerSearchResultDto | null>(null);
  const [searchPreview, setSearchPreview] = useState<ButlerSearchPreviewState>(DEFAULT_SEARCH_PREVIEW_STATE);

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

  const selectedProjectId = searchParams.get("projectId")?.trim() || null;
  const focusedButlerSessionId = searchParams.get("butlerSessionId")?.trim() || null;
  const focusedPatrolRunId = searchParams.get("patrolRunId")?.trim() || null;
  const focusedVerificationRunId = searchParams.get("verificationRunId")?.trim() || null;

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
      personaTone: profile.persona.tone,
      personaLanguage: profile.persona.language,
      personaSummaryStyle: profile.persona.summaryStyle,
      focusRiskPreference: profile.focus.riskPreference,
      reportPriorityPreset: resolveReportPriorityPreset(profile.focus.reportPriority),
      agentsContent: profile.agentsContent,
      summaryDebounceSeconds:
        profile.focus.summaryDebounceSeconds ?? DEFAULT_SETTINGS_FORM_STATE.summaryDebounceSeconds
    });
  }, [profile]);

  useEffect(() => {
    let cancelled = false;

    if (!initialized || !selectedProjectId) {
      setProjectContext(null);
      setProjectContextError(null);
      setProjectContextLoading(false);
      return () => {
        cancelled = true;
      };
    }

    setProjectContextLoading(true);
    setProjectContextError(null);

    void getButlerProjectContext(selectedProjectId)
      .then((response) => {
        if (cancelled) {
          return;
        }

        setProjectContext(response.context);
      })
      .catch((projectError) => {
        if (cancelled) {
          return;
        }

        setProjectContext(null);
        setProjectContextError(projectError instanceof Error ? projectError.message : String(projectError));
      })
      .finally(() => {
        if (!cancelled) {
          setProjectContextLoading(false);
        }
      });

    return () => {
      cancelled = true;
    };
  }, [initialized, selectedProjectId]);

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

  const selectedProjectDigest = useMemo(() => {
    if (!selectedProjectId) {
      return null;
    }

    return overview?.projects.find((project) => project.id === selectedProjectId) ?? null;
  }, [overview?.projects, selectedProjectId]);

  const selectedProject = projectContext?.project ?? selectedProjectDigest ?? null;
  const projectActionsDisabled = !controlSession || switchingProvider || sending || projectContextLoading;
  const sidePanel = useMemo(
    () => (
      <ButlerAuxiliaryPanel
        overview={overview}
        events={events}
        selectedProject={selectedProject}
        selectedProjectId={selectedProjectId}
        projectContext={projectContext}
        projectContextLoading={projectContextLoading}
        projectContextError={projectContextError}
        projectActionsDisabled={projectActionsDisabled}
        projectActionKey={projectActionKey}
        activeSidebarTab={activeSidebarTab}
        searchQuery={searchQuery}
        searchIncludeArchived={searchIncludeArchived}
        searchLoading={searchLoading}
        searchError={searchError}
        searchResult={searchResult}
        searchPreview={searchPreview}
        settingsForm={settingsForm}
        summaryDebounceSeconds={settingsForm.summaryDebounceSeconds}
        savingSettings={savingSettings}
        controlSessionId={controlSession?.id ?? null}
        focusedButlerSessionId={focusedButlerSessionId}
        focusedPatrolRunId={focusedPatrolRunId}
        focusedVerificationRunId={focusedVerificationRunId}
        onSidebarTabChange={setActiveSidebarTab}
        onSearchQueryChange={setSearchQuery}
        onSearchIncludeArchivedChange={setSearchIncludeArchived}
        onSearch={() => {
          void handleSearchSubmit();
        }}
        onLoadSearchHitMessages={(hit) => {
          void handleLoadSearchHitMessages(hit);
        }}
        onNavigateToProject={navigateToProject}
        onNavigateToSearchHit={handleNavigateToSearchHit}
        onProjectAction={handleProjectAction}
        onOpenConversation={(workspaceId, sessionId) => {
          navigate(buildWorkspaceSessionPath(workspaceId, sessionId));
        }}
        onNavigateRoute={(routePath) => {
          navigate(routePath);
        }}
        onSettingsFormChange={(patch) => {
          setSettingsForm((current) => ({
            ...current,
            ...patch
          }));
        }}
        onSaveSettings={() => {
          void handleSaveSettings();
        }}
      />
    ),
    [
      controlSession?.id,
      events,
      focusedButlerSessionId,
      focusedPatrolRunId,
      focusedVerificationRunId,
      handleProjectAction,
      activeSidebarTab,
      navigateToProject,
      navigate,
      overview,
      projectActionKey,
      projectActionsDisabled,
      projectContext,
      projectContextError,
      projectContextLoading,
      searchError,
      searchIncludeArchived,
      searchLoading,
      searchPreview,
      searchQuery,
      searchResult,
      savingSettings,
      settingsForm,
      selectedProject,
      selectedProjectId,
      settingsForm.summaryDebounceSeconds
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
        summaryDebounceSeconds: DEFAULT_SETTINGS_FORM_STATE.summaryDebounceSeconds
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

  async function handleSaveSettings() {
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
  }

  function resetProjectView(providerId: ButlerProviderId) {
    setViewKey((current) => current + 1);
    setProjectContext(null);
    setProjectContextError(null);
    setProjectActionKey(null);
    setActiveSidebarTab("info");
    setSearchQuery("");
    setSearchIncludeArchived(false);
    setSearchError(null);
    setSearchResult(null);
    setSearchPreview(DEFAULT_SEARCH_PREVIEW_STATE);
    navigate(buildWorkspaceButlerPath(workspaceId), {
      replace: true
    });

    if (providerId) {
      requestNavigationRefresh();
    }
  }

  function navigateToProject(project: ButlerProjectDigestDto, focus?: Partial<ButlerFocusQuery>) {
    navigate(buildButlerQueryPath(project.workspaceId, {
      projectId: project.id,
      butlerSessionId: focus?.butlerSessionId ?? null,
      patrolRunId: focus?.patrolRunId ?? null,
      verificationRunId: focus?.verificationRunId ?? null
    }));
  }

  function handleNavigateToSearchHit(hit: ButlerSearchHitDto) {
    if (!hit.projectId || !hit.workspaceId) {
      return;
    }

    navigate(buildButlerQueryPath(hit.workspaceId, {
      projectId: hit.projectId,
      butlerSessionId: hit.kind === "session" ? hit.id : null,
      patrolRunId: hit.kind === "patrol" ? hit.id : null,
      verificationRunId: hit.kind === "verification" ? hit.id : null
    }));
  }

  async function handleProjectAction(
    actionKey: string,
    action: () => Promise<void>,
    successDescription: string
  ) {
    setProjectActionKey(actionKey);

    try {
      await action();
      await Promise.all([store.refreshAll(), refreshSelectedProjectContext()]);
      requestNavigationRefresh();
      showToast({
        title: t("shell.butlerProjectActionSucceeded"),
        description: successDescription,
        tone: "success"
      });
    } catch (actionError) {
      showToast({
        title: t("shell.butlerProjectActionFailed"),
        description: actionError instanceof Error ? actionError.message : undefined,
        tone: "error"
      });
    } finally {
      setProjectActionKey(null);
    }
  }

  async function refreshSelectedProjectContext() {
    if (!selectedProjectId) {
      return;
    }

    try {
      const response = await getButlerProjectContext(selectedProjectId);
      setProjectContext(response.context);
      setProjectContextError(null);
    } catch (projectError) {
      setProjectContextError(projectError instanceof Error ? projectError.message : String(projectError));
    }
  }

  async function handleSearchSubmit() {
    const normalizedQuery = searchQuery.trim();

    if (!normalizedQuery) {
      setSearchResult(null);
      setSearchError(null);
      return;
    }

    setSearchLoading(true);
    setSearchError(null);

    try {
      const response = await searchButlerSummaries({
        q: normalizedQuery,
        projectId: selectedProjectId,
        includeArchived: searchIncludeArchived
      });
      setSearchResult(response.result);
      setSearchPreview(DEFAULT_SEARCH_PREVIEW_STATE);
    } catch (searchRequestError) {
      setSearchResult(null);
      setSearchError(searchRequestError instanceof Error ? searchRequestError.message : String(searchRequestError));
      setSearchPreview(DEFAULT_SEARCH_PREVIEW_STATE);
    } finally {
      setSearchLoading(false);
    }
  }

  async function handleLoadSearchHitMessages(hit: ButlerSearchHitDto) {
    if (!hit.sessionId) {
      return;
    }

    const hitKey = buildSearchHitKey(hit);
    setSearchPreview({
      hitKey,
      sessionId: hit.sessionId,
      loading: true,
      error: null,
      messages: []
    });

    try {
      const response = await getSessionMessages(hit.sessionId, null, 40, "backward");
      setSearchPreview({
        hitKey,
        sessionId: hit.sessionId,
        loading: false,
        error: null,
        messages: response.messages
      });
    } catch (previewError) {
      setSearchPreview({
        hitKey,
        sessionId: hit.sessionId,
        loading: false,
        error: previewError instanceof Error ? previewError.message : String(previewError),
        messages: []
      });
    }
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
          <div className="butler-chat-avatar" aria-hidden="true">
            <span>{butlerAvatar}</span>
          </div>
          <div className="butler-main-heading">
            <h1>{butlerDisplayName}</h1>
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
              void store.refreshAll();
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
  selectedProject: ButlerProjectContextDto["project"] | ButlerProjectDigestDto | null;
  selectedProjectId: string | null;
  projectContext: ButlerProjectContextDto | null;
  projectContextLoading: boolean;
  projectContextError: string | null;
  projectActionsDisabled: boolean;
  projectActionKey: string | null;
  activeSidebarTab: ButlerSidebarTabId;
  searchQuery: string;
  searchIncludeArchived: boolean;
  searchLoading: boolean;
  searchError: string | null;
  searchResult: ButlerSearchResultDto | null;
  searchPreview: ButlerSearchPreviewState;
  settingsForm: ButlerSettingsFormState;
  summaryDebounceSeconds: number;
  savingSettings: boolean;
  controlSessionId: string | null;
  focusedButlerSessionId: string | null;
  focusedPatrolRunId: string | null;
  focusedVerificationRunId: string | null;
  onSidebarTabChange: (tabId: ButlerSidebarTabId) => void;
  onSearchQueryChange: (value: string) => void;
  onSearchIncludeArchivedChange: (value: boolean) => void;
  onSearch: () => void;
  onLoadSearchHitMessages: (hit: ButlerSearchHitDto) => void;
  onNavigateToProject: (project: ButlerProjectDigestDto, focus?: Partial<ButlerFocusQuery>) => void;
  onNavigateToSearchHit: (hit: ButlerSearchHitDto) => void;
  onProjectAction: (actionKey: string, action: () => Promise<void>, successDescription: string) => Promise<void>;
  onOpenConversation: (workspaceId: string, sessionId: string) => void;
  onNavigateRoute: (routePath: string) => void;
  onSettingsFormChange: (patch: Partial<ButlerSettingsFormState>) => void;
  onSaveSettings: () => void;
}) {
  const selectedProject = props.selectedProject;
  const sidebarTabs: Array<{ id: ButlerSidebarTabId; label: string }> = [
    { id: "info", label: t("shell.butlerSidebarInfoTab") },
    { id: "automation", label: t("shell.butlerSidebarAutomationTab") },
    { id: "skills", label: t("shell.butlerSidebarSkillsTab") },
    { id: "settings", label: t("shell.butlerSidebarSettingsTab") }
  ];

  return (
    <div className="butler-side-column">
      <div className="workbench-auxiliary-header butler-side-tabs-shell">
        <div className="workbench-info-tabs butler-side-tabs" role="tablist" aria-label={t("shell.butlerEntry")}>
          {sidebarTabs.map((tab) => (
            <button
              key={tab.id}
              type="button"
              role="tab"
              aria-selected={props.activeSidebarTab === tab.id}
              className={props.activeSidebarTab === tab.id ? "workbench-info-tab active" : "workbench-info-tab"}
              onClick={() => {
                props.onSidebarTabChange(tab.id);
              }}
            >
              {tab.label}
            </button>
          ))}
        </div>
      </div>

      {props.activeSidebarTab === "info" ? (
        <>
          <section className="butler-side-card surface-card">
            <header>
              <h2>{t("shell.butlerSearchTitle")}</h2>
              <p>{t("shell.butlerSearchDescription")}</p>
            </header>
            <form
              className="butler-search-form"
              onSubmit={(event) => {
                event.preventDefault();
                props.onSearch();
              }}
            >
              <label className="butler-form-field">
                <span>{t("shell.butlerSearchQueryLabel")}</span>
                <input
                  value={props.searchQuery}
                  placeholder={t("shell.butlerSearchPlaceholder")}
                  disabled={props.searchLoading}
                  onChange={(event) => {
                    props.onSearchQueryChange(event.target.value);
                  }}
                />
              </label>
              <p className="butler-secondary-text">
                {props.selectedProject
                  ? t("shell.butlerSearchScopeProject", {
                      projectName: props.selectedProject.name
                    })
                  : t("shell.butlerSearchScopeGlobal")}
              </p>
              <label className="butler-search-toggle">
                <input
                  type="checkbox"
                  checked={props.searchIncludeArchived}
                  disabled={props.searchLoading}
                  onChange={(event) => {
                    props.onSearchIncludeArchivedChange(event.target.checked);
                  }}
                />
                <span>{t("shell.butlerSearchIncludeArchived")}</span>
              </label>
              <p className="butler-secondary-text">{t("shell.butlerSearchIncludeArchivedHint")}</p>
              <div className="butler-inline-actions">
                <button type="submit" disabled={props.searchLoading}>
                  {props.searchLoading ? t("shell.butlerSearchSearching") : t("shell.butlerSearchAction")}
                </button>
              </div>
            </form>
            {props.searchError ? (
              <p className="butler-secondary-text" data-tone="error">
                {props.searchError}
              </p>
            ) : props.searchResult ? (
              props.searchResult.items.length > 0 ? (
                <div className="butler-context-list">
                  {props.searchResult.items.map((item) => (
                    <article key={`${item.kind}:${item.id}`} className="butler-context-item">
                      <div className="butler-context-item-header">
                        <strong>{item.title}</strong>
                        <span>{renderSearchKind(item.kind, item.isArchived)}</span>
                      </div>
                      <p>{item.summary}</p>
                      <p className="butler-secondary-text">
                        {t("shell.butlerSearchUpdatedAt", {
                          updatedAt: formatIsoDateTime(item.updatedAt)
                        })}
                      </p>
                      {item.projectId && item.workspaceId ? (
                        <div className="butler-inline-actions">
                          <button
                            type="button"
                            onClick={() => {
                              props.onNavigateToSearchHit(item);
                            }}
                          >
                            {t("shell.butlerSearchOpenAction")}
                          </button>
                          {item.sessionId ? (
                            <button
                              type="button"
                              onClick={() => {
                                props.onLoadSearchHitMessages(item);
                              }}
                            >
                              {props.searchPreview.loading
                                && props.searchPreview.hitKey === buildSearchHitKey(item)
                                ? t("shell.butlerSearchPreviewLoading")
                                : t("shell.butlerSearchPreviewAction")}
                            </button>
                          ) : null}
                        </div>
                      ) : null}
                      {item.sessionId && props.searchPreview.hitKey === buildSearchHitKey(item) ? (
                        <SearchPreviewPanel preview={props.searchPreview} />
                      ) : null}
                    </article>
                  ))}
                </div>
              ) : (
                <p className="butler-secondary-text">{t("shell.butlerSearchEmptyResult")}</p>
              )
            ) : (
              <p className="butler-secondary-text">{t("shell.butlerSearchEmptyPrompt")}</p>
            )}
          </section>

          <InfoSidebarContent
            overview={props.overview}
            events={props.events}
            selectedProject={selectedProject}
            selectedProjectId={props.selectedProjectId}
            projectContext={props.projectContext}
            projectContextLoading={props.projectContextLoading}
            projectContextError={props.projectContextError}
            projectActionsDisabled={props.projectActionsDisabled}
            projectActionKey={props.projectActionKey}
            controlSessionId={props.controlSessionId}
            focusedButlerSessionId={props.focusedButlerSessionId}
            focusedPatrolRunId={props.focusedPatrolRunId}
            focusedVerificationRunId={props.focusedVerificationRunId}
            onNavigateToProject={props.onNavigateToProject}
            onProjectAction={props.onProjectAction}
            onOpenConversation={props.onOpenConversation}
            onNavigateRoute={props.onNavigateRoute}
          />
        </>
      ) : null}

      {props.activeSidebarTab === "automation" ? (
        <SidebarPlaceholderCard
          title={t("shell.butlerSidebarAutomationTab")}
          description={t("shell.butlerSidebarAutomationEmpty")}
        />
      ) : null}

      {props.activeSidebarTab === "skills" ? (
        <SidebarPlaceholderCard
          title={t("shell.butlerSidebarSkillsTab")}
          description={t("shell.butlerSidebarSkillsEmpty")}
        />
      ) : null}

      {props.activeSidebarTab === "settings" ? (
        <section className="butler-side-card surface-card">
          <header>
            <h2>{t("shell.butlerSettingsTitle")}</h2>
            <p>{t("shell.butlerSettingsDescription")}</p>
          </header>
          <label className="butler-form-field">
            <span>{t("shell.butlerDisplayNameLabel")}</span>
            <input
              aria-label={t("shell.butlerDisplayNameLabel")}
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
          </label>
          <label className="butler-form-field">
            <span>{t("shell.butlerPersonaToneLabel")}</span>
            <select
              aria-label={t("shell.butlerPersonaToneLabel")}
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
            <small>{t("shell.butlerSummaryDebounceHint")}</small>
          </label>
          <label className="butler-form-field">
            <span>{t("shell.butlerAgentsContentLabel")}</span>
            <textarea
              aria-label={t("shell.butlerAgentsContentLabel")}
              rows={14}
              value={props.settingsForm.agentsContent}
              disabled={props.savingSettings}
              onChange={(event) => {
                props.onSettingsFormChange({
                  agentsContent: event.target.value
                });
              }}
            />
            <small>{t("shell.butlerAgentsContentHint")}</small>
          </label>
          <div className="butler-inline-actions">
            <button
              type="button"
              disabled={props.savingSettings}
              onClick={props.onSaveSettings}
            >
              {props.savingSettings
                ? t("shell.butlerSettingsSaving")
                : t("shell.butlerSettingsSaveAction")}
            </button>
          </div>
        </section>
      ) : null}
    </div>
  );
}

function InfoSidebarContent(props: {
  overview: ButlerOverviewDto | null;
  events: ButlerControlEventDto[];
  selectedProject: ButlerProjectContextDto["project"] | ButlerProjectDigestDto | null;
  selectedProjectId: string | null;
  projectContext: ButlerProjectContextDto | null;
  projectContextLoading: boolean;
  projectContextError: string | null;
  projectActionsDisabled: boolean;
  projectActionKey: string | null;
  controlSessionId: string | null;
  focusedButlerSessionId: string | null;
  focusedPatrolRunId: string | null;
  focusedVerificationRunId: string | null;
  onNavigateToProject: (project: ButlerProjectDigestDto, focus?: Partial<ButlerFocusQuery>) => void;
  onProjectAction: (actionKey: string, action: () => Promise<void>, successDescription: string) => Promise<void>;
  onOpenConversation: (workspaceId: string, sessionId: string) => void;
  onNavigateRoute: (routePath: string) => void;
}) {
  const selectedProject = props.selectedProject;

  return (
    <>
      <section className="butler-side-card surface-card">
        <header>
          <h2>{t("shell.butlerOverviewTitle")}</h2>
          <p>{t("shell.butlerOverviewDescription")}</p>
        </header>
        {props.overview ? (
          <div className="butler-overview-content">
            <div className="butler-overview-metrics">
              <article>
                <span>{t("shell.butlerMetricProjectCount")}</span>
                <strong>{props.overview.global.projectCount}</strong>
              </article>
              <article>
                <span>{t("shell.butlerMetricBlockedCount")}</span>
                <strong>{props.overview.global.blockedProjectCount}</strong>
              </article>
              <article>
                <span>{t("shell.butlerMetricHighRiskCount")}</span>
                <strong>{props.overview.global.highRiskProjectCount}</strong>
              </article>
            </div>

            <div className="butler-overview-list">
              <h3>{t("shell.butlerTopRisksTitle")}</h3>
              {props.overview.global.topRisks.length > 0 ? (
                <ul>
                  {props.overview.global.topRisks.map((risk) => (
                    <li key={risk}>{risk}</li>
                  ))}
                </ul>
              ) : (
                <p>{t("shell.butlerOverviewEmpty")}</p>
              )}
            </div>

            <div className="butler-overview-list">
              <h3>{t("shell.butlerNextActionsTitle")}</h3>
              {props.overview.global.nextActions.length > 0 ? (
                <ul>
                  {props.overview.global.nextActions.map((action) => (
                    <li key={action}>{action}</li>
                  ))}
                </ul>
              ) : (
                <p>{t("shell.butlerOverviewEmpty")}</p>
              )}
            </div>
          </div>
        ) : (
          <p className="butler-secondary-text">{t("shell.butlerOverviewLoading")}</p>
        )}
      </section>

      <section className="butler-side-card surface-card">
        <header>
          <h2>{t("shell.butlerProjectsTitle")}</h2>
          <p>{t("shell.butlerProjectsDescription")}</p>
        </header>

        {props.overview?.projects.length ? (
          <div className="butler-project-list">
            {props.overview.projects.map((project) => {
              const active = selectedProject?.id === project.id;

              return (
                <article
                  key={project.id}
                  className="butler-project-card"
                  data-active={active}
                >
                  <div className="butler-project-card-header">
                    <div>
                      <strong>{project.name}</strong>
                      <p>
                        {t("shell.butlerProjectWorkspaceLabel", {
                          workspaceId: project.workspaceId
                        })}
                      </p>
                    </div>
                    <span className="butler-project-risk-chip" data-risk={project.riskLevel}>
                      {project.riskLevel}
                    </span>
                  </div>

                  <p className="butler-project-card-summary">
                    {project.latestSessionSummary
                      ?? project.latestPatrolSummary
                      ?? project.latestVerificationSummary
                      ?? t("shell.butlerProjectSummaryEmpty")}
                  </p>

                  <div className="butler-project-card-actions">
                    <button
                      type="button"
                      onClick={() => {
                        props.onNavigateToProject(project);
                      }}
                    >
                      {t("shell.butlerProjectOpenDetailAction")}
                    </button>
                    <button
                      type="button"
                      disabled={props.projectActionsDisabled}
                      onClick={() => {
                        void props.onProjectAction(
                          `sync:${project.id}`,
                          async () => {
                            await openButlerProjectAction(project.id);
                            props.onNavigateToProject(project);
                          },
                          t("shell.butlerProjectSyncSucceeded", {
                            projectName: project.name
                          })
                        );
                      }}
                    >
                      {props.projectActionKey === `sync:${project.id}`
                        ? t("shell.butlerProjectActionPending")
                        : t("shell.butlerProjectSyncAction")}
                    </button>
                  </div>
                </article>
              );
            })}
          </div>
        ) : (
          <p className="butler-secondary-text">{t("shell.butlerProjectsEmpty")}</p>
        )}

        {!props.controlSessionId ? (
          <p className="butler-secondary-text">{t("shell.butlerProjectActionRequiresSession")}</p>
        ) : null}
      </section>

      <section className="butler-side-card surface-card">
        <header>
          <h2>{t("shell.butlerProjectContextTitle")}</h2>
          <p>{t("shell.butlerProjectContextDescription")}</p>
        </header>

        {!props.selectedProjectId ? (
          <p className="butler-secondary-text">{t("shell.butlerProjectContextEmpty")}</p>
        ) : props.projectContextLoading ? (
          <p className="butler-secondary-text">{t("shell.butlerProjectContextLoading")}</p>
        ) : props.projectContextError ? (
          <p className="butler-secondary-text" data-tone="error">
            {props.projectContextError}
          </p>
        ) : props.projectContext && selectedProject ? (
          <div className="butler-project-context">
            <div className="butler-project-context-header">
              <div>
                <strong>{selectedProject.name}</strong>
                <p>
                  {t("shell.butlerProjectContextMeta", {
                    status: selectedProject.lifecycleStatus,
                    riskLevel: selectedProject.riskLevel
                  })}
                </p>
              </div>
              <div className="butler-project-context-actions">
                <button
                  type="button"
                  disabled={props.projectActionsDisabled}
                  onClick={() => {
                    void props.onProjectAction(
                      `patrol:${selectedProject.id}`,
                      async () => {
                        await startButlerPatrolAction({
                          projectId: selectedProject.id,
                          butlerSessionId: props.controlSessionId
                        });
                      },
                      t("shell.butlerProjectPatrolSucceeded", {
                        projectName: selectedProject.name
                      })
                    );
                  }}
                >
                  {props.projectActionKey === `patrol:${selectedProject.id}`
                    ? t("shell.butlerProjectActionPending")
                    : t("shell.butlerProjectStartPatrolAction")}
                </button>
                <button
                  type="button"
                  disabled={props.projectActionsDisabled}
                  onClick={() => {
                    void props.onProjectAction(
                      `verification:${selectedProject.id}`,
                      async () => {
                        await startButlerVerificationAction({
                          projectId: selectedProject.id,
                          butlerSessionId: props.controlSessionId
                        });
                      },
                      t("shell.butlerProjectVerificationSucceeded", {
                        projectName: selectedProject.name
                      })
                    );
                  }}
                >
                  {props.projectActionKey === `verification:${selectedProject.id}`
                    ? t("shell.butlerProjectActionPending")
                    : t("shell.butlerProjectStartVerificationAction")}
                </button>
              </div>
            </div>

            <div className="butler-overview-list">
              <h3>{t("shell.butlerTopRisksTitle")}</h3>
              {props.projectContext.topRisks.length > 0 ? (
                <ul>
                  {props.projectContext.topRisks.map((risk) => (
                    <li key={risk}>{risk}</li>
                  ))}
                </ul>
              ) : (
                <p>{t("shell.butlerOverviewEmpty")}</p>
              )}
            </div>

            <div className="butler-overview-list">
              <h3>{t("shell.butlerNextActionsTitle")}</h3>
              {props.projectContext.nextActions.length > 0 ? (
                <ul>
                  {props.projectContext.nextActions.map((action) => (
                    <li key={action}>{action}</li>
                  ))}
                </ul>
              ) : (
                <p>{t("shell.butlerOverviewEmpty")}</p>
              )}
            </div>

            <ContextSection title={t("shell.butlerProjectSessionsTitle")}>
              {props.projectContext.sessions.length > 0 ? (
                props.projectContext.sessions.map((session) => (
                  <SessionContextItem
                    key={session.id}
                    session={session}
                    focused={props.focusedButlerSessionId === session.id}
                    actionPending={props.projectActionKey === `resume:${session.id}`}
                    actionsDisabled={props.projectActionsDisabled}
                    onOpen={() => {
                      props.onOpenConversation(selectedProject.workspaceId, session.sessionId);
                    }}
                    onResume={() => {
                      void props.onProjectAction(
                        `resume:${session.id}`,
                        async () => {
                          await resumeButlerProjectSessionAction({
                            projectId: selectedProject.id,
                            butlerSessionId: session.id
                          });
                        },
                        t("shell.butlerProjectResumeSucceeded", {
                          sessionTitle: session.title ?? session.sessionId
                        })
                      );
                    }}
                  />
                ))
              ) : (
                <p>{t("shell.butlerOverviewEmpty")}</p>
              )}
            </ContextSection>

            <ContextSection title={t("shell.butlerProjectMemoriesTitle")}>
              {props.projectContext.memories.length > 0 ? (
                props.projectContext.memories.slice(0, 5).map((memory) => (
                  <article key={memory.id} className="butler-context-item">
                    <strong>{memory.title}</strong>
                    <p>
                      {t("shell.butlerProjectMemoryMeta", {
                        memoryType: memory.memoryType,
                        status: memory.status
                      })}
                    </p>
                  </article>
                ))
              ) : (
                <p>{t("shell.butlerOverviewEmpty")}</p>
              )}
            </ContextSection>

            <ContextSection title={t("shell.butlerProjectPatrolsTitle")}>
              {props.projectContext.patrols.length > 0 ? (
                props.projectContext.patrols.slice(0, 5).map((run) => (
                  <RunContextItem
                    key={run.id}
                    label={run.summary ?? t("shell.butlerProjectRunSummaryEmpty")}
                    meta={t("shell.butlerProjectPatrolMeta", {
                      status: run.status,
                      riskLevel: run.riskLevel ?? "unknown"
                    })}
                    focused={props.focusedPatrolRunId === run.id}
                    onFocus={() => {
                      props.onNavigateToProject(selectedProject, {
                        patrolRunId: run.id
                      });
                    }}
                  />
                ))
              ) : (
                <p>{t("shell.butlerOverviewEmpty")}</p>
              )}
            </ContextSection>

            <ContextSection title={t("shell.butlerProjectVerificationsTitle")}>
              {props.projectContext.verifications.length > 0 ? (
                props.projectContext.verifications.slice(0, 5).map((run) => (
                  <RunContextItem
                    key={run.id}
                    label={run.summary ?? t("shell.butlerProjectRunSummaryEmpty")}
                    meta={t("shell.butlerProjectVerificationMeta", {
                      verificationType: run.verificationType,
                      status: run.status
                    })}
                    focused={props.focusedVerificationRunId === run.id}
                    onFocus={() => {
                      props.onNavigateToProject(selectedProject, {
                        verificationRunId: run.id
                      });
                    }}
                  />
                ))
              ) : (
                <p>{t("shell.butlerOverviewEmpty")}</p>
              )}
            </ContextSection>
          </div>
        ) : (
          <p className="butler-secondary-text">{t("shell.butlerProjectContextEmpty")}</p>
        )}
      </section>

      <section className="butler-side-card surface-card">
        <header>
          <h2>{t("shell.butlerEventsTitle")}</h2>
          <p>{t("shell.butlerEventsDescription")}</p>
        </header>

        {props.events.length === 0 ? (
          <p className="butler-secondary-text">{t("shell.butlerEventsEmpty")}</p>
        ) : (
          <div className="butler-event-list">
            {props.events.map((event) => (
              <ActionEventCard
                key={event.id}
                event={event}
                onNavigate={(relatedRef) => {
                  if (!relatedRef.routePath) {
                    return;
                  }

                  props.onNavigateRoute(relatedRef.routePath);
                }}
              />
            ))}
          </div>
        )}
      </section>
    </>
  );
}

function SidebarPlaceholderCard(props: {
  title: string;
  description: string;
}) {
  return (
    <section className="butler-side-card surface-card">
      <header>
        <h2>{props.title}</h2>
      </header>
      <p className="butler-secondary-text">{props.description}</p>
    </section>
  );
}

function SearchPreviewPanel(props: {
  preview: ButlerSearchPreviewState;
}) {
  if (props.preview.loading) {
    return <p className="butler-secondary-text">{t("shell.butlerSearchPreviewLoading")}</p>;
  }

  if (props.preview.error) {
    return (
      <p className="butler-secondary-text" data-tone="error">
        {props.preview.error}
      </p>
    );
  }

  if (props.preview.messages.length === 0) {
    return <p className="butler-secondary-text">{t("shell.butlerSearchPreviewEmpty")}</p>;
  }

  return (
    <section className="butler-search-preview">
      <h3>{t("shell.butlerSearchPreviewTitle")}</h3>
      <div className="butler-search-preview-list">
        {props.preview.messages.map((message) => (
          <article
            key={`${message.messageId}:${message.sequence}`}
            className="butler-search-preview-item"
          >
            <div className="butler-context-item-header">
              <strong>{renderPreviewRole(message.role)}</strong>
              <span>#{message.sequence}</span>
            </div>
            <p>{truncatePreviewContent(message.content)}</p>
            <p className="butler-secondary-text">
              {formatIsoDateTime(message.timestamp)}
            </p>
          </article>
        ))}
      </div>
    </section>
  );
}

function ContextSection(props: { title: string; children: ReactNode }) {
  return (
    <section className="butler-context-section">
      <h3>{props.title}</h3>
      <div className="butler-context-list">{props.children}</div>
    </section>
  );
}

function SessionContextItem(props: {
  session: ButlerSessionDigestDto;
  focused: boolean;
  actionPending: boolean;
  actionsDisabled: boolean;
  onOpen: () => void;
  onResume: () => void;
}) {
  const { session } = props;

  return (
    <article className="butler-context-item" data-focused={props.focused}>
      <div className="butler-context-item-header">
        <strong>{session.title ?? session.sessionId}</strong>
        {props.focused ? <span>{t("shell.butlerFocusedBadge")}</span> : null}
      </div>
      <p>
        {t("shell.butlerProjectSessionMeta", {
          role: session.role,
          status: session.status
        })}
      </p>
      <p>{session.lastSummary ?? t("shell.butlerProjectSummaryEmpty")}</p>
      <div className="butler-inline-actions">
        <button type="button" onClick={props.onOpen}>
          {t("shell.butlerProjectOpenConversationAction")}
        </button>
        <button type="button" disabled={props.actionsDisabled} onClick={props.onResume}>
          {props.actionPending
            ? t("shell.butlerProjectActionPending")
            : t("shell.butlerProjectResumeAction")}
        </button>
      </div>
      <p className="butler-secondary-text">
        {t("shell.butlerProjectUpdatedAtLabel", {
          updatedAt: formatIsoDateTime(session.updatedAt)
        })}
      </p>
    </article>
  );
}

function RunContextItem(props: {
  label: string;
  meta: string;
  focused: boolean;
  onFocus: () => void;
}) {
  return (
    <article className="butler-context-item" data-focused={props.focused}>
      <div className="butler-context-item-header">
        <strong>{props.label}</strong>
        {props.focused ? <span>{t("shell.butlerFocusedBadge")}</span> : null}
      </div>
      <p>{props.meta}</p>
      <div className="butler-inline-actions">
        <button type="button" onClick={props.onFocus}>
          {t("shell.butlerProjectFocusAction")}
        </button>
      </div>
    </article>
  );
}

function ActionEventCard(props: {
  event: ButlerControlEventDto;
  onNavigate: (relatedRef: ButlerControlEventDto["relatedRefs"][number]) => void;
}) {
  return (
    <article
      className="butler-event-card"
      data-status={props.event.status}
    >
      <div className="butler-event-title-row">
        <strong>{props.event.title}</strong>
        <span>{props.event.status}</span>
      </div>
      <p>{props.event.content}</p>
      <p className="butler-secondary-text">
        {t("shell.butlerProjectUpdatedAtLabel", {
          updatedAt: formatIsoDateTime(props.event.createdAt)
        })}
      </p>
      {props.event.relatedRefs.length > 0 ? (
        <div className="butler-related-ref-list">
          {props.event.relatedRefs.map((relatedRef) => (
            <button
              key={`${props.event.id}:${relatedRef.kind}:${relatedRef.id}`}
              type="button"
              disabled={!relatedRef.routePath}
              onClick={() => {
                props.onNavigate(relatedRef);
              }}
            >
              {relatedRef.label}
            </button>
          ))}
        </div>
      ) : null}
    </article>
  );
}

function buildButlerQueryPath(
  workspaceId: string,
  query: {
    projectId?: string | null;
    butlerSessionId?: string | null;
    patrolRunId?: string | null;
    verificationRunId?: string | null;
  }
) {
  const search = new URLSearchParams();

  if (query.projectId) {
    search.set("projectId", query.projectId);
  }

  if (query.butlerSessionId) {
    search.set("butlerSessionId", query.butlerSessionId);
  }

  if (query.patrolRunId) {
    search.set("patrolRunId", query.patrolRunId);
  }

  if (query.verificationRunId) {
    search.set("verificationRunId", query.verificationRunId);
  }

  const path = buildWorkspaceButlerPath(workspaceId);
  const serialized = search.toString();
  return serialized ? `${path}?${serialized}` : path;
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

function buildSearchHitKey(hit: ButlerSearchHitDto): string {
  return `${hit.kind}:${hit.id}`;
}

function renderPreviewRole(role: HistoryMessageDto["role"]): string {
  switch (role) {
    case "assistant":
      return t("shell.butlerSearchPreviewRoleAssistant");
    case "user":
      return t("shell.butlerSearchPreviewRoleUser");
    case "tool":
      return t("shell.butlerSearchPreviewRoleTool");
    case "system":
      return t("shell.butlerSearchPreviewRoleSystem");
    default:
      return role;
  }
}

function truncatePreviewContent(content: string): string {
  const normalized = content.trim();

  if (!normalized) {
    return t("shell.butlerSearchPreviewEmptyContent");
  }

  if (normalized.length <= 220) {
    return normalized;
  }

  return `${normalized.slice(0, 220)}...`;
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

function renderSearchKind(kind: ButlerSearchHitDto["kind"], isArchived: boolean): string {
  const label = (() => {
    switch (kind) {
      case "project":
        return t("shell.butlerSearchKindProject");
      case "session":
        return t("shell.butlerSearchKindSession");
      case "memory":
        return t("shell.butlerSearchKindMemory");
      case "patrol":
        return t("shell.butlerSearchKindPatrol");
      case "verification":
        return t("shell.butlerSearchKindVerification");
      default:
        return kind;
    }
  })();

  if (!isArchived) {
    return label;
  }

  return `${label} · ${t("shell.butlerSearchArchivedBadge")}`;
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
