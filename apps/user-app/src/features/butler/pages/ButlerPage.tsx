import {
  useCallback,
  useEffect,
  useId,
  useMemo,
  useRef,
  useState,
  type FormEvent
} from "react";
import { useNavigate, useParams } from "react-router-dom";

import { resolveMacOsNativeTitlebarDragRegion } from "../../../platform/desktop/window-drag";
import { usePlatform } from "../../../platform/platform-provider";
import { logPerfDebug } from "../../../shared/debug/perf-debug";
import { t } from "../../../shared/i18n";
import { useToast } from "../../../shared/toast";
import { ComposerPanel } from "../../conversation/components/ComposerPanel";
import { MessageTimeline } from "../../conversation/components/MessageTimeline";
import { useWorkbenchShell } from "../../conversation/components/WorkbenchLayout";
import { WorkbenchModal } from "../../conversation/components/WorkbenchModal";
import {
  buildWorkspaceButlerPath,
  buildWorkspaceSessionPath
} from "../../workbench/utils/workbench-navigation";
import type {
  AssistantAutomationRunDto,
  AssistantAutomationTaskDto,
  ButlerControlEventDto,
  ButlerControlSessionDto,
  ButlerControlTimerDto,
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
  analyzeButlerInboxItem,
  cancelAssistantAutomation,
  cancelButlerControlTimer,
  cancelButlerFollowUpTask,
  cancelButlerVerificationRun,
  getButlerFollowUpTask,
  listAssistantAutomations,
  listRecentAssistantAutomationRuns,
  listButlerControlSessions,
  listButlerControlTimers,
  listButlerFollowUpTasks,
  listButlerInboxItems,
  listButlerPatrolPlans,
  startButlerInboxItemSession
} from "../api/butler-api";
import { ButlerAnchoredPopover } from "../components/ButlerAnchoredPopover";
import { ButlerLoadingState } from "../components/ButlerLoadingState";
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

async function writeTextToClipboard(text: string): Promise<void> {
  if (typeof navigator !== "undefined" && navigator.clipboard?.writeText) {
    try {
      await navigator.clipboard.writeText(text);
      return;
    } catch {
      // 浏览器剪贴板权限失败时，继续走旧接口兜底。
    }
  }

  if (copyTextWithExecCommand(text)) {
    return;
  }

  throw new Error(t("conversation.copyContentFailed"));
}

export function ButlerPage() {
  const platform = usePlatform();
  const macOsNativeTitlebarDragRegion = resolveMacOsNativeTitlebarDragRegion(platform);
  const { workspaceId = "" } = useParams();
  const navigate = useNavigate();
  const { showToast } = useToast();
  const { navigationGroups, requestNavigationRefresh, setAuxiliaryPanel } = useWorkbenchShell();
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
  const [controlSessions, setControlSessions] = useState<ButlerControlSessionDto[]>([]);
  const [controlTimers, setControlTimers] = useState<ButlerControlTimerDto[]>([]);
  const [assistantAutomations, setAssistantAutomations] = useState<AssistantAutomationTaskDto[]>([]);
  const [assistantAutomationRuns, setAssistantAutomationRuns] = useState<AssistantAutomationRunDto[]>([]);
  const [analysisOpen, setAnalysisOpen] = useState(false);
  const [followUpHistoryOpen, setFollowUpHistoryOpen] = useState(false);
  const [verificationHistoryOpen, setVerificationHistoryOpen] = useState(false);
  const [automationHistoryOpen, setAutomationHistoryOpen] = useState(false);
  const [controlHistoryOpen, setControlHistoryOpen] = useState(false);
  const [detailTaskId, setDetailTaskId] = useState<string | null>(null);
  const [detailTask, setDetailTask] = useState<ButlerFollowUpTaskDto | null>(null);
  const [detailLoading, setDetailLoading] = useState(false);
  const [detailError, setDetailError] = useState<string | null>(null);
  const [cancellingFollowUpTaskId, setCancellingFollowUpTaskId] = useState<string | null>(null);
  const [cancellingVerificationId, setCancellingVerificationId] = useState<string | null>(null);
  const [cancellingAutomationId, setCancellingAutomationId] = useState<string | null>(null);
  const [cancellingTimerId, setCancellingTimerId] = useState<string | null>(null);
  const [executingTimerId, setExecutingTimerId] = useState<string | null>(null);
  const [countdownNow, setCountdownNow] = useState(() => Date.now());
  const [todoActionState, setTodoActionState] = useState<{
    itemId: string | null;
    kind: "analyze" | "start" | null;
  }>({
    itemId: null,
    kind: null
  });

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
  const loadingOlderMessages = useButlerRuntimeStore(store, (state) => state.loadingOlderMessages);
  const hasOlderMessages = useButlerRuntimeStore(store, (state) => state.hasOlderMessages);
  const runtimeHasActiveRun = useButlerRuntimeStore(store, (state) => state.runtimeHasActiveRun);
  const runtimeCanInterrupt = useButlerRuntimeStore(store, (state) => state.runtimeCanInterrupt);
  const contextUsage = useButlerRuntimeStore(store, (state) => state.contextUsage);
  const error = useButlerRuntimeStore(store, (state) => state.error);
  const debugRenderStateRef = useRef<string | null>(null);

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
  const analysisTasks = useMemo(
    () => followUpTasks.filter((task) => isVisibleFollowUpTask(task.status)).slice(0, 3),
    [followUpTasks]
  );
  const activeControlTimer = useMemo(
    () => {
      if (!controlSession || runtimeHasActiveRun) {
        return null;
      }

      return controlTimers
        .filter((timer) => timer.status === "active" && timer.controlSessionId === controlSession.id)
        .sort((left, right) => parseIsoTime(left.dueAt) - parseIsoTime(right.dueAt))[0] ?? null;
    },
    [controlSession, controlTimers, runtimeHasActiveRun]
  );
  const overviewProjectIds = useMemo(
    () => (overview?.projects ?? []).map((project) => project.id).sort(),
    [overview?.projects]
  );
  const currentWorkspaceName =
    navigationGroups.find((group) => group.workspace.id === workspaceId)?.workspace.name ?? null;
  const projectNameById = useMemo(
    () => new Map((overview?.projects ?? []).map((project) => [project.id, project.name] as const)),
    [overview?.projects]
  );
  const workspaceNameById = useMemo(
    () =>
      new Map(
        navigationGroups.map((group) => [group.workspace.id, group.workspace.name] as const)
      ),
    [navigationGroups]
  );
  const sessionTitleById = useMemo(
    () =>
      new Map(
        navigationGroups.flatMap((group) =>
          group.sessions.map((session) => [session.sessionId, session.title?.trim() || t("common.unknown")] as const)
        )
      ),
    [navigationGroups]
  );

  useEffect(() => {
    setCountdownNow(Date.now());

    if (!activeControlTimer) {
      return;
    }

    const timer = window.setInterval(() => {
      setCountdownNow(Date.now());
    }, 1_000);

    return () => {
      window.clearInterval(timer);
    };
  }, [activeControlTimer]);
  const reloadControlSessionHistory = useCallback(async () => {
    if (!initialized) {
      setControlSessions([]);
      return;
    }

    try {
      const response = await listButlerControlSessions();
      setControlSessions(response.items);
    } catch (error) {
      showToast({
        title: t("shell.butlerSidebarLoadFailed"),
        description: error instanceof Error ? error.message : undefined,
        tone: "error"
      });
    }
  }, [initialized, showToast]);
  const handleOpenFollowUpHistory = useCallback(() => {
    setFollowUpHistoryOpen(true);
  }, []);
  const handleOpenVerificationHistory = useCallback(() => {
    setVerificationHistoryOpen(true);
  }, []);
  const handleOpenAutomationHistory = useCallback(() => {
    setAutomationHistoryOpen(true);
  }, []);
  const handleOpenControlHistory = useCallback(() => {
    setControlHistoryOpen(true);
    void reloadControlSessionHistory();
  }, [reloadControlSessionHistory]);
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
  const handleCancelFollowUpTask = useCallback(async (task: ButlerFollowUpTaskDto) => {
    setCancellingFollowUpTaskId(task.id);

    try {
      const response = await cancelButlerFollowUpTask(task.id);
      setFollowUpTasks((current) => replaceFollowUpTask(current, response.task));
      showToast({
        title: t("conversation.butlerFollowUpStopped"),
        description: t("conversation.butlerFollowUpStoppedDescription"),
        tone: "success"
      });
      await store.reloadEventsAndOverview();
      requestNavigationRefresh();
    } catch (error) {
      showToast({
        title: t("conversation.butlerFollowUpStopFailed"),
        description: error instanceof Error ? error.message : undefined,
        tone: "error"
      });
    } finally {
      setCancellingFollowUpTaskId(null);
    }
  }, [requestNavigationRefresh, showToast, store]);
  const handleCancelVerificationRun = useCallback(async (verification: ButlerVerificationDigestDto) => {
    setCancellingVerificationId(verification.id);

    try {
      await cancelButlerVerificationRun(verification.projectId, verification.id);
      showToast({
        title: t("conversation.butlerVerificationStopped"),
        description: t("conversation.butlerVerificationStoppedDescription"),
        tone: "success"
      });
      await store.reloadEventsAndOverview();
      requestNavigationRefresh();
    } catch (error) {
      showToast({
        title: t("conversation.butlerVerificationStopFailed"),
        description: error instanceof Error ? error.message : undefined,
        tone: "error"
      });
    } finally {
      setCancellingVerificationId(null);
    }
  }, [requestNavigationRefresh, showToast, store]);
  const handleAnalyzeTodo = useCallback(async (item: ButlerInboxItemDto) => {
    setTodoActionState({
      itemId: item.id,
      kind: "analyze"
    });

    try {
      const response = await analyzeButlerInboxItem(item.id);
      setInboxItems((current) => replaceInboxItem(current, response.item));
      setControlSessions((current) => replaceControlSession(current, response.controlSession));
      await store.adoptControlSession(response.controlSession);
      showToast({
        title: t("shell.butlerTodoAnalyzeQueued"),
        tone: "success"
      });
    } catch (error) {
      showToast({
        title: t("shell.butlerTodoAnalyzeFailed"),
        description: error instanceof Error ? error.message : undefined,
        tone: "error"
      });
    } finally {
      setTodoActionState({
        itemId: null,
        kind: null
      });
    }
  }, [showToast]);
  const handleStartTodoSession = useCallback(async (item: ButlerInboxItemDto) => {
    setTodoActionState({
      itemId: item.id,
      kind: "start"
    });

    try {
      const response = await startButlerInboxItemSession(item.id);
      setInboxItems((current) => replaceInboxItem(current, response.item));
      if (response.followUpTask) {
        setFollowUpTasks((current) => replaceFollowUpTask(current, response.followUpTask!));
      }
      requestNavigationRefresh();
      showToast({
        title: t("shell.butlerTodoStartSessionSucceeded"),
        tone: "success"
      });
      navigate(buildWorkspaceSessionPath(response.item.workspaceId, response.session.sessionId));
    } catch (error) {
      showToast({
        title: t("shell.butlerTodoStartSessionFailed"),
        description: error instanceof Error ? error.message : undefined,
        tone: "error"
      });
    } finally {
      setTodoActionState({
        itemId: null,
        kind: null
      });
    }
  }, [navigate, requestNavigationRefresh, showToast]);
  const handleOpenTodoSession = useCallback((item: ButlerInboxItemDto) => {
    const sessionId = item.assistantState.linkedSessionId?.trim();

    if (!sessionId) {
      return;
    }

    navigate(buildWorkspaceSessionPath(item.workspaceId, sessionId));
  }, [navigate]);
  const handleCopyTodoPrompt = useCallback(async (item: ButlerInboxItemDto) => {
    const prompt = item.assistantState.generatedPrompt?.trim();

    if (!prompt) {
      return;
    }

    try {
      await writeTextToClipboard(prompt);
      showToast({
        title: t("shell.butlerTodoCopyPromptSucceeded"),
        tone: "success"
      });
    } catch (error) {
      showToast({
        title: error instanceof Error ? error.message : t("conversation.copyContentFailed"),
        tone: "error"
      });
    }
  }, [showToast]);
  const handleCancelControlTimer = useCallback(async (timerId: string) => {
    setCancellingTimerId(timerId);

    try {
      const response = await cancelButlerControlTimer(timerId);
      setControlTimers((current) => replaceControlTimer(current, response.timer));
      showToast({
        title: t("shell.butlerControlTimerCancelSucceeded"),
        tone: "success"
      });
    } catch (error) {
      showToast({
        title: t("shell.butlerControlTimerCancelFailed"),
        description: error instanceof Error ? error.message : undefined,
        tone: "error"
      });
    } finally {
      setCancellingTimerId(null);
    }
  }, [showToast]);
  const handleCancelAutomation = useCallback(async (automationId: string) => {
    setCancellingAutomationId(automationId);

    try {
      const response = await cancelAssistantAutomation(automationId);
      setAssistantAutomations((current) =>
        replaceAssistantAutomation(current, response.payload.automation)
      );
      showToast({
        title: t("shell.butlerControlTimerCancelSucceeded"),
        tone: "success"
      });
    } catch (error) {
      showToast({
        title: t("shell.butlerControlTimerCancelFailed"),
        description: error instanceof Error ? error.message : undefined,
        tone: "error"
      });
    } finally {
      setCancellingAutomationId(null);
    }
  }, [showToast]);
  const handleExecuteControlTimerNow = useCallback(async (timer: ButlerControlTimerDto) => {
    const prompt = timer.content.trim();

    if (!prompt) {
      showToast({
        title: t("shell.butlerControlTimerExecuteNowFailed"),
        tone: "error"
      });
      return;
    }

    setExecutingTimerId(timer.id);

    try {
      const response = await cancelButlerControlTimer(timer.id);
      setControlTimers((current) => replaceControlTimer(current, response.timer));
      await store.sendMessage(prompt);
      requestNavigationRefresh();
      showToast({
        title: t("shell.butlerControlTimerExecuteNowSucceeded"),
        tone: "success"
      });
    } catch (error) {
      showToast({
        title: t("shell.butlerControlTimerExecuteNowFailed"),
        description: error instanceof Error ? error.message : undefined,
        tone: "error"
      });
    } finally {
      setExecutingTimerId(null);
    }
  }, [requestNavigationRefresh, showToast, store]);
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
    const nextSnapshot = JSON.stringify({
      workspaceId,
      activeProvider,
      controlSessionId: controlSession?.id ?? null,
      sessionId: controlSession?.session?.sessionId ?? null,
      messages: messages.length,
      historyState,
      runtimeHasActiveRun,
      runtimeCanInterrupt,
      loading,
      sending,
      switchingProvider,
      error
    });

    if (debugRenderStateRef.current === nextSnapshot) {
      return;
    }

    debugRenderStateRef.current = nextSnapshot;
    logPerfDebug("butler.page.timeline_state", {
      workspaceId,
      activeProvider,
      controlSessionId: controlSession?.id ?? null,
      sessionId: controlSession?.session?.sessionId ?? null,
      messages: messages.length,
      historyState,
      runtimeHasActiveRun,
      runtimeCanInterrupt,
      loading,
      sending,
      switchingProvider,
      error: error ?? null
    });
  }, [
    workspaceId,
    activeProvider,
    controlSession?.id,
    controlSession?.session?.sessionId,
    messages.length,
    historyState,
    runtimeHasActiveRun,
    runtimeCanInterrupt,
    loading,
    sending,
    switchingProvider,
    error
  ]);

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
      setControlSessions([]);
      setControlTimers([]);
      setAssistantAutomations([]);
      setAssistantAutomationRuns([]);
      return;
    }

    let disposed = false;

    async function loadSidebarData() {
      try {
        const [
          inboxResponse,
          followUpResponse,
          controlSessionResponse,
          controlTimerResponse,
          automationResponse,
          automationRunsResponse,
          patrolPlanResponses
        ] = await Promise.all([
          listButlerInboxItems(),
          listButlerFollowUpTasks(),
          listButlerControlSessions(),
          listButlerControlTimers(),
          listAssistantAutomations({
            limit: 100
          }),
          listRecentAssistantAutomationRuns({
            limit: 100
          }),
          Promise.all(overviewProjectIds.map((projectId) => listButlerPatrolPlans(projectId)))
        ]);

        if (!disposed) {
          setInboxItems(inboxResponse.items);
          setFollowUpTasks(followUpResponse.items);
          setControlSessions(controlSessionResponse.items);
          setControlTimers(controlTimerResponse.items);
          setAssistantAutomations(automationResponse.payload.items);
          setAssistantAutomationRuns(automationRunsResponse.payload.items);
          setPatrolPlans(patrolPlanResponses.flatMap((response) => response.items));
        }
      } catch (loadError) {
        if (disposed) {
          return;
        }

        setInboxItems([]);
        setFollowUpTasks([]);
        setPatrolPlans([]);
        setControlSessions([]);
        setControlTimers([]);
        setAssistantAutomations([]);
        setAssistantAutomationRuns([]);
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
        assistantAutomations={assistantAutomations}
        assistantAutomationRuns={assistantAutomationRuns}
        cancellingFollowUpTaskId={cancellingFollowUpTaskId}
        cancellingVerificationId={cancellingVerificationId}
        cancellingAutomationId={cancellingAutomationId}
        settingsForm={settingsForm}
        savingSettings={savingSettings}
        onOpenFollowUpHistory={handleOpenFollowUpHistory}
        onOpenVerificationHistory={handleOpenVerificationHistory}
        onOpenAutomationHistory={handleOpenAutomationHistory}
        onOpenFollowUpDetail={handleOpenFollowUpDetail}
        onCancelFollowUpTask={handleCancelFollowUpTask}
        onCancelVerificationRun={handleCancelVerificationRun}
        onCancelAutomation={handleCancelAutomation}
        onAnalyzeTodo={handleAnalyzeTodo}
        onStartTodoSession={handleStartTodoSession}
        onOpenTodoSession={handleOpenTodoSession}
        onCopyTodoPrompt={handleCopyTodoPrompt}
        todoActionState={todoActionState}
        onSettingsFormChange={handleSettingsFormChange}
        onSaveSettings={() => {
          void handleSaveSettings();
        }}
      />
    ),
    [
      events,
      handleAnalyzeTodo,
      handleCancelAutomation,
      handleCopyTodoPrompt,
      handleOpenAutomationHistory,
      handleOpenFollowUpHistory,
      handleOpenVerificationHistory,
      followUpTasks,
      handleOpenFollowUpDetail,
      handleOpenTodoSession,
      handleSaveSettings,
      handleSettingsFormChange,
      handleStartTodoSession,
      assistantAutomations,
      assistantAutomationRuns,
      inboxItems,
      cancellingAutomationId,
      cancellingFollowUpTaskId,
      cancellingVerificationId,
      overview,
      handleCancelFollowUpTask,
      handleCancelVerificationRun,
      savingSettings,
      settingsForm,
      todoActionState
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
          provider: resolveOptionLabel(providerOptions, providerId)
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
                      disabled={providerOptions.length <= 1}
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
        <header
          className="workbench-auxiliary-header butler-main-header"
          data-window-drag-handle="conversation-header"
          data-tauri-drag-region={macOsNativeTitlebarDragRegion}
        >
          <div
            className="butler-header-main"
            data-tauri-drag-region={macOsNativeTitlebarDragRegion}
          >
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
                  data-tauri-drag-region={macOsNativeTitlebarDragRegion}
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
                disabled={providerOptions.length <= 1 || switchingProvider || sending}
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
              aria-label={t("shell.butlerHistoryAction")}
              title={t("shell.butlerHistoryAction")}
              disabled={loading || sending || switchingProvider}
              onClick={() => {
                handleOpenControlHistory();
              }}
            >
              <span className="terminal-toolbar-icon" aria-hidden="true">
                <ButlerHistoryIcon />
              </span>
            </button>
          </div>
        </header>

        <section className="butler-main-column">
          <div key={`timeline:${activeProvider}:${viewKey}`} className="butler-conversation-shell">
            <MessageTimeline
              sessionId={controlSession?.session?.sessionId}
              messages={messages}
              historyState={historyState}
              loadingOlderMessages={loadingOlderMessages}
              hasOlderMessages={hasOlderMessages}
              provider={activeProvider}
              assistantAvatar={
                <span className="butler-message-avatar" aria-hidden="true">
                  {butlerAvatar}
                </span>
              }
              onLoadOlderMessages={() => {
                void store.loadOlderMessages();
              }}
              onRetryMessage={(clientRequestId) => {
                const targetMessage = messages.find(
                  (message) => message.clientRequestId === clientRequestId
                );

                if (targetMessage?.content.trim()) {
                  void store.sendMessage(targetMessage.content);
                  return;
                }

                void store.retryMessage(clientRequestId);
              }}
            />

            {activeControlTimer ? (
              <ButlerControlTimerBanner
                timer={activeControlTimer}
                currentWorkspaceId={workspaceId}
                currentWorkspaceName={currentWorkspaceName}
                projectNameById={projectNameById}
                workspaceNameById={workspaceNameById}
                sessionTitleById={sessionTitleById}
                countdownNow={countdownNow}
                cancelling={cancellingTimerId === activeControlTimer.id}
                executingNow={executingTimerId === activeControlTimer.id}
                onCancel={() => {
                  void handleCancelControlTimer(activeControlTimer.id);
                }}
                onExecuteNow={() => {
                  void handleExecuteControlTimerNow(activeControlTimer);
                }}
              />
            ) : null}

            <div className="butler-composer-shell">
              <ComposerPanel
              capabilities={capabilities}
              draftStorageId={`butler:${activeProvider}:${viewKey}`}
              placeholder={t("shell.butlerComposerPlaceholder", {
                displayName: butlerDisplayName
              })}
              hasActiveRun={runtimeHasActiveRun}
              canInterrupt={runtimeCanInterrupt}
              contextUsage={contextUsage}
              isSubmitting={sending || switchingProvider}
              isRunning={runtimeHasActiveRun ?? false}
              onInterrupt={async () => {
                await store.interrupt();
                requestNavigationRefresh();
              }}
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
          tasks={followUpTasks.filter((task) => !isVisibleFollowUpTask(task.status))}
          cancellingTaskId={cancellingFollowUpTaskId}
          onOpenFollowUpDetail={handleOpenFollowUpDetail}
          onCancelFollowUpTask={handleCancelFollowUpTask}
          onClose={() => {
            setFollowUpHistoryOpen(false);
          }}
        />
      </WorkbenchModal>
      <WorkbenchModal
        open={verificationHistoryOpen}
        title={t("shell.butlerVerificationHistoryTitle")}
        description={t("shell.butlerVerificationHistoryDescription")}
        onClose={() => {
          setVerificationHistoryOpen(false);
        }}
      >
        <VerificationHistoryPanel
          items={buildVerificationRecords(overview?.verifications ?? [], "history")}
          cancellingVerificationId={cancellingVerificationId}
          onCancelVerificationRun={handleCancelVerificationRun}
        />
      </WorkbenchModal>
      <WorkbenchModal
        open={automationHistoryOpen}
        title={t("shell.butlerAutomationHistoryTitle")}
        description={t("shell.butlerAutomationHistoryDescription")}
        onClose={() => {
          setAutomationHistoryOpen(false);
        }}
      >
        <AutomationHistoryPanel
          taskItems={buildAutomationTaskItems(assistantAutomations, overview, "history")}
          runItems={buildAutomationRunItems(assistantAutomations, assistantAutomationRuns, overview, "history")}
        />
      </WorkbenchModal>
      <WorkbenchModal
        open={controlHistoryOpen}
        title={t("shell.butlerHistoryTitle")}
        description={t("shell.butlerHistoryDescription")}
        onClose={() => {
          setControlHistoryOpen(false);
        }}
      >
        <ButlerControlHistoryPanel
          sessions={controlSessions}
          activeControlSessionId={controlSession?.id ?? null}
          onSelectSession={async (targetSession) => {
            await store.openControlSession(targetSession.id);
            setControlHistoryOpen(false);
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
  assistantAutomations: AssistantAutomationTaskDto[];
  assistantAutomationRuns: AssistantAutomationRunDto[];
  cancellingFollowUpTaskId: string | null;
  cancellingVerificationId: string | null;
  cancellingAutomationId: string | null;
  settingsForm: ButlerSettingsFormState;
  savingSettings: boolean;
  onOpenFollowUpHistory: () => void;
  onOpenVerificationHistory: () => void;
  onOpenAutomationHistory: () => void;
  onOpenFollowUpDetail: (taskId: string) => Promise<void>;
  onCancelFollowUpTask: (task: ButlerFollowUpTaskDto) => Promise<void>;
  onCancelVerificationRun: (verification: ButlerVerificationDigestDto) => Promise<void>;
  onCancelAutomation: (automationId: string) => Promise<void>;
  onAnalyzeTodo: (item: ButlerInboxItemDto) => Promise<void>;
  onStartTodoSession: (item: ButlerInboxItemDto) => Promise<void>;
  onOpenTodoSession: (item: ButlerInboxItemDto) => void;
  onCopyTodoPrompt: (item: ButlerInboxItemDto) => Promise<void>;
  todoActionState: {
    itemId: string | null;
    kind: "analyze" | "start" | null;
  };
  onSettingsFormChange: (patch: Partial<ButlerSettingsFormState>) => void;
  onSaveSettings: () => void;
}) {
  const [activeTab, setActiveTab] = useState<"info" | "automation" | "settings">("info");
  const tabs = [
    { id: "info", label: t("shell.butlerSidebarInfoTab") },
    { id: "automation", label: t("shell.butlerSidebarAutomationTab") },
    { id: "settings", label: t("shell.butlerSidebarSettingsTab") }
  ] as const;
  const sidebarContent =
    activeTab === "info" ? (
      <GlobalRecordsSidebarContent
        overview={props.overview}
        inboxItems={props.inboxItems}
        followUpTasks={props.followUpTasks}
        cancellingFollowUpTaskId={props.cancellingFollowUpTaskId}
        cancellingVerificationId={props.cancellingVerificationId}
        onOpenFollowUpHistory={props.onOpenFollowUpHistory}
        onOpenVerificationHistory={props.onOpenVerificationHistory}
        onOpenFollowUpDetail={props.onOpenFollowUpDetail}
        onCancelFollowUpTask={props.onCancelFollowUpTask}
        onCancelVerificationRun={props.onCancelVerificationRun}
        onAnalyzeTodo={props.onAnalyzeTodo}
        onStartTodoSession={props.onStartTodoSession}
        onOpenTodoSession={props.onOpenTodoSession}
        onCopyTodoPrompt={props.onCopyTodoPrompt}
        todoActionState={props.todoActionState}
      />
    ) : activeTab === "automation" ? (
      <AutomationSidebarContent
        overview={props.overview}
        automations={props.assistantAutomations}
        runs={props.assistantAutomationRuns}
        cancellingAutomationId={props.cancellingAutomationId}
        onOpenAutomationHistory={props.onOpenAutomationHistory}
        onCancelAutomation={props.onCancelAutomation}
      />
    ) : (
      <SettingsSidebarContent
        settingsForm={props.settingsForm}
        savingSettings={props.savingSettings}
        onSettingsFormChange={props.onSettingsFormChange}
        onSaveSettings={props.onSaveSettings}
      />
    );

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
      <div className="butler-side-content">
        {sidebarContent}
      </div>
    </div>
  );
}

function GlobalRecordsSidebarContent(props: {
  overview: ButlerOverviewDto | null;
  inboxItems: ButlerInboxItemDto[];
  followUpTasks: ButlerFollowUpTaskDto[];
  cancellingFollowUpTaskId: string | null;
  cancellingVerificationId: string | null;
  onOpenFollowUpHistory: () => void;
  onOpenVerificationHistory: () => void;
  onOpenFollowUpDetail: (taskId: string) => Promise<void>;
  onCancelFollowUpTask: (task: ButlerFollowUpTaskDto) => Promise<void>;
  onCancelVerificationRun: (verification: ButlerVerificationDigestDto) => Promise<void>;
  onAnalyzeTodo: (item: ButlerInboxItemDto) => Promise<void>;
  onStartTodoSession: (item: ButlerInboxItemDto) => Promise<void>;
  onOpenTodoSession: (item: ButlerInboxItemDto) => void;
  onCopyTodoPrompt: (item: ButlerInboxItemDto) => Promise<void>;
  todoActionState: {
    itemId: string | null;
    kind: "analyze" | "start" | null;
  };
}) {
  const activeFollowUpTasks = useMemo(
    () => props.followUpTasks.filter((task) => isVisibleFollowUpTask(task.status)),
    [props.followUpTasks]
  );
  const verificationRecords = useMemo(
    () => buildVerificationRecords(props.overview?.verifications ?? [], "active"),
    [props.overview?.verifications]
  );
  const todoRecords = useMemo(
    () => props.inboxItems.filter((item) => item.status !== "closed"),
    [props.inboxItems]
  );

  return (
    <>
      <FollowUpStatusCard
        tasks={activeFollowUpTasks}
        cancellingTaskId={props.cancellingFollowUpTaskId}
        onOpenFollowUpHistory={props.onOpenFollowUpHistory}
        onOpenFollowUpDetail={props.onOpenFollowUpDetail}
        onCancelFollowUpTask={props.onCancelFollowUpTask}
      />
      <GlobalRecordCard
        title={t("shell.butlerInfoVerificationRecordsTitle")}
        items={verificationRecords}
        emptyText={t("shell.butlerInfoVerificationRecordsEmpty")}
        actionLabel={t("shell.butlerFollowUpHistoryAction")}
        onAction={props.onOpenVerificationHistory}
        cancellingVerificationId={props.cancellingVerificationId}
        onCancelVerificationRun={props.onCancelVerificationRun}
      />
      <TodoLifecycleCard
        title={t("shell.butlerInfoTodoRecordsTitle")}
        items={todoRecords}
        emptyText={t("shell.butlerInfoTodoRecordsEmpty")}
        todoActionState={props.todoActionState}
        onAnalyzeTodo={props.onAnalyzeTodo}
        onStartTodoSession={props.onStartTodoSession}
        onOpenTodoSession={props.onOpenTodoSession}
        onCopyTodoPrompt={props.onCopyTodoPrompt}
      />
    </>
  );
}

function AutomationSidebarContent(props: {
  overview: ButlerOverviewDto | null;
  automations: AssistantAutomationTaskDto[];
  runs: AssistantAutomationRunDto[];
  cancellingAutomationId: string | null;
  onOpenAutomationHistory: () => void;
  onCancelAutomation: (automationId: string) => Promise<void>;
}) {
  const automationTasks = useMemo(
    () => buildAutomationTaskItems(props.automations, props.overview, "active"),
    [props.automations, props.overview]
  );
  const automationRuns = useMemo(
    () => buildAutomationRunItems(props.automations, props.runs, props.overview, "active"),
    [props.automations, props.overview, props.runs]
  );

  return (
    <>
      <AutomationTaskOverviewCard
        items={automationTasks}
        cancellingAutomationId={props.cancellingAutomationId}
        onCancelAutomation={props.onCancelAutomation}
        emptyText={t("shell.butlerAutomationTasksEmpty")}
        actionLabel={t("shell.butlerFollowUpHistoryAction")}
        onAction={props.onOpenAutomationHistory}
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
    id: string;
    title: string;
    subtitle?: string | null;
    status?: string | null;
    content: string;
    meta?: string | null;
    verification?: ButlerVerificationDigestDto;
  }>;
  emptyText: string;
  actionLabel?: string;
  onAction?: () => void;
  cancellingVerificationId?: string | null;
  onCancelVerificationRun?: (verification: ButlerVerificationDigestDto) => Promise<void>;
}) {
  return (
    <section className="butler-side-card">
      <header>
        <h2>{props.title}</h2>
        {props.actionLabel && props.onAction ? (
          <button
            type="button"
            className="secondary-button butler-side-header-action"
            onClick={props.onAction}
          >
            {props.actionLabel}
          </button>
        ) : null}
      </header>
      {props.items.length > 0 ? (
        <div className="butler-record-list">
          {props.items.map((item) => (
            <article key={item.id} className="butler-follow-up-status-card">
              <header className="butler-follow-up-status-header">
                <div className="butler-follow-up-status-title-group">
                  <strong>{item.title}</strong>
                  {item.subtitle ? <span>{item.subtitle}</span> : null}
                </div>
                {item.status ? (
                  <span
                    className="butler-automation-status-badge"
                    data-status={item.verification ? resolveVerificationBadgeStatus(item.verification.status) : "active"}
                  >
                    {item.status}
                  </span>
                ) : null}
              </header>
              <div className="butler-follow-up-status-body">
                <p>{item.content}</p>
              </div>
              {item.meta || (props.onCancelVerificationRun && item.verification) ? (
                <footer className="butler-follow-up-status-footer">
                  <span>{item.meta ?? ""}</span>
                  {item.verification && props.onCancelVerificationRun ? (
                    <button
                      type="button"
                      className="secondary-button butler-follow-up-status-action"
                      disabled={
                        props.cancellingVerificationId === item.verification.id
                        || !isCancelableVerification(item.verification)
                      }
                      onClick={() => {
                        if (!item.verification) {
                          return;
                        }
                        void props.onCancelVerificationRun?.(item.verification);
                      }}
                    >
                      {props.cancellingVerificationId === item.verification.id
                        ? t("conversation.butlerVerificationStopping")
                        : t("conversation.butlerStopVerificationAction")}
                    </button>
                  ) : null}
                </footer>
              ) : null}
            </article>
          ))}
        </div>
      ) : (
        <p className="butler-secondary-text">{props.emptyText}</p>
      )}
    </section>
  );
}

function TodoLifecycleCard(props: {
  title: string;
  items: ButlerInboxItemDto[];
  emptyText: string;
  todoActionState: {
    itemId: string | null;
    kind: "analyze" | "start" | null;
  };
  onAnalyzeTodo: (item: ButlerInboxItemDto) => Promise<void>;
  onStartTodoSession: (item: ButlerInboxItemDto) => Promise<void>;
  onOpenTodoSession: (item: ButlerInboxItemDto) => void;
  onCopyTodoPrompt: (item: ButlerInboxItemDto) => Promise<void>;
}) {
  return (
    <section className="butler-side-card">
      <header>
        <h2>{props.title}</h2>
      </header>
      {props.items.length > 0 ? (
        <div className="butler-record-list">
          {props.items.map((item) => {
            const running = props.todoActionState.itemId === item.id ? props.todoActionState.kind : null;
            const hasPrompt = Boolean(item.assistantState.generatedPrompt?.trim());
            const hasSession = Boolean(item.assistantState.linkedSessionId?.trim());
            const isAnalyzing = item.assistantState.lifecycleStage === "analyzing";
            const canCreateSession = hasSession || (hasPrompt && !isAnalyzing && item.status !== "closed");

            return (
              <article key={item.id} className="butler-todo-card">
                <header className="butler-todo-card-header">
                  <div>
                    <strong>{item.title}</strong>
                    <span>{item.projectName}</span>
                  </div>
                  <div className="butler-todo-card-badges">
                    <span className="butler-inline-badge">{resolveTodoStatusLabel(item.status)}</span>
                    <span className="butler-inline-badge">{resolveInboxLifecycleStageLabel(item.assistantState.lifecycleStage)}</span>
                  </div>
                </header>
                <p>{item.content}</p>
                <p className="butler-secondary-text">
                  {item.assistantState.lastError
                    || item.assistantState.analysisSummary
                    || t("shell.butlerTodoLifecycleEmpty")}
                </p>
                {hasPrompt ? (
                  <div className="butler-todo-prompt-preview">
                    <details className="butler-todo-prompt-preview-details">
                      <summary>{t("shell.butlerTodoPromptPreviewAction")}</summary>
                      <pre>{item.assistantState.generatedPrompt}</pre>
                    </details>
                  </div>
                ) : null}
                <div className="butler-todo-card-actions">
                  <button
                    type="button"
                    className="secondary-button"
                    disabled={running !== null || item.status === "closed" || isAnalyzing}
                    onClick={() => {
                      void props.onAnalyzeTodo(item);
                    }}
                  >
                    {running === "analyze"
                      ? t("shell.butlerTodoAnalyzeRunning")
                      : isAnalyzing
                        ? t("shell.butlerTodoAnalyzeRunning")
                        : hasPrompt
                          ? t("shell.butlerTodoReanalyzeAction")
                        : t("shell.butlerTodoAnalyzeAction")}
                  </button>
                  <button
                    type="button"
                    className="secondary-button"
                    disabled={running !== null || !canCreateSession}
                    onClick={() => {
                      if (hasSession) {
                        props.onOpenTodoSession(item);
                        return;
                      }

                      void props.onStartTodoSession(item);
                    }}
                  >
                    {running === "start"
                      ? t("shell.butlerTodoStartSessionRunning")
                      : hasSession
                        ? t("shell.butlerTodoOpenSessionAction")
                        : isAnalyzing
                          ? t("shell.butlerTodoWaitForPromptAction")
                          : !hasPrompt
                            ? t("shell.butlerTodoAnalyzeFirstAction")
                            : t("shell.butlerTodoStartSessionAction")}
                  </button>
                  <button
                    type="button"
                    className="secondary-button"
                    disabled={!hasPrompt}
                    onClick={() => {
                      void props.onCopyTodoPrompt(item);
                    }}
                  >
                    {t("shell.butlerTodoCopyPromptAction")}
                  </button>
                </div>
              </article>
            );
          })}
        </div>
      ) : (
        <p className="butler-secondary-text">{props.emptyText}</p>
      )}
    </section>
  );
}

function ButlerControlHistoryPanel(props: {
  sessions: ButlerControlSessionDto[];
  activeControlSessionId: string | null;
  onSelectSession: (session: ButlerControlSessionDto) => Promise<void>;
}) {
  if (props.sessions.length === 0) {
    return <p className="butler-secondary-text">{t("shell.butlerHistoryEmpty")}</p>;
  }

  return (
    <div className="butler-record-list">
      {props.sessions.map((session) => {
        const selected = session.id === props.activeControlSessionId;
        const title = session.title?.trim() || session.session.title?.trim() || session.lastSummary?.trim() || session.sessionId;

        return (
          <article key={session.id} className="butler-todo-card">
            <header className="butler-todo-card-header">
              <div>
                <strong>{title}</strong>
                <span>{formatTimestamp(session.updatedAt)}</span>
              </div>
              <div className="butler-todo-card-badges">
                <span className="butler-inline-badge">
                  {session.purpose === "todo_analysis"
                    ? t("shell.butlerControlSessionKindTodoAnalysis")
                    : t("shell.butlerControlSessionKindChat")}
                </span>
                <span className="butler-inline-badge">{resolveControlSessionStatusLabel(session.status)}</span>
                {selected ? (
                  <span className="butler-inline-badge">{t("shell.butlerCurrentSessionBadge")}</span>
                ) : null}
              </div>
            </header>
            <p className="butler-secondary-text">
              {session.lastSummary?.trim() || session.session.title?.trim() || session.sessionId}
            </p>
            <div className="butler-todo-card-actions">
              <button
                type="button"
                className="secondary-button"
                disabled={selected}
                onClick={() => {
                  void props.onSelectSession(session);
                }}
              >
                {selected ? t("shell.butlerCurrentSessionBadge") : t("shell.butlerHistoryOpenAction")}
              </button>
            </div>
          </article>
        );
      })}
    </div>
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
  cancellingTaskId: string | null;
  onOpenFollowUpHistory: () => void;
  onOpenFollowUpDetail: (taskId: string) => Promise<void>;
  onCancelFollowUpTask: (task: ButlerFollowUpTaskDto) => Promise<void>;
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
              cancelling={props.cancellingTaskId === task.id}
              onOpenFollowUpDetail={props.onOpenFollowUpDetail}
              onCancelFollowUpTask={props.onCancelFollowUpTask}
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
  cancellingTaskId?: string | null;
  onCancelFollowUpTask?: (task: ButlerFollowUpTaskDto) => Promise<void>;
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
              cancelling={props.cancellingTaskId === task.id}
              onOpenFollowUpDetail={async (taskId) => {
                props.onClose();
                await props.onOpenFollowUpDetail(taskId);
              }}
              onCancelFollowUpTask={props.onCancelFollowUpTask}
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
  cancelling?: boolean;
  onOpenFollowUpDetail: (taskId: string) => Promise<void>;
  onCancelFollowUpTask?: (task: ButlerFollowUpTaskDto) => Promise<void>;
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
        <div className="butler-inline-actions">
          {props.onCancelFollowUpTask && isCancelableFollowUpTask(task) ? (
            <button
              type="button"
              className="secondary-button butler-follow-up-status-action"
              disabled={props.cancelling}
              onClick={() => {
                void props.onCancelFollowUpTask!(task);
              }}
            >
              {props.cancelling
                ? t("conversation.butlerFollowUpStopping")
                : t("conversation.butlerStopFollowUpAction")}
            </button>
          ) : null}
          <button
            type="button"
            className="secondary-button butler-follow-up-status-action"
            onClick={() => {
              void props.onOpenFollowUpDetail(task.id);
            }}
          >
            {t("shell.butlerAutomationViewRoundsAction")}
          </button>
        </div>
      </footer>
    </article>
  );
}

function ButlerControlTimerBanner(props: {
  timer: ButlerControlTimerDto;
  currentWorkspaceId: string;
  currentWorkspaceName: string | null;
  projectNameById: Map<string, string>;
  workspaceNameById: Map<string, string>;
  sessionTitleById: Map<string, string>;
  countdownNow: number;
  cancelling: boolean;
  executingNow: boolean;
  onCancel: () => void;
  onExecuteNow: () => void;
}) {
  const detailButtonId = useId();
  const detailPopoverId = useId();
  const detailRef = useRef<HTMLDivElement | null>(null);
  const detailPopoverRef = useRef<HTMLDivElement | null>(null);
  const [detailOpen, setDetailOpen] = useState(false);
  const countdownText = resolveControlTimerCountdownLabel(props.timer, props.countdownNow);
  const countdownClockText = resolveControlTimerClockLabel(props.timer, props.countdownNow);
  const workspaceText = resolveControlTimerWorkspaceLabel(
    props.timer,
    props.projectNameById,
    props.workspaceNameById,
    props.currentWorkspaceId,
    props.currentWorkspaceName
  );
  const sessionText = resolveControlTimerSessionLabel(props.timer, props.sessionTitleById);
  const promptContent = resolveControlTimerPromptContent(props.timer);

  useEffect(() => {
    if (!detailOpen) {
      return;
    }

    const handlePointerDown = (event: PointerEvent) => {
      if (
        detailRef.current?.contains(event.target as Node)
        || detailPopoverRef.current?.contains(event.target as Node)
      ) {
        return;
      }

      setDetailOpen(false);
    };
    const handleKeyDown = (event: KeyboardEvent) => {
      if (event.key === "Escape") {
        setDetailOpen(false);
      }
    };

    document.addEventListener("pointerdown", handlePointerDown);
    document.addEventListener("keydown", handleKeyDown);

    return () => {
      document.removeEventListener("pointerdown", handlePointerDown);
      document.removeEventListener("keydown", handleKeyDown);
    };
  }, [detailOpen]);

  return (
    <section className="butler-control-timer-banner" aria-live="polite">
      <div className="butler-control-timer-banner-shell">
        <div className="butler-control-timer-banner-copy">
          <div className="butler-control-timer-banner-status">
            <span className="butler-control-timer-pulse" aria-hidden="true" />
            <span className="butler-control-timer-banner-caption">
              {t("shell.butlerControlTimerBannerTitle")}
            </span>
          </div>
          <div className="butler-control-timer-display-panel">
            <p className="butler-control-timer-display-clock">{countdownClockText}</p>
            <p className="butler-control-timer-banner-countdown">{countdownText}</p>
          </div>
          <div className="butler-control-timer-banner-meta">
            <div className="butler-control-timer-banner-meta-card">
              <span>{t("shell.butlerControlTimerWorkspaceLabel")}</span>
              <strong title={workspaceText}>{workspaceText}</strong>
            </div>
            <div className="butler-control-timer-banner-meta-card">
              <span>{t("shell.butlerControlTimerSessionLabel")}</span>
              <strong title={sessionText}>{sessionText}</strong>
            </div>
          </div>
        </div>
        <div className="butler-control-timer-banner-actions">
          <div className="butler-control-timer-banner-detail" ref={detailRef}>
            <button
              id={detailButtonId}
              type="button"
              className="butler-control-timer-banner-detail-button"
              aria-label={t("shell.butlerControlTimerDetailAction")}
              aria-haspopup="dialog"
              aria-expanded={detailOpen}
              aria-controls={detailOpen ? detailPopoverId : undefined}
              title={t("shell.butlerControlTimerDetailAction")}
              onClick={() => {
                setDetailOpen((current) => !current);
              }}
            >
              <span className="butler-control-timer-banner-detail-icon" aria-hidden="true">
                <TimerDetailIcon />
              </span>
            </button>
            <ButlerAnchoredPopover
              open={detailOpen}
              id={detailPopoverId}
              className="butler-control-timer-banner-detail-popover"
              anchorRef={detailRef}
              popoverRef={detailPopoverRef}
              labelledBy={detailButtonId}
            >
              <div>
                <strong>{t("shell.butlerControlTimerPromptTitle")}</strong>
                <p>{promptContent}</p>
              </div>
            </ButlerAnchoredPopover>
          </div>
          <button
            type="button"
            className="secondary-button butler-control-timer-banner-action"
            disabled={props.cancelling || props.executingNow}
            onClick={props.onExecuteNow}
          >
            {props.executingNow
              ? t("shell.butlerControlTimerExecutingNow")
              : t("shell.butlerControlTimerExecuteNowAction")}
          </button>
          <button
            type="button"
            className="secondary-button butler-control-timer-banner-action"
            disabled={props.cancelling || props.executingNow}
            onClick={props.onCancel}
          >
            {props.cancelling
              ? t("shell.butlerControlTimerCancelling")
              : t("shell.butlerControlTimerStopAction")}
          </button>
        </div>
        <p className="butler-control-timer-banner-note">
          {t("shell.butlerControlTimerActionNote")}
        </p>
      </div>
    </section>
  );
}

interface AutomationTaskItem {
  id: string;
  automationId?: string;
  kind: "assistant_automation";
  title: string;
  projectName: string;
  status: "active" | "waiting_user" | "completed" | "failed" | "cancelled";
  taskTypeLabel: string;
  statusLabel: string;
  nextRunAt: string | null;
  lastRunAt: string | null;
}

interface AutomationRunItem {
  id: string;
  kind: "assistant_automation_run";
  title: string;
  projectName: string;
  status: "active" | "waiting_user" | "completed" | "failed" | "cancelled";
  sourceLabel: string;
  statusLabel: string;
  summary: string;
  createdAt: string;
}

function AutomationTaskOverviewCard(props: {
  items: AutomationTaskItem[];
  cancellingAutomationId: string | null;
  onCancelAutomation: (automationId: string) => Promise<void>;
  emptyText: string;
  actionLabel?: string;
  onAction?: () => void;
}) {
  return (
    <section className="butler-side-card">
      <header>
        <h2>{t("shell.butlerAutomationTasksTitle")}</h2>
        {props.actionLabel && props.onAction ? (
          <button
            type="button"
            className="secondary-button butler-side-header-action"
            onClick={props.onAction}
          >
            {props.actionLabel}
          </button>
        ) : null}
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
                <span className="butler-automation-status-badge" data-status={item.status}>
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
                <div className="butler-automation-card-footer-copy">
                  <span>{t("shell.butlerAutomationTaskNextRunLabel")}</span>
                  <strong>{formatIsoDateTime(item.nextRunAt)}</strong>
                </div>
                {item.automationId && item.status === "active" ? (
                  <button
                    type="button"
                    className="secondary-button butler-automation-card-action"
                    disabled={props.cancellingAutomationId === item.automationId}
                    onClick={() => {
                      void props.onCancelAutomation(item.automationId!);
                    }}
                  >
                    {props.cancellingAutomationId === item.automationId
                      ? t("shell.butlerControlTimerCancelling")
                      : t("shell.butlerControlTimerStopAction")}
                  </button>
                ) : null}
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
                <span className="butler-automation-status-badge" data-status={item.status}>
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
  controlTimers: ButlerControlTimerDto[],
  overview: ButlerOverviewDto | null,
  mode: "active" | "history" = "active"
): AutomationTaskItem[] {
  const projectNameById = new Map(
    (overview?.projects ?? []).map((project) => [project.id, project.name] as const)
  );
  const planItems = patrolPlans
    .filter((plan) => (mode === "history" ? !plan.enabled : plan.enabled))
    .map<AutomationTaskItem>((plan) => ({
      id: `patrol-plan:${plan.id}`,
      kind: "patrol_plan",
      title: plan.name,
      projectName: projectNameById.get(plan.projectId) ?? plan.projectId,
      status: plan.enabled ? "active" : "cancelled",
      taskTypeLabel: resolveAutomationTaskTypeLabel("patrol_plan", plan.triggerType),
      statusLabel: plan.enabled ? t("shell.butlerAutomationTaskEnabled") : t("shell.butlerAutomationTaskDisabled"),
      nextRunAt: plan.nextRunAt,
      lastRunAt: plan.lastScheduledAt
    }));
  const followUpItems = followUpTasks
    .filter((task) => (
      mode === "history" ? !isVisibleFollowUpTask(task.status) : isVisibleFollowUpTask(task.status)
    ))
    .map<AutomationTaskItem>((task) => ({
      id: `follow-up:${task.id}`,
      kind: "follow_up",
      title: task.sessionTitle?.trim() || task.projectName,
      projectName: task.projectName,
      status: task.status,
      taskTypeLabel: resolveAutomationTaskTypeLabel("follow_up"),
      statusLabel: resolveFollowUpTaskStatusLabel(task.status),
      nextRunAt: task.nextCheckAt,
      lastRunAt: task.lastAutomationAt || task.lastCheckedAt || task.updatedAt
    }));
  const timerItems = controlTimers
    .filter((timer) => (mode === "history" ? timer.status !== "active" : timer.status === "active"))
    .map<AutomationTaskItem>((timer) => ({
      id: `control-timer:${timer.id}`,
      timerId: timer.id,
      kind: "control_timer",
      title: resolveControlTimerTitle(timer),
      projectName: resolveControlTimerProjectName(timer, projectNameById),
      status: timer.status,
      taskTypeLabel: resolveAutomationTaskTypeLabel("control_timer"),
      statusLabel: resolveControlTimerStatusLabel(timer.status),
      nextRunAt: timer.dueAt,
      lastRunAt: timer.updatedAt
    }));

  return [...timerItems, ...planItems, ...followUpItems]
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
  controlTimers: ButlerControlTimerDto[],
  overview: ButlerOverviewDto | null,
  mode: "active" | "history" = "active"
): AutomationRunItem[] {
  const isActiveRunStatus = (status: AutomationRunItem["status"]): boolean =>
    status === "active" || status === "waiting_user";
  const projectNameById = new Map(
    (overview?.projects ?? []).map((project) => [project.id, project.name] as const)
  );
  const patrolRunItems = (overview?.patrols ?? [])
    .map((run) => ({
      run,
      normalizedStatus: normalizeAutomationRunStatus(run.status)
    }))
    .filter(({ normalizedStatus }) => (
      mode === "history"
        ? !isActiveRunStatus(normalizedStatus)
        : isActiveRunStatus(normalizedStatus)
    ))
    .map<AutomationRunItem>(({ run, normalizedStatus }) => ({
      id: `patrol-run:${run.id}`,
      kind: "patrol_run",
      title: t("shell.butlerAutomationPatrolRunTitle"),
      projectName: projectNameById.get(run.projectId) ?? run.projectId,
      status: normalizedStatus,
      sourceLabel: resolveAutomationRunSourceLabel("patrol_run"),
      statusLabel: run.status,
      summary: run.summary?.trim() || t("shell.butlerAutomationRunEmptySummary"),
      createdAt: run.finishedAt || run.startedAt || run.createdAt
    }));
  const followUpRunItems = followUpTasks.flatMap<AutomationRunItem>((task) =>
    (task.rounds ?? [])
      .filter((round) => (
        mode === "history"
          ? !isActiveRunStatus(round.status)
          : isActiveRunStatus(round.status)
      ))
      .map((round) => ({
        id: `follow-up-round:${task.id}:${round.roundNumber}`,
        kind: "follow_up_round",
        title: `${task.sessionTitle?.trim() || task.projectName} · ${t("shell.butlerAutomationRoundLabel", { round: round.roundNumber })}`,
        projectName: task.projectName,
        status: round.status,
        sourceLabel: resolveAutomationRunSourceLabel("follow_up_round"),
        statusLabel: resolveFollowUpTaskStatusLabel(round.status),
        summary: round.summary?.trim() || t("shell.butlerAutomationRunEmptySummary"),
        createdAt: round.createdAt
      }))
  );
  const timerRunItems = controlTimers
    .filter((timer) => (mode === "history" ? timer.status !== "active" : false))
    .map<AutomationRunItem>((timer) => ({
      id: `control-timer:${timer.id}`,
      kind: "control_timer",
      title: resolveControlTimerTitle(timer),
      projectName: resolveControlTimerProjectName(timer, projectNameById),
      status: timer.status,
      sourceLabel: resolveAutomationRunSourceLabel("control_timer"),
      statusLabel: resolveControlTimerStatusLabel(timer.status),
      summary: resolveControlTimerRunSummary(timer),
      createdAt: timer.triggeredAt || timer.cancelledAt || timer.updatedAt
    }));

  return [...timerRunItems, ...patrolRunItems, ...followUpRunItems]
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

function VerificationHistoryPanel(props: {
  items: ReturnType<typeof buildVerificationRecords>;
  cancellingVerificationId?: string | null;
  onCancelVerificationRun?: (verification: ButlerVerificationDigestDto) => Promise<void>;
}) {
  if (props.items.length === 0) {
    return <p className="butler-secondary-text">{t("shell.butlerVerificationHistoryEmpty")}</p>;
  }

  return (
    <GlobalRecordCard
      title={t("shell.butlerInfoVerificationRecordsTitle")}
      items={props.items}
      emptyText={t("shell.butlerVerificationHistoryEmpty")}
      cancellingVerificationId={props.cancellingVerificationId}
      onCancelVerificationRun={props.onCancelVerificationRun}
    />
  );
}

function AutomationHistoryPanel(props: {
  taskItems: AutomationTaskItem[];
  runItems: AutomationRunItem[];
}) {
  if (props.taskItems.length === 0 && props.runItems.length === 0) {
    return <p className="butler-secondary-text">{t("shell.butlerAutomationHistoryEmpty")}</p>;
  }

  return (
    <div className="butler-record-list">
      {props.taskItems.map((item) => (
        <article key={item.id} className="butler-automation-card">
          <header className="butler-automation-card-header">
            <div className="butler-automation-card-title-group">
              <strong>{item.title}</strong>
              <span>{item.projectName}</span>
            </div>
            <span className="butler-automation-status-badge" data-status={item.status}>
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
      {props.runItems.map((item) => (
        <article key={item.id} className="butler-automation-card">
          <header className="butler-automation-card-header">
            <div className="butler-automation-card-title-group">
              <strong>{item.title}</strong>
              <span>{item.projectName}</span>
            </div>
            <span className="butler-automation-status-badge" data-status={item.status}>
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
  );
}

function buildVerificationRecords(
  verifications: ButlerVerificationDigestDto[],
  mode: "active" | "history"
): Array<{
  id: string;
  title: string;
  subtitle: string | null;
  status: string | null;
  content: string;
  meta: string | null;
  verification: ButlerVerificationDigestDto;
}> {
  return [...verifications]
    .filter((verification) => (
      mode === "history"
        ? !isVisibleVerification(verification.status)
        : isVisibleVerification(verification.status)
    ))
    .sort((left, right) => parseIsoTime(resolveVerificationTime(right)) - parseIsoTime(resolveVerificationTime(left)))
    .slice(0, 5)
    .map((verification) => ({
      id: verification.id,
      title: verification.targetRef?.trim() || verification.verificationType,
      subtitle: verification.verificationType,
      status: resolveVerificationStatusLabel(verification.status),
      content:
        verification.summary?.trim()
        || t("shell.butlerInfoVerificationFallback", {
          status: verification.status
        }),
      meta: formatIsoDateTime(resolveVerificationTime(verification)),
      verification
    }));
}

function replaceInboxItem(items: ButlerInboxItemDto[], nextItem: ButlerInboxItemDto): ButlerInboxItemDto[] {
  const nextItems = items.filter((item) => item.id !== nextItem.id);
  return [nextItem, ...nextItems].sort((left, right) => parseIsoTime(right.updatedAt) - parseIsoTime(left.updatedAt));
}

function replaceFollowUpTask(
  tasks: ButlerFollowUpTaskDto[],
  nextTask: ButlerFollowUpTaskDto
): ButlerFollowUpTaskDto[] {
  const nextTasks = tasks.filter((task) => task.id !== nextTask.id);
  return [nextTask, ...nextTasks]
    .sort((left, right) => parseIsoTime(resolveFollowUpTaskUpdatedAt(right)) - parseIsoTime(resolveFollowUpTaskUpdatedAt(left)));
}

function replaceControlSession(
  sessions: ButlerControlSessionDto[],
  nextSession: ButlerControlSessionDto
): ButlerControlSessionDto[] {
  const nextSessions = sessions.filter((session) => session.id !== nextSession.id);
  return [nextSession, ...nextSessions]
    .sort((left, right) => parseIsoTime(right.updatedAt) - parseIsoTime(left.updatedAt));
}

function replaceControlTimer(
  timers: ButlerControlTimerDto[],
  nextTimer: ButlerControlTimerDto
): ButlerControlTimerDto[] {
  const nextTimers = timers.filter((timer) => timer.id !== nextTimer.id);
  return [nextTimer, ...nextTimers]
    .sort((left, right) => parseIsoTime(resolveControlTimerSortTime(right)) - parseIsoTime(resolveControlTimerSortTime(left)));
}

function isVisibleFollowUpTask(status: ButlerFollowUpTaskDto["status"]): boolean {
  return status === "active" || status === "waiting_user";
}

function resolveControlTimerSortTime(timer: ButlerControlTimerDto): string {
  return timer.dueAt || timer.triggeredAt || timer.cancelledAt || timer.updatedAt || timer.createdAt;
}

function resolveControlTimerTitle(timer: ButlerControlTimerDto): string {
  return timer.title?.trim()
    || timer.controlSession?.title?.trim()
    || timer.controlSession?.session?.title?.trim()
    || timer.content.trim();
}

function resolveControlTimerPromptContent(timer: ButlerControlTimerDto): string {
  return timer.content.trim() || resolveControlTimerTitle(timer);
}

function resolveControlTimerProjectName(
  timer: ButlerControlTimerDto,
  projectNameById: Map<string, string>
): string {
  if (timer.projectId && projectNameById.has(timer.projectId)) {
    return projectNameById.get(timer.projectId)!;
  }

  return timer.controlSession?.session?.workspaceId || t("shell.butlerControlTimerNoProject");
}

function resolveControlTimerStatusLabel(status: ButlerControlTimerDto["status"]): string {
  switch (status) {
    case "completed":
      return t("shell.butlerAutomationStatusCompleted");
    case "failed":
      return t("shell.butlerAutomationStatusFailed");
    case "cancelled":
      return t("shell.butlerAutomationStatusCancelled");
    case "active":
    default:
      return t("shell.butlerAutomationStatusActive");
  }
}

function resolveControlTimerRunSummary(timer: ButlerControlTimerDto): string {
  if (timer.status === "completed") {
    return t("shell.butlerControlTimerRunCompletedSummary");
  }

  if (timer.status === "cancelled") {
    return t("shell.butlerControlTimerRunCancelledSummary");
  }

  return timer.lastError?.trim() || t("shell.butlerControlTimerRunFailedSummary");
}

function resolveControlTimerCountdownLabel(timer: ButlerControlTimerDto, nowMs: number): string {
  const dueMs = parseIsoTime(timer.dueAt);

  if (!dueMs || dueMs <= nowMs) {
    return t("shell.butlerControlTimerCountdownDueNow");
  }

  return t("shell.butlerControlTimerCountdownActive", {
    duration: formatDurationLabel(dueMs - nowMs)
  });
}

function resolveControlTimerClockLabel(timer: ButlerControlTimerDto, nowMs: number): string {
  const dueMs = parseIsoTime(timer.dueAt);

  if (!dueMs || dueMs <= nowMs) {
    return "00:00";
  }

  return formatDigitalDurationLabel(dueMs - nowMs);
}

function resolveControlTimerWorkspaceLabel(
  timer: ButlerControlTimerDto,
  projectNameById: Map<string, string>,
  workspaceNameById: Map<string, string>,
  currentWorkspaceId: string,
  currentWorkspaceName: string | null
): string {
  const projectId = timer.projectId?.trim();

  if (projectId && projectNameById.has(projectId)) {
    return projectNameById.get(projectId)!;
  }

  const workspaceId = timer.controlSession?.session?.workspaceId?.trim() || currentWorkspaceId.trim();

  if (!workspaceId) {
    return t("shell.butlerControlTimerUnknownWorkspace");
  }

  if (workspaceNameById.has(workspaceId)) {
    return workspaceNameById.get(workspaceId)!;
  }

  if (workspaceId === currentWorkspaceId.trim() && currentWorkspaceName?.trim()) {
    return currentWorkspaceName.trim();
  }

  return t("shell.butlerControlTimerUnknownWorkspace");
}

function resolveControlTimerSessionLabel(
  timer: ButlerControlTimerDto,
  sessionTitleById: Map<string, string>
): string {
  const targetSessionId = timer.targetSessionId?.trim();

  if (targetSessionId && sessionTitleById.has(targetSessionId)) {
    return sessionTitleById.get(targetSessionId)!;
  }

  if (timer.controlSession?.session?.title?.trim()) {
    return timer.controlSession.session.title.trim();
  }

  const currentSessionId = timer.controlSession?.session?.sessionId?.trim() || timer.sessionId.trim();

  if (currentSessionId && sessionTitleById.has(currentSessionId)) {
    return sessionTitleById.get(currentSessionId)!;
  }

  return t("shell.butlerControlTimerUnknownSession");
}

function TimerDetailIcon() {
  return (
    <svg viewBox="0 0 16 16" fill="none" aria-hidden="true" focusable="false">
      <path
        fill="currentColor"
        d="M8 1.25a6.75 6.75 0 1 0 0 13.5A6.75 6.75 0 0 0 8 1.25Zm0 1.5a5.25 5.25 0 1 1 0 10.5A5.25 5.25 0 0 1 8 2.75Zm0 2.5a.875.875 0 1 0 0 1.75a.875.875 0 0 0 0-1.75Zm-.875 3.125a.625.625 0 1 0 0 1.25h.25v1.75h-.25a.625.625 0 1 0 0 1.25h1.75a.625.625 0 1 0 0-1.25h-.25V9a.625.625 0 0 0-.625-.625h-.875Z"
      />
    </svg>
  );
}

function formatDurationLabel(durationMs: number): string {
  const totalSeconds = Math.max(1, Math.ceil(durationMs / 1_000));
  const hours = Math.floor(totalSeconds / 3_600);
  const minutes = Math.floor((totalSeconds % 3_600) / 60);
  const seconds = totalSeconds % 60;
  const formatUnit = (value: number, unit: Intl.NumberFormatOptions["unit"]) =>
    new Intl.NumberFormat(undefined, {
      style: "unit",
      unit,
      unitDisplay: "narrow"
    }).format(value);

  if (hours > 0) {
    return [formatUnit(hours, "hour"), formatUnit(Math.max(minutes, 0), "minute")].join(" ");
  }

  if (minutes > 0) {
    return [formatUnit(minutes, "minute"), formatUnit(seconds, "second")].join(" ");
  }

  return formatUnit(seconds, "second");
}

function formatDigitalDurationLabel(durationMs: number): string {
  const totalSeconds = Math.max(0, Math.ceil(durationMs / 1_000));
  const hours = Math.floor(totalSeconds / 3_600);
  const minutes = Math.floor((totalSeconds % 3_600) / 60);
  const seconds = totalSeconds % 60;

  if (hours > 0) {
    return `${String(hours).padStart(2, "0")}:${String(minutes).padStart(2, "0")}:${String(seconds).padStart(2, "0")}`;
  }

  return `${String(minutes).padStart(2, "0")}:${String(seconds).padStart(2, "0")}`;
}

function isVisibleVerification(status: ButlerVerificationDigestDto["status"]): boolean {
  return status === "queued" || status === "running";
}

function isCancelableFollowUpTask(task: ButlerFollowUpTaskDto): boolean {
  return task.status === "active" || task.status === "waiting_user";
}

function isCancelableVerification(verification: ButlerVerificationDigestDto): boolean {
  return verification.status === "queued" || verification.status === "running";
}

function resolveVerificationStatusLabel(status: ButlerVerificationDigestDto["status"]): string {
  switch (status) {
    case "queued":
    case "running":
      return t("shell.butlerAutomationStatusActive");
    case "passed":
    case "skipped":
      return t("shell.butlerAutomationStatusCompleted");
    case "failed":
      return t("shell.butlerAutomationStatusFailed");
    case "cancelled":
      return t("shell.butlerAutomationStatusCancelled");
    default:
      return status;
  }
}

function resolveVerificationBadgeStatus(
  status: ButlerVerificationDigestDto["status"]
): "active" | "completed" | "failed" | "cancelled" | "waiting_user" {
  if (status === "failed") {
    return "failed";
  }

  if (status === "cancelled") {
    return "cancelled";
  }

  if (status === "passed" || status === "skipped") {
    return "completed";
  }

  return "active";
}

function resolveInboxLifecycleStageLabel(stage: ButlerInboxItemDto["assistantState"]["lifecycleStage"]): string {
  switch (stage) {
    case "analyzing":
      return t("shell.butlerTodoLifecycleAnalyzing");
    case "analyzed":
      return t("shell.butlerTodoLifecycleAnalyzed");
    case "session_created":
      return t("shell.butlerTodoLifecycleSessionCreated");
    case "follow_up_active":
      return t("shell.butlerTodoLifecycleFollowUpActive");
    case "completed":
      return t("shell.butlerTodoLifecycleCompleted");
    case "failed":
      return t("shell.butlerTodoLifecycleFailed");
    case "pending":
    default:
      return t("shell.butlerTodoLifecyclePending");
  }
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

function formatTimestamp(value: string | null | undefined): string {
  const time = parseIsoTime(value);

  if (time <= 0) {
    return "-";
  }

  return new Intl.DateTimeFormat("zh-CN", {
    month: "2-digit",
    day: "2-digit",
    hour: "2-digit",
    minute: "2-digit"
  }).format(new Date(time));
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

function resolveControlSessionStatusLabel(status: ButlerControlSessionDto["status"]): string {
  switch (status) {
    case "running":
      return t("shell.butlerInfoTodoInProgress");
    case "failed":
      return t("shell.butlerTodoLifecycleFailed");
    case "closed":
      return t("shell.butlerInfoTodoClosed");
    case "idle":
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
  kind: "patrol_plan" | "follow_up" | "control_timer",
  triggerType?: ButlerPatrolPlanDto["triggerType"]
): string {
  if (kind === "follow_up") {
    return t("shell.butlerAutomationTaskTypeFollowUp");
  }

  if (kind === "control_timer") {
    return t("shell.butlerAutomationTaskTypeControlTimer");
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

function resolveAutomationRunSourceLabel(
  kind: "patrol_run" | "follow_up_round" | "control_timer"
): string {
  if (kind === "patrol_run") {
    return t("shell.butlerAutomationRunSourcePatrol");
  }

  if (kind === "control_timer") {
    return t("shell.butlerAutomationRunSourceControlTimer");
  }

  return t("shell.butlerAutomationRunSourceFollowUp");
}

function normalizeAutomationRunStatus(status: string): AutomationRunItem["status"] {
  switch (status) {
    case "failed":
      return "failed";
    case "cancelled":
      return "cancelled";
    case "completed":
    case "passed":
    case "succeeded":
      return "completed";
    case "waiting_user":
      return "waiting_user";
    case "active":
    case "queued":
    case "running":
    default:
      return "active";
  }
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

function ButlerHistoryIcon() {
  return (
    <svg width="16" height="16" viewBox="0 0 24 24" fill="none" stroke="currentColor" strokeWidth="2">
      <path d="M12 8v5l3 2" />
      <path d="M5 3v4" />
      <path d="M19 3v4" />
      <path d="M4 7h16" />
      <rect x="3" y="5" width="18" height="16" rx="2" />
    </svg>
  );
}
