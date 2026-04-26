import {
  useDeferredValue,
  useCallback,
  useEffect,
  useId,
  useMemo,
  useRef,
  useState,
  type FormEvent,
  type RefObject
} from "react";
import { useNavigate, useParams } from "react-router-dom";

import { resolveMacOsNativeTitlebarDragRegion } from "../../../platform/desktop/window-drag";
import { usePlatform } from "../../../platform/platform-provider";
import { logPerfDebug } from "../../../shared/debug/perf-debug";
import { t } from "../../../shared/i18n";
import { useToast } from "../../../shared/toast";
import { ModalList, ModalListItem } from "../../../components/ModalAtoms";
import {
  deleteSession,
  listProviderCatalog,
  type ProviderCatalogEntryDto
} from "../../conversation/api/conversation-api";
import { ComposerPanel } from "../../conversation/components/ComposerPanel";
import { FileContextPanel } from "../../conversation/components/FileContextPanel";
import { MessageTimeline } from "../../conversation/components/MessageTimeline";
import { PermissionRequestList } from "../../conversation/components/PermissionRequestList";
import { useWorkbenchShell } from "../../conversation/components/WorkbenchLayout";
import { WorkbenchModal } from "../../conversation/components/WorkbenchModal";
import {
  buildWorkspaceButlerPath,
  buildWorkspaceSessionPath
} from "../../workbench/utils/workbench-navigation";
import type {
  AssistantAutomationRunDto,
  AssistantAutomationTaskDto,
  AssistantSandboxDto,
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
  expireAssistantSandbox,
  getButlerFollowUpTask,
  listAssistantSandboxes,
  listAssistantAutomations,
  listRecentAssistantAutomationRuns,
  listButlerControlSessions,
  listButlerControlTimers,
  listButlerFollowUpTasks,
  listButlerInboxItems,
  listButlerPatrolPlans,
  promoteAssistantSandbox,
  removeAssistantSandbox,
  skipAssistantAutomationWait,
  startButlerInboxItemSession,
  updateAssistantAutomation
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

interface AutomationEditorState {
  title: string;
  content: string;
  includeTriggerContext: boolean;
  dueAt: string;
  everySeconds: string;
  everyMinutes: string;
  everyHours: string;
  stopAt: string;
  cronMinute: string;
  cronHour: string;
  cronDaysOfWeek: string;
  pollIntervalSeconds: string;
  expiresAt: string;
  maxChecks: string;
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
const CONTROL_SCHEDULE_HIDE_DELAY_MS = 1_500;
const BUTLER_RUNTIME_ACTIVE_HIDE_DELAY_MS = 1_500;
const ACTIVE_CONTROL_SESSION_WINDOW_MS = 8 * 60 * 60 * 1_000;
const BUTLER_PROVIDER_IDS: ButlerProviderId[] = ["codex", "claude-code"];

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
  const [selectedAutomationId, setSelectedAutomationId] = useState<string | null>(null);
  const [automationEditorState, setAutomationEditorState] = useState<AutomationEditorState | null>(null);
  const [savingAutomationId, setSavingAutomationId] = useState<string | null>(null);
  const [replyingPermissionRequestId, setReplyingPermissionRequestId] = useState<string | null>(null);
  const [controlHistoryOpen, setControlHistoryOpen] = useState(false);
  const [controlHistoryQuery, setControlHistoryQuery] = useState("");
  const [controlSessionDeletionTarget, setControlSessionDeletionTarget] =
    useState<ButlerControlSessionDto | null>(null);
  const [deletingControlSessionId, setDeletingControlSessionId] = useState<string | null>(null);
  const [sandboxManagerOpen, setSandboxManagerOpen] = useState(false);
  const [allSandboxesOpen, setAllSandboxesOpen] = useState(false);
  const [detailTaskId, setDetailTaskId] = useState<string | null>(null);
  const [detailTask, setDetailTask] = useState<ButlerFollowUpTaskDto | null>(null);
  const [detailLoading, setDetailLoading] = useState(false);
  const [detailError, setDetailError] = useState<string | null>(null);
  const [assistantSandboxes, setAssistantSandboxes] = useState<AssistantSandboxDto[]>([]);
  const [allAssistantSandboxes, setAllAssistantSandboxes] = useState<AssistantSandboxDto[]>([]);
  const [sandboxLoading, setSandboxLoading] = useState(false);
  const [allSandboxLoading, setAllSandboxLoading] = useState(false);
  const [selectedSandboxId, setSelectedSandboxId] = useState<string | null>(null);
  const [sandboxActionSandboxId, setSandboxActionSandboxId] = useState<string | null>(null);
  const [cancellingFollowUpTaskId, setCancellingFollowUpTaskId] = useState<string | null>(null);
  const [cancellingVerificationId, setCancellingVerificationId] = useState<string | null>(null);
  const [cancellingAutomationId, setCancellingAutomationId] = useState<string | null>(null);
  const [skippingAutomationWaitId, setSkippingAutomationWaitId] = useState<string | null>(null);
  const [cancellingTimerId, setCancellingTimerId] = useState<string | null>(null);
  const [executingTimerId, setExecutingTimerId] = useState<string | null>(null);
  const [countdownNow, setCountdownNow] = useState(() => Date.now());
  const [providerCatalog, setProviderCatalog] = useState<ProviderCatalogEntryDto[] | null>(null);
  const controlHistoryButtonRef = useRef<HTMLDivElement | null>(null);
  const controlHistoryPopoverRef = useRef<HTMLDivElement | null>(null);
  const controlHistorySearchInputRef = useRef<HTMLInputElement>(null);
  const controlHistoryPopoverLabelId = useId();
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
  const permissionRequests = useButlerRuntimeStore(store, (state) => state.permissionRequests);
  const error = useButlerRuntimeStore(store, (state) => state.error);
  const debugRenderStateRef = useRef<string | null>(null);
  const permissionToastSessionIdRef = useRef<string | null>(null);
  const permissionToastBaselineReadyRef = useRef(false);
  const pendingPermissionRequestIdsRef = useRef<Set<string>>(new Set());

  useEffect(() => {
    let disposed = false;

    void listProviderCatalog()
      .then((items) => {
        if (!disposed) {
          setProviderCatalog(items);
        }
      })
      .catch(() => {
        if (!disposed) {
          setProviderCatalog(null);
        }
      });

    return () => {
      disposed = true;
    };
  }, []);

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
  const immediateControlSessionActive = useMemo(
    () => hasButlerActiveRuntimeIndicator(controlSession, runtimeHasActiveRun),
    [controlSession, runtimeHasActiveRun]
  );
  const isControlSessionActive = useStableButlerRuntimeActive(
    controlSession?.session.sessionId ?? null,
    immediateControlSessionActive
  );
  const composerHasActiveRun = isControlSessionActive || sending;
  const composerIsRunning = isControlSessionActive || sending;
  const composerCanInterrupt =
    runtimeCanInterrupt === true || sending
      ? true
      : runtimeCanInterrupt ?? false;
  const immediateActiveControlSchedule = useMemo(
    () => {
      if (!controlSession || isControlSessionActive) {
        return null;
      }

      const timerItems = controlTimers
        .filter((timer) => timer.status === "active" && timer.controlSessionId === controlSession.id)
        .map<ButlerControlScheduleBannerItem>((timer) => ({
          kind: "timer",
          timer
        }));
      const timerIds = new Set(
        controlTimers
          .filter((timer) => timer.status === "active" && timer.controlSessionId === controlSession.id)
          .map((timer) => timer.id)
      );
      const automationItems = assistantAutomations
        .filter((automation) => (
          automation.status === "active"
          && automation.controlSessionId === controlSession.id
          && Boolean(automation.nextRunAt)
          && !timerIds.has(automation.id)
        ))
        .map<ButlerControlScheduleBannerItem>((automation) => ({
          kind: "automation",
          automation
        }));

      return [...timerItems, ...automationItems]
        .sort((left, right) => parseIsoTime(readControlScheduleDueAt(left)) - parseIsoTime(readControlScheduleDueAt(right)))[0] ?? null;
    },
    [assistantAutomations, controlSession, controlTimers, isControlSessionActive]
  );
  const activeControlSchedule = useStableControlSchedule(immediateActiveControlSchedule);
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
  const selectedAutomation = useMemo(
    () =>
      selectedAutomationId
        ? assistantAutomations.find((automation) => automation.id === selectedAutomationId) ?? null
        : null,
    [assistantAutomations, selectedAutomationId]
  );
  const selectedAutomationRuns = useMemo(
    () =>
      selectedAutomationId
        ? assistantAutomationRuns
          .filter((run) => run.automationId === selectedAutomationId)
          .sort((left, right) => parseIsoTime(right.createdAt) - parseIsoTime(left.createdAt))
          .slice(0, 8)
        : [],
    [assistantAutomationRuns, selectedAutomationId]
  );

  useEffect(() => {
    if (selectedAutomationId && !selectedAutomation) {
      setSelectedAutomationId(null);
      setAutomationEditorState(null);
    }
  }, [selectedAutomation, selectedAutomationId]);
  const sessionWorkspaceIdById = useMemo(
    () =>
      new Map(
        navigationGroups.flatMap((group) =>
          group.sessions.map((session) => [session.sessionId, group.workspace.id] as const)
        )
      ),
    [navigationGroups]
  );
  const selectedSandbox = useMemo(
    () =>
      assistantSandboxes.find((item) => item.id === selectedSandboxId)
      ?? allAssistantSandboxes.find((item) => item.id === selectedSandboxId)
      ?? null,
    [allAssistantSandboxes, assistantSandboxes, selectedSandboxId]
  );

  useEffect(() => {
    if (!selectedSandboxId) {
      return;
    }

    const existsInCurrent = assistantSandboxes.some((item) => item.id === selectedSandboxId);
    const existsInAll = allAssistantSandboxes.some((item) => item.id === selectedSandboxId);

    if (existsInCurrent || existsInAll) {
      return;
    }

    setSelectedSandboxId(assistantSandboxes[0]?.id ?? allAssistantSandboxes[0]?.id ?? null);
  }, [allAssistantSandboxes, assistantSandboxes, selectedSandboxId]);

  useEffect(() => {
    setCountdownNow(Date.now());

    if (!activeControlSchedule) {
      return;
    }

    const timer = window.setInterval(() => {
      setCountdownNow(Date.now());
    }, 1_000);

    return () => {
      window.clearInterval(timer);
    };
  }, [activeControlSchedule]);
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
  const reloadAssistantSandboxes = useCallback(async () => {
    if (!initialized) {
      setAssistantSandboxes([]);
      setSelectedSandboxId(null);
      return;
    }

    if (!controlSession?.id) {
      setAssistantSandboxes([]);
      setSelectedSandboxId(null);
      return;
    }

    setSandboxLoading(true);

    try {
      const response = await listAssistantSandboxes({
        controlSessionId: controlSession?.id ?? null
      });
      setAssistantSandboxes(response.payload.items);
      setSelectedSandboxId((current) => {
        if (!response.payload.items.length) {
          return null;
        }

        return response.payload.items.some((item) => item.id === current)
          ? current
          : response.payload.items[0]?.id ?? null;
      });
    } catch (error) {
      showToast({
        title: t("shell.butlerSandboxLoadFailed"),
        description: error instanceof Error ? error.message : undefined,
        tone: "error"
      });
    } finally {
      setSandboxLoading(false);
    }
  }, [controlSession?.id, initialized, showToast]);
  const reloadAllAssistantSandboxes = useCallback(async () => {
    if (!initialized) {
      setAllAssistantSandboxes([]);
      return;
    }

    setAllSandboxLoading(true);

    try {
      const response = await listAssistantSandboxes();
      setAllAssistantSandboxes(response.payload.items.filter((item) => item.status !== "deleted"));
    } catch (error) {
      showToast({
        title: t("shell.butlerSandboxLoadFailed"),
        description: error instanceof Error ? error.message : undefined,
        tone: "error"
      });
    } finally {
      setAllSandboxLoading(false);
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
    if (!controlHistoryOpen) {
      void reloadControlSessionHistory();
    }

    setControlHistoryOpen((current) => !current);
  }, [controlHistoryOpen, reloadControlSessionHistory]);
  const handleCloseControlHistory = useCallback(() => {
    setControlHistoryOpen(false);
    setControlHistoryQuery("");
  }, []);
  const handleConfirmControlSessionDeletion = useCallback(async () => {
    if (!controlSessionDeletionTarget || deletingControlSessionId) {
      return;
    }

    setDeletingControlSessionId(controlSessionDeletionTarget.id);

    try {
      await deleteSession(controlSessionDeletionTarget.session.sessionId);

      if (controlSessionDeletionTarget.id === controlSession?.id) {
        await store.openControlSession("");
      }

      handleCloseControlHistory();
      setControlSessionDeletionTarget(null);
      await reloadControlSessionHistory();
      requestNavigationRefresh();
      showToast({
        title: t("shell.deleteSessionSuccess"),
        tone: "success"
      });
    } catch (error) {
      showToast({
        title: error instanceof Error ? error.message : t("shell.deleteSessionFailed"),
        tone: "error"
      });
    } finally {
      setDeletingControlSessionId(null);
    }
  }, [
    controlSession?.id,
    controlSessionDeletionTarget,
    deletingControlSessionId,
    handleCloseControlHistory,
    reloadControlSessionHistory,
    requestNavigationRefresh,
    showToast,
    store
  ]);
  const handleOpenSandboxManager = useCallback(() => {
    setSandboxManagerOpen(true);
    void reloadAssistantSandboxes();
  }, [reloadAssistantSandboxes]);
  const handleOpenAllSandboxes = useCallback(() => {
    setAllSandboxesOpen(true);
    void reloadAllAssistantSandboxes();
  }, [reloadAllAssistantSandboxes]);

  useEffect(() => {
    if (!controlHistoryOpen) {
      setControlHistoryQuery("");
      return;
    }

    const frameId = window.requestAnimationFrame(() => {
      controlHistorySearchInputRef.current?.focus();
      controlHistorySearchInputRef.current?.select();
    });

    return () => {
      window.cancelAnimationFrame(frameId);
    };
  }, [controlHistoryOpen]);

  useEffect(() => {
    if (!controlHistoryOpen) {
      return;
    }

    const handlePointerDown = (event: PointerEvent) => {
      const target = event.target as Node;

      if (
        controlHistoryButtonRef.current?.contains(target)
        || controlHistoryPopoverRef.current?.contains(target)
      ) {
        return;
      }

      handleCloseControlHistory();
    };

    const handleKeyDown = (event: KeyboardEvent) => {
      if (event.key !== "Escape") {
        return;
      }

      event.preventDefault();
      handleCloseControlHistory();
    };

    document.addEventListener("pointerdown", handlePointerDown);
    document.addEventListener("keydown", handleKeyDown);

    return () => {
      document.removeEventListener("pointerdown", handlePointerDown);
      document.removeEventListener("keydown", handleKeyDown);
    };
  }, [controlHistoryOpen, handleCloseControlHistory]);

  useEffect(() => {
    if (!sandboxManagerOpen) {
      return;
    }

    void reloadAssistantSandboxes();
  }, [controlSession?.id, reloadAssistantSandboxes, sandboxManagerOpen]);

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
  const handleOpenAutomationDetail = useCallback((automationId: string) => {
    const automation = assistantAutomations.find((item) => item.id === automationId);

    if (!automation) {
      return;
    }

    setSelectedAutomationId(automationId);
    setAutomationEditorState(createAutomationEditorState(automation));
  }, [assistantAutomations]);
  const handleSaveAutomation = useCallback(async () => {
    if (!selectedAutomation || !automationEditorState) {
      return;
    }

    let payload: ReturnType<typeof buildAutomationUpdatePayload>;

    try {
      payload = buildAutomationUpdatePayload(selectedAutomation, automationEditorState);
    } catch (error) {
      showToast({
        title: t("shell.butlerAutomationSaveFailed"),
        description: error instanceof Error ? error.message : undefined,
        tone: "error"
      });
      return;
    }

    setSavingAutomationId(selectedAutomation.id);

    try {
      const response = await updateAssistantAutomation(selectedAutomation.id, payload);
      setAssistantAutomations((current) => replaceAssistantAutomation(current, response.payload.automation));
      setSelectedAutomationId(response.payload.automation.id);
      setAutomationEditorState(createAutomationEditorState(response.payload.automation));
      showToast({
        title: t("shell.butlerAutomationSaveSucceeded"),
        tone: "success"
      });
    } catch (error) {
      showToast({
        title: t("shell.butlerAutomationSaveFailed"),
        description: error instanceof Error ? error.message : undefined,
        tone: "error"
      });
    } finally {
      setSavingAutomationId(null);
    }
  }, [automationEditorState, selectedAutomation, showToast]);
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
  const handleSkipAutomationWait = useCallback(async (automationId: string) => {
    setSkippingAutomationWaitId(automationId);

    try {
      const response = await skipAssistantAutomationWait(automationId);
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
      setSkippingAutomationWaitId(null);
    }
  }, [showToast]);
  const handleCancelControlSchedule = useCallback(async (schedule: ButlerControlScheduleBannerItem) => {
    if (schedule.kind === "timer") {
      await handleCancelControlTimer(schedule.timer.id);
      return;
    }

    await handleCancelAutomation(schedule.automation.id);
  }, [handleCancelAutomation, handleCancelControlTimer]);
  const handleSkipControlScheduleWait = useCallback(async (schedule: ButlerControlScheduleBannerItem) => {
    if (schedule.kind === "timer") {
      await handleCancelControlTimer(schedule.timer.id);
      return;
    }

    await handleSkipAutomationWait(schedule.automation.id);
  }, [handleCancelControlTimer, handleSkipAutomationWait]);
  const handleExecuteControlScheduleNow = useCallback(async (schedule: ButlerControlScheduleBannerItem) => {
    if (schedule.kind === "timer") {
      await handleExecuteControlTimerNow(schedule.timer);
      return;
    }

    if (schedule.automation.triggerType !== "once") {
      return;
    }

    const prompt = schedule.automation.actionConfig.content.trim();

    if (!prompt) {
      showToast({
        title: t("shell.butlerControlTimerExecuteNowFailed"),
        tone: "error"
      });
      return;
    }

    setExecutingTimerId(schedule.automation.id);

    try {
      await cancelAssistantAutomation(schedule.automation.id);
      setAssistantAutomations((current) =>
        replaceAssistantAutomation(
          current,
          {
            ...schedule.automation,
            status: "cancelled",
            nextRunAt: null,
            cancelledAt: new Date().toISOString(),
            updatedAt: new Date().toISOString()
          }
        )
      );
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
  const handleOpenControlScheduleSession = useCallback((schedule: ButlerControlScheduleBannerItem) => {
    const targetSessionId = resolveControlScheduleTargetSessionId(schedule);
    const targetWorkspaceId =
      (targetSessionId ? sessionWorkspaceIdById.get(targetSessionId) : null)
      || readControlScheduleWorkspaceId(schedule)
      || workspaceId;

    if (!targetSessionId || !targetWorkspaceId) {
      return;
    }

    navigate(buildWorkspaceSessionPath(targetWorkspaceId, targetSessionId));
  }, [navigate, sessionWorkspaceIdById, workspaceId]);
  const handlePromoteSandboxToProject = useCallback(async (sandboxId: string) => {
    setSandboxActionSandboxId(sandboxId);

    try {
      const response = await promoteAssistantSandbox({
        sandboxId,
        mode: "project",
        defaultProvider: activeProvider
      });
      setAssistantSandboxes((current) =>
        mergeAssistantSandboxList(current, response.payload.sandbox, controlSession?.id ?? null)
      );
      setAllAssistantSandboxes((current) => mergeAssistantSandboxList(current, response.payload.sandbox));
      requestNavigationRefresh();
      showToast({
        title: t("shell.butlerSandboxPromoteSucceeded"),
        tone: "success"
      });
    } catch (error) {
      showToast({
        title: t("shell.butlerSandboxPromoteFailed"),
        description: error instanceof Error ? error.message : undefined,
        tone: "error"
      });
    } finally {
      setSandboxActionSandboxId(null);
    }
  }, [activeProvider, controlSession?.id, requestNavigationRefresh, showToast]);
  const handleExpireSandbox = useCallback(async (sandboxId: string) => {
    setSandboxActionSandboxId(sandboxId);

    try {
      const response = await expireAssistantSandbox(sandboxId);
      setAssistantSandboxes((current) =>
        mergeAssistantSandboxList(current, response.payload.sandbox, controlSession?.id ?? null)
      );
      setAllAssistantSandboxes((current) => mergeAssistantSandboxList(current, response.payload.sandbox));
      showToast({
        title: t("shell.butlerSandboxExpireSucceeded"),
        tone: "success"
      });
    } catch (error) {
      showToast({
        title: t("shell.butlerSandboxExpireFailed"),
        description: error instanceof Error ? error.message : undefined,
        tone: "error"
      });
    } finally {
      setSandboxActionSandboxId(null);
    }
  }, [controlSession?.id, showToast]);
  const handleRemoveSandbox = useCallback(async (sandboxId: string) => {
    setSandboxActionSandboxId(sandboxId);

    try {
      const response = await removeAssistantSandbox(sandboxId);
      setAssistantSandboxes((current) =>
        mergeAssistantSandboxList(current, response.payload.sandbox, controlSession?.id ?? null)
      );
      setAllAssistantSandboxes((current) => mergeAssistantSandboxList(current, response.payload.sandbox));
      requestNavigationRefresh();
      showToast({
        title: t("shell.butlerSandboxRemoveSucceeded"),
        tone: "success"
      });
    } catch (error) {
      showToast({
        title: t("shell.butlerSandboxRemoveFailed"),
        description: error instanceof Error ? error.message : undefined,
        tone: "error"
      });
    } finally {
      setSandboxActionSandboxId(null);
    }
  }, [controlSession?.id, requestNavigationRefresh, showToast]);
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
    const sessionId = controlSession?.session?.sessionId ?? null;

    if (permissionToastSessionIdRef.current !== sessionId) {
      permissionToastSessionIdRef.current = sessionId;
      permissionToastBaselineReadyRef.current = false;
      pendingPermissionRequestIdsRef.current = new Set();
    }

    if (!sessionId) {
      return;
    }

    const pendingRequests = permissionRequests.filter((request) => request.status === "pending");
    const nextPendingIds = new Set(pendingRequests.map((request) => request.id));

    if (permissionToastBaselineReadyRef.current) {
      pendingRequests.forEach((request) => {
        if (pendingPermissionRequestIdsRef.current.has(request.id)) {
          return;
        }

        showToast({
          id: `butler-permission-request-${request.id}`,
          title: t("conversation.permissionRequestToastTitle"),
          description: t("conversation.backgroundPermissionToastDescription", {
            title:
              controlSession?.title?.trim()
              || controlSession?.session?.title?.trim()
              || butlerDisplayName,
            requestTitle: request.title
          }),
          tone: "warning",
          durationMs: 8_000
        });
      });
    }

    pendingPermissionRequestIdsRef.current = nextPendingIds;
    permissionToastBaselineReadyRef.current = true;
  }, [butlerDisplayName, controlSession?.session?.sessionId, controlSession?.session?.title, controlSession?.title, permissionRequests, showToast]);

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
      setAssistantSandboxes([]);
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
        setAssistantSandboxes([]);
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
    () =>
      resolveButlerProviderOptions(providerCatalog, [
        initForm.providerId,
        profile?.providerId ?? null,
        activeProvider
      ]),
    [activeProvider, initForm.providerId, profile?.providerId, providerCatalog]
  );
  const enabledProviderOptions = useMemo(
    () => providerOptions.filter((option) => option.enabled),
    [providerOptions]
  );
  const activeProviderEnabled = providerOptions.find((option) => option.value === activeProvider)?.enabled ?? true;
  const canSwitchProvider = providerOptions.some(
    (option) => option.enabled && option.value !== activeProvider
  );

  useEffect(() => {
    if (initialized || enabledProviderOptions.length === 0) {
      return;
    }

    if (enabledProviderOptions.some((option) => option.value === initForm.providerId)) {
      return;
    }

    setInitForm((current) => ({
      ...current,
      providerId: enabledProviderOptions[0]?.value ?? current.providerId
    }));
  }, [enabledProviderOptions, initForm.providerId, initialized]);

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
        controlSession={controlSession}
        sandboxes={assistantSandboxes}
        settingsForm={settingsForm}
        savingSettings={savingSettings}
        onOpenSandboxManager={handleOpenSandboxManager}
        onOpenFollowUpHistory={handleOpenFollowUpHistory}
        onOpenVerificationHistory={handleOpenVerificationHistory}
        onOpenAutomationHistory={handleOpenAutomationHistory}
        onOpenAutomationDetail={handleOpenAutomationDetail}
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
      handleOpenSandboxManager,
      handleCopyTodoPrompt,
      handleOpenAutomationHistory,
      handleOpenAutomationDetail,
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
      assistantSandboxes,
      inboxItems,
      cancellingAutomationId,
      cancellingFollowUpTaskId,
      cancellingVerificationId,
      controlSession,
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
                      disabled={enabledProviderOptions.length <= 1}
                      onChange={(event) =>
                        setInitForm((current) => ({
                          ...current,
                          providerId: event.target.value as ButlerProviderId
                        }))
                      }
                    >
                      {providerOptions.map((option) => (
                        <option key={option.value} value={option.value} disabled={!option.enabled}>
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
                  disabled={loading || initializingProfile || enabledProviderOptions.length === 0}
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
                disabled={!canSwitchProvider || switchingProvider || sending}
                onChange={(event) => {
                  void handleProviderSwitch(event.target.value as ButlerProviderId);
                }}
              >
                {providerOptions.map((option) => (
                  <option key={option.value} value={option.value} disabled={!option.enabled}>
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
              disabled={loading || sending || switchingProvider || !activeProviderEnabled}
              onClick={() => {
                void handleStartFreshSession();
              }}
            >
              <span className="terminal-toolbar-icon" aria-hidden="true">
                <ButlerPlusIcon />
              </span>
            </button>
            <div className="butler-session-history-anchor" ref={controlHistoryButtonRef}>
              <button
                type="button"
                className="terminal-tab-control butler-header-icon-button"
                aria-label={t("shell.butlerHistoryAction")}
                aria-haspopup="dialog"
                aria-expanded={controlHistoryOpen}
                aria-controls={controlHistoryOpen ? "butler-control-history-popover" : undefined}
                title={t("shell.butlerHistoryAction")}
                disabled={loading || sending || switchingProvider}
                onClick={() => {
                  handleOpenControlHistory();
                }}
            >
              <span className="terminal-toolbar-icon butler-history-toolbar-icon" aria-hidden="true">
                <ButlerHistoryIcon />
              </span>
            </button>
              <ButlerAnchoredPopover
                open={controlHistoryOpen}
                id="butler-control-history-popover"
                className="butler-session-history-popover"
                anchorRef={controlHistoryButtonRef}
                popoverRef={controlHistoryPopoverRef}
                labelledBy={controlHistoryPopoverLabelId}
                maxWidth={420}
                gap={10}
                viewportPadding={14}
              >
                <ButlerControlHistoryPanel
                  sessions={controlSessions}
                  activeControlSessionId={controlSession?.id ?? null}
                  labelId={controlHistoryPopoverLabelId}
                  query={controlHistoryQuery}
                  searchInputRef={controlHistorySearchInputRef}
                  onQueryChange={setControlHistoryQuery}
                  deletingSessionId={deletingControlSessionId}
                  onSelectSession={async (targetSession) => {
                    if (targetSession.id === controlSession?.id) {
                      handleCloseControlHistory();
                      return;
                    }

                    await store.openControlSession(targetSession.id);
                    handleCloseControlHistory();
                  }}
                  onDeleteSession={(targetSession) => {
                    setControlSessionDeletionTarget(targetSession);
                  }}
                />
              </ButlerAnchoredPopover>
            </div>
          </div>
        </header>

        <section className="butler-main-column">
          <div key={`timeline:${activeProvider}:${viewKey}`} className="butler-conversation-shell">
            <PermissionRequestList
              requests={permissionRequests}
              replyingRequestId={replyingPermissionRequestId}
              onReply={async (requestId, payload) => {
                setReplyingPermissionRequestId(requestId);

                try {
                  await store.replyPermissionRequest(requestId, payload);
                } catch (replyError) {
                  showToast({
                    title: t("conversation.permissionRequestReplyFailed"),
                    description: replyError instanceof Error ? replyError.message : undefined,
                    tone: "error"
                  });
                } finally {
                  setReplyingPermissionRequestId(null);
                }
              }}
            />
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

            {activeControlSchedule ? (
              <ButlerControlTimerBanner
                schedule={activeControlSchedule}
                currentWorkspaceId={workspaceId}
                currentWorkspaceName={currentWorkspaceName}
                projectNameById={projectNameById}
                workspaceNameById={workspaceNameById}
                sessionTitleById={sessionTitleById}
                sessionWorkspaceIdById={sessionWorkspaceIdById}
                countdownNow={countdownNow}
                cancelling={
                  activeControlSchedule.kind === "timer"
                    ? cancellingTimerId === activeControlSchedule.timer.id
                    : cancellingAutomationId === activeControlSchedule.automation.id
                }
                skippingWait={
                  activeControlSchedule.kind === "automation"
                    && skippingAutomationWaitId === activeControlSchedule.automation.id
                }
                executingNow={executingTimerId === activeControlScheduleId(activeControlSchedule)}
                onCancel={() => {
                  void handleCancelControlSchedule(activeControlSchedule);
                }}
                onSkipWait={() => {
                  void handleSkipControlScheduleWait(activeControlSchedule);
                }}
                onExecuteNow={() => {
                  void handleExecuteControlScheduleNow(activeControlSchedule);
                }}
                onOpenSession={() => {
                  handleOpenControlScheduleSession(activeControlSchedule);
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
                hasActiveRun={composerHasActiveRun}
                canInterrupt={composerCanInterrupt}
                contextUsage={contextUsage}
                isSubmitting={sending || switchingProvider}
                isRunning={composerIsRunning}
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
        open={controlSessionDeletionTarget !== null}
        title={t("shell.deleteSessionConfirmTitle")}
        description={t("shell.deleteSessionConfirmDescription")}
        onClose={() => {
          if (deletingControlSessionId) {
            return;
          }

          setControlSessionDeletionTarget(null);
        }}
      >
        <p className="workbench-section-empty">
          {controlSessionDeletionTarget
            ? resolveControlSessionListTitle(controlSessionDeletionTarget)
            : ""}
        </p>
        <div className="workbench-modal-actions">
          <button
            type="button"
            className="secondary-button"
            disabled={Boolean(deletingControlSessionId)}
            onClick={() => setControlSessionDeletionTarget(null)}
          >
            {t("common.cancel")}
          </button>
          <button
            type="button"
            className="secondary-button workbench-danger-button"
            disabled={Boolean(deletingControlSessionId)}
            onClick={() => {
              void handleConfirmControlSessionDeletion();
            }}
          >
            {deletingControlSessionId ? t("common.loading") : t("shell.deleteSessionAction")}
          </button>
        </div>
      </WorkbenchModal>
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
        open={selectedAutomation !== null}
        title={t("shell.butlerAutomationDetailTitle")}
        description={selectedAutomation?.title?.trim() || selectedAutomation?.actionConfig.content.trim() || t("shell.butlerAutomationDetailDescription")}
        className="butler-automation-detail-modal"
        onClose={() => {
          setSelectedAutomationId(null);
          setAutomationEditorState(null);
          setSavingAutomationId(null);
        }}
      >
        {selectedAutomation && automationEditorState ? (
          <AutomationDetailModalPanel
            automation={selectedAutomation}
            editorState={automationEditorState}
            saving={savingAutomationId === selectedAutomation.id}
            projectName={resolveAssistantAutomationProjectName(selectedAutomation, projectNameById)}
            targetSessionTitle={resolveAutomationTargetSessionLabel(selectedAutomation, sessionTitleById)}
            recentRuns={selectedAutomationRuns}
            onEditorChange={(patch) => {
              setAutomationEditorState((current) => (current ? { ...current, ...patch } : current));
            }}
            onSave={() => {
              void handleSaveAutomation();
            }}
          />
        ) : null}
      </WorkbenchModal>
      <WorkbenchModal
        open={sandboxManagerOpen}
        title={t("shell.butlerSandboxManagerTitle")}
        description={t("shell.butlerSandboxManagerDescription")}
        headerActions={(
          <button
            type="button"
            className="secondary-button"
            onClick={() => {
              handleOpenAllSandboxes();
            }}
          >
            {t("shell.butlerSandboxBrowseAllAction")}
          </button>
        )}
        onClose={() => {
          setAllSandboxesOpen(false);
          setSandboxManagerOpen(false);
        }}
      >
        <ButlerSandboxManagerPanel
          items={assistantSandboxes}
          selectedSandbox={selectedSandbox}
          loading={sandboxLoading}
          actionSandboxId={sandboxActionSandboxId}
          onSelectSandbox={setSelectedSandboxId}
          onReload={reloadAssistantSandboxes}
          onPromoteSandboxToProject={handlePromoteSandboxToProject}
          onExpireSandbox={handleExpireSandbox}
          onRemoveSandbox={handleRemoveSandbox}
        />
      </WorkbenchModal>
      <WorkbenchModal
        open={allSandboxesOpen}
        title={t("shell.butlerSandboxLibraryTitle")}
        description={t("shell.butlerSandboxLibraryDescription")}
        layout="list"
        headerActions={(
          <button
            type="button"
            className="secondary-button"
            disabled={allSandboxLoading}
            onClick={() => {
              void reloadAllAssistantSandboxes();
            }}
          >
            {t("shell.butlerRefreshAction")}
          </button>
        )}
        onClose={() => {
          setAllSandboxesOpen(false);
        }}
      >
        <ButlerAllSandboxesPanel
          items={allAssistantSandboxes}
          loading={allSandboxLoading}
          actionSandboxId={sandboxActionSandboxId}
          selectedSandboxId={selectedSandboxId}
          onViewSandbox={(sandboxId) => {
            setSelectedSandboxId(sandboxId);
            setAllSandboxesOpen(false);
          }}
          onRemoveSandbox={handleRemoveSandbox}
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
  controlSession: ButlerControlSessionDto | null;
  sandboxes: AssistantSandboxDto[];
  settingsForm: ButlerSettingsFormState;
  savingSettings: boolean;
  onOpenSandboxManager: () => void;
  onOpenFollowUpHistory: () => void;
  onOpenVerificationHistory: () => void;
  onOpenAutomationHistory: () => void;
  onOpenAutomationDetail: (automationId: string) => void;
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
        sandboxes={props.sandboxes}
        onOpenSandboxManager={props.onOpenSandboxManager}
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
        onOpenAutomationDetail={props.onOpenAutomationDetail}
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
  sandboxes: AssistantSandboxDto[];
  onOpenSandboxManager: () => void;
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
      <ButlerSandboxEntryCard
        sandboxes={props.sandboxes}
        onOpenSandboxManager={props.onOpenSandboxManager}
      />
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

function ButlerSandboxEntryCard(props: {
  sandboxes: AssistantSandboxDto[];
  onOpenSandboxManager: () => void;
}) {
  const activeCount = props.sandboxes.filter((item) => item.status === "active").length;

  return (
    <section className="butler-side-card butler-sandbox-entry-card">
      <header>
        <div>
          <h2>{t("shell.butlerSandboxEntryTitle")}</h2>
          <p>{t("shell.butlerSandboxEntryDescription")}</p>
          {activeCount > 0 ? (
            <p className="butler-secondary-text">
              {t("shell.butlerSandboxEntrySessionSummary", {
                count: activeCount
              })}
            </p>
          ) : null}
        </div>
        <button
          type="button"
          className="secondary-button butler-side-header-action"
          onClick={props.onOpenSandboxManager}
        >
          {t("shell.butlerSandboxManageAction")}
        </button>
      </header>
    </section>
  );
}

function AutomationSidebarContent(props: {
  overview: ButlerOverviewDto | null;
  automations: AssistantAutomationTaskDto[];
  runs: AssistantAutomationRunDto[];
  cancellingAutomationId: string | null;
  onOpenAutomationHistory: () => void;
  onOpenAutomationDetail: (automationId: string) => void;
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
        onOpenAutomationDetail={props.onOpenAutomationDetail}
        emptyText={t("shell.butlerAutomationTasksEmpty")}
        actionLabel={t("shell.butlerFollowUpHistoryAction")}
        onAction={props.onOpenAutomationHistory}
      />
      <AutomationRunOverviewCard
        items={automationRuns}
        emptyText={t("shell.butlerAutomationRunsEmpty")}
        onOpenAutomationDetail={props.onOpenAutomationDetail}
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
  labelId: string;
  query: string;
  searchInputRef: RefObject<HTMLInputElement>;
  onQueryChange: (value: string) => void;
  deletingSessionId: string | null;
  onSelectSession: (session: ButlerControlSessionDto) => Promise<void>;
  onDeleteSession: (session: ButlerControlSessionDto) => void;
}) {
  const deferredQuery = useDeferredValue(props.query);
  const filteredSessions = useMemo(() => {
    const normalizedQuery = deferredQuery.trim().toLowerCase();

    return props.sessions
      .map((session) => {
        const title = resolveControlSessionListTitle(session);
        const preview = resolveControlSessionPreview(session, title);
        const updatedAtMs = parseIsoTime(session.updatedAt);
        const searchText = [title, preview, session.sessionId].join("\n").toLowerCase();

        return {
          session,
          title,
          preview,
          updatedAtMs,
          active: updatedAtMs > 0 && Date.now() - updatedAtMs <= ACTIVE_CONTROL_SESSION_WINDOW_MS,
          searchText
        };
      })
      .filter((item) => !normalizedQuery || item.searchText.includes(normalizedQuery))
      .sort((left, right) => right.updatedAtMs - left.updatedAtMs);
  }, [deferredQuery, props.sessions]);
  const activeSessions = filteredSessions.filter((item) => item.active);
  const inactiveSessions = filteredSessions.filter((item) => !item.active);
  const isSearching = deferredQuery.trim().length > 0;

  return (
    <div className="butler-session-history-panel">
      <div className="butler-session-history-header">
        <div className="butler-card-header-copy">
          <strong id={props.labelId}>{t("shell.butlerHistoryTitle")}</strong>
          <p>{t("shell.butlerHistoryDescription")}</p>
        </div>
      </div>
      <label className="butler-session-history-search">
        <span className="butler-session-history-search-icon" aria-hidden="true">
          <ButlerSearchIcon />
        </span>
        <input
          ref={props.searchInputRef}
          type="search"
          aria-label={t("shell.butlerHistorySearchLabel")}
          placeholder={t("shell.butlerHistorySearchPlaceholder")}
          value={props.query}
          onChange={(event) => {
            props.onQueryChange(event.target.value);
          }}
        />
      </label>
      {filteredSessions.length === 0 ? (
        <p className="butler-secondary-text">
          {isSearching ? t("shell.butlerHistorySearchEmpty") : t("shell.butlerHistoryEmpty")}
        </p>
      ) : (
        <div className="butler-session-history-list">
          {activeSessions.length > 0 ? (
            <div className="butler-session-history-section">
              <div className="butler-session-history-divider">
                <span>{t("shell.butlerHistoryActiveSection")}</span>
              </div>
              <ModalList compact className="butler-session-history-section-list" role="list">
                {activeSessions.map((item) => (
                  <ButlerControlHistoryRow
                    key={item.session.id}
                    session={item.session}
                    title={item.title}
                    preview={item.preview}
                    selected={item.session.id === props.activeControlSessionId}
                    deleting={props.deletingSessionId === item.session.id}
                    onSelectSession={props.onSelectSession}
                    onDeleteSession={props.onDeleteSession}
                  />
                ))}
              </ModalList>
            </div>
          ) : null}
          {inactiveSessions.length > 0 ? (
            <div className="butler-session-history-section">
              <div className="butler-session-history-divider" data-muted={activeSessions.length > 0}>
                <span>{t("shell.butlerHistoryInactiveSection")}</span>
              </div>
              <ModalList compact className="butler-session-history-section-list" role="list">
                {inactiveSessions.map((item) => (
                  <ButlerControlHistoryRow
                    key={item.session.id}
                    session={item.session}
                    title={item.title}
                    preview={item.preview}
                    selected={item.session.id === props.activeControlSessionId}
                    deleting={props.deletingSessionId === item.session.id}
                    onSelectSession={props.onSelectSession}
                    onDeleteSession={props.onDeleteSession}
                  />
                ))}
              </ModalList>
            </div>
          ) : null}
        </div>
      )}
    </div>
  );
}

function ButlerControlHistoryRow(props: {
  session: ButlerControlSessionDto;
  title: string;
  preview: string;
  selected: boolean;
  deleting: boolean;
  onSelectSession: (session: ButlerControlSessionDto) => Promise<void>;
  onDeleteSession: (session: ButlerControlSessionDto) => void;
}) {
  return (
    <ModalListItem
      as="div"
      role="listitem"
      className="butler-session-history-item"
      selected={props.selected}
      tabIndex={0}
      style={{
        paddingTop: "13px",
        paddingRight: "0",
        paddingBottom: "12px",
        paddingLeft: "24px"
      }}
      label={(
        <span className="butler-session-history-item-title" title={props.title}>
          {props.title}
        </span>
      )}
      description={(
        <span className="butler-session-history-item-preview" title={props.preview}>
          {props.preview}
        </span>
      )}
      trailing={(
        <div className="butler-session-history-item-trailing">
          <time
            className="butler-session-history-item-time"
            dateTime={props.session.updatedAt}
          >
            {formatTimestamp(props.session.updatedAt)}
          </time>
          <button
            type="button"
            className="secondary-button workbench-danger-button butler-session-history-delete-button"
            disabled={props.deleting}
            aria-label={t("shell.butlerHistoryDeleteAction")}
            onClick={(event) => {
              event.stopPropagation();
              props.onDeleteSession(props.session);
            }}
          >
            {props.deleting ? t("common.loading") : t("shell.deleteSessionAction")}
          </button>
        </div>
      )}
      aria-current={props.selected ? "true" : undefined}
      onClick={() => {
        void props.onSelectSession(props.session);
      }}
      onKeyDown={(event) => {
        if (event.key !== "Enter" && event.key !== " ") {
          return;
        }

        event.preventDefault();
        void props.onSelectSession(props.session);
      }}
    />
  );
}

function resolveControlSessionListTitle(session: ButlerControlSessionDto): string {
  return session.title?.trim()
    || session.session.title?.trim()
    || session.lastSummary?.trim()
    || session.sessionId;
}

function resolveControlSessionPreview(
  session: ButlerControlSessionDto,
  title: string
): string {
  const summary = session.lastSummary?.trim();

  if (summary) {
    return summary;
  }

  const sessionTitle = session.session.title?.trim();

  if (sessionTitle && sessionTitle !== title) {
    return sessionTitle;
  }

  return session.sessionId;
}

function ButlerSearchIcon() {
  return (
    <svg viewBox="0 0 16 16" fill="none" aria-hidden="true" focusable="false">
      <path
        fill="currentColor"
        d="M6.75 1.75a5 5 0 1 0 3.16 8.875l3.61 3.608a.75.75 0 1 0 1.06-1.06l-3.608-3.61A5 5 0 0 0 6.75 1.75Zm-3.5 5a3.5 3.5 0 1 1 7 0 3.5 3.5 0 0 1-7 0Z"
      />
    </svg>
  );
}

function ButlerSandboxManagerPanel(props: {
  items: AssistantSandboxDto[];
  selectedSandbox: AssistantSandboxDto | null;
  loading: boolean;
  actionSandboxId: string | null;
  onSelectSandbox: (sandboxId: string | null) => void;
  onReload: () => Promise<void>;
  onPromoteSandboxToProject: (sandboxId: string) => Promise<void>;
  onExpireSandbox: (sandboxId: string) => Promise<void>;
  onRemoveSandbox: (sandboxId: string) => Promise<void>;
}) {
  const sortedItems = useMemo(
    () => [...props.items].sort((left, right) => parseIsoTime(right.updatedAt) - parseIsoTime(left.updatedAt)),
    [props.items]
  );
  const currentSandbox = props.selectedSandbox ?? sortedItems[0] ?? null;
  const actionRunning = props.actionSandboxId === currentSandbox?.id;
  const canPromote = currentSandbox?.status === "active" && currentSandbox.visibility === "assistant_only";
  const canExpire = currentSandbox?.status === "active";
  const canRemove = currentSandbox?.status !== "deleted";

  return (
    <div className="butler-sandbox-panel">
      <section className="butler-side-card butler-sandbox-panel-card">
        <header className="butler-sandbox-current-header">
          <div className="butler-card-header-copy">
            <h2>{t("shell.butlerSandboxCurrentTitle")}</h2>
            <p>{t("shell.butlerSandboxCurrentPanelDescription")}</p>
          </div>
          <div className="butler-sandbox-header-actions">
            {currentSandbox && canPromote ? (
              <button
                type="button"
                className="secondary-button butler-automation-card-action"
                disabled={actionRunning}
                onClick={() => {
                  void props.onPromoteSandboxToProject(currentSandbox.id);
                }}
              >
                {actionRunning
                  ? t("shell.butlerSandboxActionRunning")
                  : t("shell.butlerSandboxPromoteAction")}
              </button>
            ) : null}
            {currentSandbox && canExpire ? (
              <button
                type="button"
                className="secondary-button butler-automation-card-action"
                disabled={actionRunning}
                onClick={() => {
                  void props.onExpireSandbox(currentSandbox.id);
                }}
              >
                {actionRunning
                  ? t("shell.butlerSandboxActionRunning")
                  : t("shell.butlerSandboxExpireAction")}
              </button>
            ) : null}
            {currentSandbox && canRemove ? (
              <button
                type="button"
                className="secondary-button workbench-danger-button butler-automation-card-action"
                disabled={actionRunning}
                onClick={() => {
                  void props.onRemoveSandbox(currentSandbox.id);
                }}
              >
                {actionRunning
                  ? t("shell.butlerSandboxActionRunning")
                  : t("shell.butlerSandboxRemoveAction")}
              </button>
            ) : null}
            <button
              type="button"
              className="secondary-button"
              disabled={props.loading}
              onClick={() => {
                void props.onReload();
              }}
            >
              {t("shell.butlerRefreshAction")}
            </button>
          </div>
        </header>
        {props.loading ? (
          <p className="butler-secondary-text">{t("shell.butlerSandboxLoading")}</p>
        ) : sortedItems.length === 0 ? (
          <p className="butler-secondary-text">{t("shell.butlerSandboxEmpty")}</p>
        ) : currentSandbox ? (
          <article className="butler-automation-card butler-sandbox-record" data-selected="true">
            <div className="butler-sandbox-record-top">
              <div className="butler-automation-card-title-group butler-sandbox-record-title">
                <strong>{currentSandbox.title}</strong>
                <span>{currentSandbox.workspace?.path ?? t("shell.butlerSandboxWorkspaceMissing")}</span>
              </div>
              <span
                className="butler-automation-status-badge"
                data-status={resolveAssistantSandboxBadgeStatus(currentSandbox.status)}
              >
                {resolveAssistantSandboxStatusLabel(currentSandbox.status)}
              </span>
            </div>
            <div className="butler-automation-card-body butler-sandbox-record-body">
              <div className="butler-automation-row butler-sandbox-record-meta">
                <span>{t("shell.butlerSandboxSourceKindLabel")}</span>
                <strong>{resolveAssistantSandboxSourceLabel(currentSandbox.sourceKind)}</strong>
              </div>
              <div className="butler-automation-row butler-sandbox-record-meta">
                <span>{t("shell.butlerSandboxVisibilityLabel")}</span>
                <strong>{resolveAssistantSandboxVisibilityLabel(currentSandbox.visibility)}</strong>
              </div>
              <div className="butler-automation-row butler-sandbox-record-meta">
                <span>{t("shell.butlerSandboxUpdatedAtLabel")}</span>
                <strong>{formatTimestamp(currentSandbox.updatedAt)}</strong>
              </div>
              <div className="butler-automation-row butler-sandbox-record-meta">
                <span>{t("shell.butlerSandboxPurposeLabel")}</span>
                <strong>{currentSandbox.purpose?.trim() || t("shell.butlerSandboxPurposeEmpty")}</strong>
              </div>
            </div>
          </article>
        ) : null}
      </section>

      <section className="butler-side-card butler-sandbox-panel-card butler-sandbox-files-card">
        <header>
          <div className="butler-card-header-copy">
            <h2>{t("shell.butlerSandboxFilesTitle")}</h2>
            <p>{t("shell.butlerSandboxFilesDescription")}</p>
          </div>
        </header>
        {!props.selectedSandbox ? (
          sortedItems.length > 0
            ? <p className="butler-secondary-text">{t("shell.butlerSandboxSelectHint")}</p>
            : null
        ) : (
          <div className="butler-sandbox-files-shell">
            <div className="butler-sandbox-files-meta">
              <div className="butler-automation-row butler-sandbox-files-meta-item">
                <span>{t("shell.butlerSandboxTitleLabel")}</span>
                <strong>{props.selectedSandbox.title}</strong>
              </div>
              <div className="butler-automation-row butler-sandbox-files-meta-item">
                <span>{t("shell.butlerSandboxWorkspaceLabel")}</span>
                <strong>{props.selectedSandbox.workspace?.path ?? t("shell.butlerSandboxWorkspaceMissing")}</strong>
              </div>
            </div>
            {props.selectedSandbox.workspace ? (
              <FileContextPanel
                className="butler-sandbox-file-context-panel"
                hideHeading
                hideTabs
                sessionId={null}
                workspaceId={props.selectedSandbox.workspaceId}
              />
            ) : (
              <p className="butler-secondary-text">{t("shell.butlerSandboxWorkspaceMissing")}</p>
            )}
          </div>
        )}
      </section>
    </div>
  );
}

function ButlerAllSandboxesPanel(props: {
  items: AssistantSandboxDto[];
  loading: boolean;
  actionSandboxId: string | null;
  selectedSandboxId: string | null;
  onViewSandbox: (sandboxId: string) => void;
  onRemoveSandbox: (sandboxId: string) => Promise<void>;
}) {
  const sortedItems = useMemo(
    () => [...props.items].sort((left, right) => parseIsoTime(right.updatedAt) - parseIsoTime(left.updatedAt)),
    [props.items]
  );

  if (props.loading) {
    return <p className="butler-secondary-text">{t("shell.butlerSandboxLoading")}</p>;
  }

  if (sortedItems.length === 0) {
    return <p className="butler-secondary-text">{t("shell.butlerSandboxLibraryEmpty")}</p>;
  }

  return (
    <ModalList className="butler-sandbox-browser-list" compact>
      {sortedItems.map((item) => {
        const actionRunning = props.actionSandboxId === item.id;

        return (
          <ModalListItem
            key={item.id}
            className="butler-sandbox-browser-item"
            selected={props.selectedSandboxId === item.id}
            label={item.title}
            description={item.workspace?.path ?? t("shell.butlerSandboxWorkspaceMissing")}
            trailing={(
              <div className="butler-sandbox-browser-actions">
                <span
                  className="butler-automation-status-badge"
                  data-status={resolveAssistantSandboxBadgeStatus(item.status)}
                >
                  {resolveAssistantSandboxStatusLabel(item.status)}
                </span>
                <button
                  type="button"
                  className="secondary-button"
                  onClick={() => {
                    props.onViewSandbox(item.id);
                  }}
                >
                  {t("shell.butlerSandboxOpenAction")}
                </button>
                <button
                  type="button"
                  className="secondary-button workbench-danger-button"
                  disabled={actionRunning}
                  onClick={() => {
                    void props.onRemoveSandbox(item.id);
                  }}
                >
                  {actionRunning
                    ? t("shell.butlerSandboxActionRunning")
                    : t("shell.butlerSandboxRemoveAction")}
                </button>
              </div>
            )}
          >
            <div className="butler-sandbox-browser-meta">
              <span>{resolveAssistantSandboxSourceLabel(item.sourceKind)}</span>
              <span>{resolveAssistantSandboxVisibilityLabel(item.visibility)}</span>
              <span>{formatTimestamp(item.updatedAt)}</span>
            </div>
          </ModalListItem>
        );
      })}
    </ModalList>
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
  schedule: ButlerControlScheduleBannerItem;
  currentWorkspaceId: string;
  currentWorkspaceName: string | null;
  projectNameById: Map<string, string>;
  workspaceNameById: Map<string, string>;
  sessionTitleById: Map<string, string>;
  sessionWorkspaceIdById: Map<string, string>;
  countdownNow: number;
  cancelling: boolean;
  skippingWait: boolean;
  executingNow: boolean;
  onCancel: () => void;
  onSkipWait: () => void;
  onExecuteNow: () => void;
  onOpenSession: () => void;
}) {
  const detailButtonId = useId();
  const detailPopoverId = useId();
  const detailRef = useRef<HTMLDivElement | null>(null);
  const detailPopoverRef = useRef<HTMLDivElement | null>(null);
  const [detailOpen, setDetailOpen] = useState(false);
  const countdownClockText = resolveControlScheduleClockLabel(props.schedule, props.countdownNow);
  const countdownLeadText = resolveControlScheduleCountdownLeadLabel(props.schedule, props.countdownNow);
  const countdownTailText = resolveControlScheduleCountdownTailLabel(props.schedule, props.countdownNow);
  const workspaceText = resolveControlScheduleWorkspaceLabel(
    props.schedule,
    props.projectNameById,
    props.workspaceNameById,
    props.currentWorkspaceId,
    props.currentWorkspaceName
  );
  const sessionText = resolveControlScheduleSessionLabel(props.schedule, props.sessionTitleById);
  const promptContent = resolveControlSchedulePromptContent(props.schedule);
  const canOpenSession = Boolean(
    resolveControlScheduleTargetSessionId(props.schedule)
    && (
      props.sessionWorkspaceIdById.has(resolveControlScheduleTargetSessionId(props.schedule)!)
      || readControlScheduleWorkspaceId(props.schedule)
    )
  );
  const canExecuteNow = canExecuteControlScheduleNow(props.schedule);
  const scheduleTypeText = resolveControlScheduleTypeLabel(props.schedule);
  const primaryActionLabel = canExecuteNow
    ? (props.executingNow
      ? t("shell.butlerControlTimerExecutingNow")
      : t("shell.butlerControlTimerExecuteNowAction"))
    : (props.skippingWait
      ? t("shell.butlerControlTimerCancelling")
      : t("shell.butlerControlTimerCancelAction"));
  const secondaryActionLabel = canExecuteNow
    ? (props.cancelling
      ? t("shell.butlerControlTimerCancelling")
      : t("shell.butlerControlTimerStopAction"))
    : (props.cancelling
      ? t("shell.butlerControlTimerCancelling")
      : t("shell.butlerControlTimerCancelOperationAction"));

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
            <span className="butler-control-timer-banner-caption">{scheduleTypeText}</span>
          </div>
          <div className="butler-control-timer-display-panel">
            <p className="butler-control-timer-banner-lead">{countdownLeadText}</p>
            <p className="butler-control-timer-display-clock">{countdownClockText}</p>
            <p className="butler-control-timer-banner-tail">{countdownTailText}</p>
          </div>
          <div className="butler-control-timer-banner-meta">
            <div className="butler-control-timer-banner-meta-card" data-kind="workspace">
              <span>{t("shell.butlerControlTimerWorkspaceLabel")}</span>
              <strong title={workspaceText}>{workspaceText}</strong>
            </div>
            <div className="butler-control-timer-banner-meta-card" data-kind="session">
              <span>{t("shell.butlerControlTimerSessionLabel")}</span>
              {canOpenSession ? (
                <button
                  type="button"
                  className="butler-control-timer-session-link"
                  title={sessionText}
                  aria-label={`${t("shell.butlerControlTimerSessionLabel")}：${sessionText}`}
                  onClick={props.onOpenSession}
                >
                  {sessionText}
                </button>
              ) : (
                <strong title={sessionText}>{sessionText}</strong>
              )}
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
            disabled={props.cancelling || props.executingNow || props.skippingWait}
            onClick={canExecuteNow ? props.onExecuteNow : props.onSkipWait}
          >
            {primaryActionLabel}
          </button>
          <button
            type="button"
            className="secondary-button butler-control-timer-banner-action"
            disabled={props.cancelling || props.executingNow || props.skippingWait}
            onClick={props.onCancel}
          >
            {secondaryActionLabel}
          </button>
        </div>
        {canExecuteNow ? (
          <p className="butler-control-timer-banner-note">
            {t("shell.butlerControlTimerActionNote")}
          </p>
        ) : null}
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
  automationId: string;
  kind: "assistant_automation_run";
  title: string;
  projectName: string;
  status: "active" | "waiting_user" | "completed" | "failed" | "cancelled";
  sourceLabel: string;
  statusLabel: string;
  summary: string;
  createdAt: string;
}

type ButlerControlScheduleBannerItem =
  | {
      kind: "timer";
      timer: ButlerControlTimerDto;
    }
  | {
      kind: "automation";
      automation: AssistantAutomationTaskDto;
    };

function useStableControlSchedule(
  schedule: ButlerControlScheduleBannerItem | null
): ButlerControlScheduleBannerItem | null {
  const [visibleSchedule, setVisibleSchedule] = useState<ButlerControlScheduleBannerItem | null>(
    schedule
  );
  const hideTimerRef = useRef<number | null>(null);

  useEffect(() => {
    if (schedule) {
      if (hideTimerRef.current !== null) {
        window.clearTimeout(hideTimerRef.current);
        hideTimerRef.current = null;
      }

      setVisibleSchedule(schedule);
      return;
    }

    if (!visibleSchedule || hideTimerRef.current !== null) {
      return;
    }

    // 吃掉 runtime 边界抖动，避免计时 banner 在一两帧内反复闪烁。
    hideTimerRef.current = window.setTimeout(() => {
      hideTimerRef.current = null;
      setVisibleSchedule(null);
    }, CONTROL_SCHEDULE_HIDE_DELAY_MS);
  }, [schedule, visibleSchedule]);

  useEffect(() => {
    return () => {
      if (hideTimerRef.current !== null) {
        window.clearTimeout(hideTimerRef.current);
      }
    };
  }, []);

  return schedule ?? visibleSchedule;
}

function useStableButlerRuntimeActive(sessionId: string | null, active: boolean): boolean {
  const [visible, setVisible] = useState(active);
  const hideTimerRef = useRef<number | null>(null);

  useEffect(() => {
    if (hideTimerRef.current !== null) {
      window.clearTimeout(hideTimerRef.current);
      hideTimerRef.current = null;
    }

    setVisible(active);
  }, [sessionId]);

  useEffect(() => {
    if (active) {
      if (hideTimerRef.current !== null) {
        window.clearTimeout(hideTimerRef.current);
        hideTimerRef.current = null;
      }

      setVisible(true);
      return;
    }

    if (!visible || hideTimerRef.current !== null) {
      return;
    }

    hideTimerRef.current = window.setTimeout(() => {
      hideTimerRef.current = null;
      setVisible(false);
    }, BUTLER_RUNTIME_ACTIVE_HIDE_DELAY_MS);
  }, [active, visible]);

  useEffect(() => {
    return () => {
      if (hideTimerRef.current !== null) {
        window.clearTimeout(hideTimerRef.current);
      }
    };
  }, []);

  return visible;
}

function hasButlerActiveRuntimeIndicator(
  controlSession: ButlerControlSessionDto | null,
  runtimeHasActiveRun: boolean | null
): boolean {
  if (runtimeHasActiveRun === true) {
    return true;
  }

  if (!controlSession) {
    return false;
  }

  return (
    controlSession.session.activityState === "running"
    || controlSession.session.runningState === "starting"
    || controlSession.session.runningState === "running"
    || controlSession.session.runningState === "reconnecting"
  );
}

function AutomationTaskOverviewCard(props: {
  items: AutomationTaskItem[];
  cancellingAutomationId: string | null;
  onCancelAutomation: (automationId: string) => Promise<void>;
  onOpenAutomationDetail: (automationId: string) => void;
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
        <div className="butler-automation-overview-list">
          {props.items.map((item) => (
            <article
              key={item.id}
              className="butler-automation-card butler-automation-overview-card"
              data-kind="task"
            >
              <header className="butler-automation-card-header">
                <div className="butler-automation-card-title-group">
                  <strong>{item.title}</strong>
                  <span>{item.projectName}</span>
                </div>
                <span className="butler-automation-status-badge" data-status={item.status}>
                  {item.statusLabel}
                </span>
              </header>
              <div className="butler-automation-overview-inline">
                <span className="butler-automation-overview-chip">{item.taskTypeLabel}</span>
                <span className="butler-automation-overview-inline-meta">
                  {t("shell.butlerAutomationTaskNextRunLabel")} · {formatIsoDateTime(item.nextRunAt)}
                </span>
                <span className="butler-automation-overview-inline-meta">
                  {t("shell.butlerAutomationTaskLastRunLabel")} · {formatIsoDateTime(item.lastRunAt)}
                </span>
              </div>
              <footer className="butler-automation-card-footer">
                {item.automationId ? (
                  <button
                    type="button"
                    className="secondary-button butler-automation-card-action"
                    onClick={() => {
                      props.onOpenAutomationDetail(item.automationId!);
                    }}
                  >
                    {t("shell.butlerAutomationOpenDetailsAction")}
                  </button>
                ) : null}
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
  onOpenAutomationDetail: (automationId: string) => void;
}) {
  return (
    <section className="butler-side-card">
      <header>
        <h2>{t("shell.butlerAutomationRunsTitle")}</h2>
      </header>
      {props.items.length > 0 ? (
        <div className="butler-automation-overview-list">
          {props.items.map((item) => (
            <article
              key={item.id}
              className="butler-automation-card butler-automation-overview-card"
              data-kind="run"
            >
              <header className="butler-automation-card-header">
                <div className="butler-automation-card-title-group">
                  <strong>{item.title}</strong>
                  <span>{item.projectName}</span>
                </div>
                <span className="butler-automation-status-badge" data-status={item.status}>
                  {item.statusLabel}
                </span>
              </header>
              <div className="butler-automation-overview-inline">
                <span className="butler-automation-overview-chip">{item.sourceLabel}</span>
                <span className="butler-automation-overview-inline-meta">
                  {t("shell.butlerAutomationRunProcessedAtLabel")} · {formatIsoDateTime(item.createdAt)}
                </span>
              </div>
              <footer className="butler-automation-card-footer">
                <button
                  type="button"
                  className="secondary-button butler-automation-card-action"
                  onClick={() => {
                    props.onOpenAutomationDetail(item.automationId);
                  }}
                >
                  {t("shell.butlerAutomationOpenDetailsAction")}
                </button>
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

function AutomationDetailModalPanel(props: {
  automation: AssistantAutomationTaskDto;
  editorState: AutomationEditorState;
  saving: boolean;
  projectName: string;
  targetSessionTitle: string | null;
  recentRuns: AssistantAutomationRunDto[];
  onEditorChange: (patch: Partial<AutomationEditorState>) => void;
  onSave: () => void;
}) {
  return (
    <div className="butler-automation-detail-shell">
      <section className="butler-automation-detail-summary-grid">
        <div className="butler-automation-detail-summary-card">
          <span>{t("shell.butlerAutomationTaskTypeLabel")}</span>
          <strong>{resolveAutomationTaskTypeLabel(props.automation.triggerType)}</strong>
        </div>
        <div className="butler-automation-detail-summary-card">
          <span>{t("shell.butlerAutomationStatusLabel")}</span>
          <strong>{resolveAssistantAutomationTaskStatusLabel(props.automation.status)}</strong>
        </div>
        <div className="butler-automation-detail-summary-card">
          <span>{t("shell.butlerAutomationTaskNextRunLabel")}</span>
          <strong>{formatIsoDateTime(props.automation.nextRunAt)}</strong>
        </div>
        <div className="butler-automation-detail-summary-card">
          <span>{t("shell.butlerAutomationTaskLastRunLabel")}</span>
          <strong>{formatIsoDateTime(props.automation.lastRunAt || props.automation.updatedAt)}</strong>
        </div>
        <div className="butler-automation-detail-summary-card">
          <span>{t("shell.butlerControlTimerWorkspaceLabel")}</span>
          <strong>{props.projectName}</strong>
        </div>
        {props.targetSessionTitle ? (
          <div className="butler-automation-detail-summary-card">
            <span>{t("shell.butlerAutomationTargetSessionLabel")}</span>
            <strong>{props.targetSessionTitle}</strong>
          </div>
        ) : null}
      </section>

      <section className="butler-side-card butler-automation-detail-section">
        <header>
          <h2>{t("shell.butlerAutomationDetailTitle")}</h2>
        </header>
        <div className="butler-automation-detail-form-grid">
          <label className="butler-form-field">
            <span>{t("shell.butlerAutomationTitleLabel")}</span>
            <input
              className="butler-form-control"
              value={props.editorState.title}
              disabled={props.saving}
              onChange={(event) => {
                props.onEditorChange({
                  title: event.target.value
                });
              }}
            />
          </label>
          <label className="butler-form-field butler-form-field-wide">
            <span>{t("shell.butlerAutomationPromptLabel")}</span>
            <textarea
              className="butler-form-control butler-automation-detail-textarea"
              value={props.editorState.content}
              disabled={props.saving}
              onChange={(event) => {
                props.onEditorChange({
                  content: event.target.value
                });
              }}
            />
          </label>
          <label className="butler-automation-detail-toggle">
            <input
              type="checkbox"
              checked={props.editorState.includeTriggerContext}
              disabled={props.saving}
              onChange={(event) => {
                props.onEditorChange({
                  includeTriggerContext: event.target.checked
                });
              }}
            />
            <span>{t("shell.butlerAutomationIncludeTriggerContextLabel")}</span>
          </label>
          <AutomationScheduleFields
            automation={props.automation}
            editorState={props.editorState}
            saving={props.saving}
            onEditorChange={props.onEditorChange}
          />
        </div>
        <div className="butler-automation-detail-actions">
          <button
            type="button"
            className="primary-button"
            disabled={props.saving}
            onClick={props.onSave}
          >
            {props.saving ? t("shell.butlerAutomationSaving") : t("shell.butlerAutomationSaveAction")}
          </button>
        </div>
      </section>

      <section className="butler-side-card butler-automation-detail-section">
        <header>
          <h2>{t("shell.butlerAutomationRunsTitle")}</h2>
        </header>
        {props.recentRuns.length > 0 ? (
          <div className="butler-automation-detail-run-list">
            {props.recentRuns.map((run) => (
              <article key={run.id} className="butler-automation-detail-run-card">
                <header>
                  <strong>{t("shell.butlerAutomationRoundLabel", { round: run.runSeq })}</strong>
                  <span className="butler-automation-status-badge" data-status={normalizeAutomationRunStatus(run.status)}>
                    {resolveAssistantAutomationRunStatusLabel(run.status)}
                  </span>
                </header>
                <div className="butler-automation-detail-run-meta">
                  <span>{resolveAutomationRunSourceLabel(run.triggerType)}</span>
                  <span>{formatIsoDateTime(run.finishedAt || run.startedAt || run.createdAt)}</span>
                </div>
                <p>{run.summary?.trim() || run.error?.trim() || t("shell.butlerAutomationRunEmptySummary")}</p>
              </article>
            ))}
          </div>
        ) : (
          <p className="butler-secondary-text">{t("shell.butlerAutomationRunsEmpty")}</p>
        )}
      </section>
    </div>
  );
}

function AutomationScheduleFields(props: {
  automation: AssistantAutomationTaskDto;
  editorState: AutomationEditorState;
  saving: boolean;
  onEditorChange: (patch: Partial<AutomationEditorState>) => void;
}) {
  const { triggerConfig } = props.automation;

  if (triggerConfig.type === "once") {
    return (
      <label className="butler-form-field">
        <span>{t("shell.butlerAutomationDueAtLabel")}</span>
        <input
          type="datetime-local"
          className="butler-form-control"
          value={props.editorState.dueAt}
          disabled={props.saving}
          onChange={(event) => {
            props.onEditorChange({
              dueAt: event.target.value
            });
          }}
        />
      </label>
    );
  }

  if (triggerConfig.type === "interval") {
    return (
      <>
        <label className="butler-form-field">
          <span>{t("shell.butlerAutomationEverySecondsLabel")}</span>
          <input
            inputMode="numeric"
            className="butler-form-control"
            value={props.editorState.everySeconds}
            disabled={props.saving}
            onChange={(event) => {
              props.onEditorChange({
                everySeconds: event.target.value
              });
            }}
          />
        </label>
        <label className="butler-form-field">
          <span>{t("shell.butlerAutomationEveryMinutesLabel")}</span>
          <input
            inputMode="numeric"
            className="butler-form-control"
            value={props.editorState.everyMinutes}
            disabled={props.saving}
            onChange={(event) => {
              props.onEditorChange({
                everyMinutes: event.target.value
              });
            }}
          />
        </label>
        <label className="butler-form-field">
          <span>{t("shell.butlerAutomationEveryHoursLabel")}</span>
          <input
            inputMode="numeric"
            className="butler-form-control"
            value={props.editorState.everyHours}
            disabled={props.saving}
            onChange={(event) => {
              props.onEditorChange({
                everyHours: event.target.value
              });
            }}
          />
        </label>
        <label className="butler-form-field">
          <span>{t("shell.butlerAutomationStopAtLabel")}</span>
          <input
            type="datetime-local"
            className="butler-form-control"
            value={props.editorState.stopAt}
            disabled={props.saving}
            onChange={(event) => {
              props.onEditorChange({
                stopAt: event.target.value
              });
            }}
          />
        </label>
      </>
    );
  }

  if (triggerConfig.type === "cron") {
    return (
      <>
        <label className="butler-form-field">
          <span>{t("shell.butlerAutomationCronMinuteLabel")}</span>
          <input
            inputMode="numeric"
            className="butler-form-control"
            value={props.editorState.cronMinute}
            disabled={props.saving}
            onChange={(event) => {
              props.onEditorChange({
                cronMinute: event.target.value
              });
            }}
          />
        </label>
        <label className="butler-form-field">
          <span>{t("shell.butlerAutomationCronHourLabel")}</span>
          <input
            inputMode="numeric"
            className="butler-form-control"
            value={props.editorState.cronHour}
            disabled={props.saving}
            onChange={(event) => {
              props.onEditorChange({
                cronHour: event.target.value
              });
            }}
          />
        </label>
        <label className="butler-form-field butler-form-field-wide">
          <span>{t("shell.butlerAutomationCronDaysOfWeekLabel")}</span>
          <input
            className="butler-form-control"
            value={props.editorState.cronDaysOfWeek}
            disabled={props.saving}
            onChange={(event) => {
              props.onEditorChange({
                cronDaysOfWeek: event.target.value
              });
            }}
          />
        </label>
        <label className="butler-form-field">
          <span>{t("shell.butlerAutomationStopAtLabel")}</span>
          <input
            type="datetime-local"
            className="butler-form-control"
            value={props.editorState.stopAt}
            disabled={props.saving}
            onChange={(event) => {
              props.onEditorChange({
                stopAt: event.target.value
              });
            }}
          />
        </label>
      </>
    );
  }

  return (
    <>
      <label className="butler-form-field">
        <span>{t("shell.butlerAutomationPollIntervalLabel")}</span>
        <input
          inputMode="numeric"
          className="butler-form-control"
          value={props.editorState.pollIntervalSeconds}
          disabled={props.saving}
          onChange={(event) => {
            props.onEditorChange({
              pollIntervalSeconds: event.target.value
            });
          }}
        />
      </label>
      <label className="butler-form-field">
        <span>{t("shell.butlerAutomationMaxChecksLabel")}</span>
        <input
          inputMode="numeric"
          className="butler-form-control"
          value={props.editorState.maxChecks}
          disabled={props.saving}
          onChange={(event) => {
            props.onEditorChange({
              maxChecks: event.target.value
            });
          }}
        />
      </label>
      <label className="butler-form-field">
        <span>{t("shell.butlerAutomationExpiresAtLabel")}</span>
        <input
          type="datetime-local"
          className="butler-form-control"
          value={props.editorState.expiresAt}
          disabled={props.saving}
          onChange={(event) => {
            props.onEditorChange({
              expiresAt: event.target.value
            });
          }}
        />
      </label>
    </>
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

function activeControlScheduleId(item: ButlerControlScheduleBannerItem): string {
  return item.kind === "timer" ? item.timer.id : item.automation.id;
}

function readControlScheduleDueAt(item: ButlerControlScheduleBannerItem): string | null {
  return item.kind === "timer" ? item.timer.dueAt : item.automation.nextRunAt;
}

function readControlScheduleWorkspaceId(item: ButlerControlScheduleBannerItem): string | null {
  return item.kind === "timer"
    ? item.timer.controlSession?.session?.workspaceId?.trim() || null
    : item.automation.controlSession?.session?.workspaceId?.trim() || null;
}

function resolveControlScheduleTargetSessionId(item: ButlerControlScheduleBannerItem): string | null {
  if (item.kind === "timer") {
    return item.timer.targetSessionId?.trim()
      || item.timer.controlSession?.session?.sessionId?.trim()
      || item.timer.sessionId?.trim()
      || null;
  }

  return item.automation.actionConfig.targetSessionId?.trim()
    || item.automation.controlSession?.session?.sessionId?.trim()
    || item.automation.controlSession?.sessionId?.trim()
    || null;
}

function canExecuteControlScheduleNow(item: ButlerControlScheduleBannerItem): boolean {
  return item.kind === "timer" || item.automation.triggerType === "once";
}

function resolveControlScheduleCountdownLabel(
  item: ButlerControlScheduleBannerItem,
  nowMs: number
): string {
  const dueMs = parseIsoTime(readControlScheduleDueAt(item));

  if (!dueMs || dueMs <= nowMs) {
    return t("shell.butlerControlTimerCountdownDueNow");
  }

  return t("shell.butlerControlTimerCountdownActive", {
    duration: formatDurationLabel(dueMs - nowMs)
  });
}

function resolveControlScheduleCountdownLeadLabel(
  item: ButlerControlScheduleBannerItem,
  nowMs: number
): string {
  const dueMs = parseIsoTime(readControlScheduleDueAt(item));

  if (!dueMs || dueMs <= nowMs) {
    return t("shell.butlerControlTimerCountdownDueLead");
  }

  return t("shell.butlerControlTimerCountdownLead");
}

function resolveControlScheduleCountdownTailLabel(
  item: ButlerControlScheduleBannerItem,
  nowMs: number
): string {
  const dueMs = parseIsoTime(readControlScheduleDueAt(item));

  if (!dueMs || dueMs <= nowMs) {
    return t("shell.butlerControlTimerCountdownDueTail");
  }

  return t("shell.butlerControlTimerCountdownTail");
}

function resolveControlScheduleClockLabel(
  item: ButlerControlScheduleBannerItem,
  nowMs: number
): string {
  const dueMs = parseIsoTime(readControlScheduleDueAt(item));

  if (!dueMs || dueMs <= nowMs) {
    return "00:00";
  }

  return formatDigitalDurationLabel(dueMs - nowMs);
}

function resolveControlSchedulePromptContent(item: ButlerControlScheduleBannerItem): string {
  return item.kind === "timer"
    ? resolveControlTimerPromptContent(item.timer)
    : item.automation.actionConfig.content.trim() || t("conversation.butlerAnalysisEmpty");
}

function resolveControlScheduleTypeLabel(item: ButlerControlScheduleBannerItem): string {
  if (item.kind === "timer") {
    return t("shell.butlerControlTimerTypeOnce");
  }

  switch (item.automation.triggerType) {
    case "once":
      return t("shell.butlerControlTimerTypeOnce");
    case "interval":
    case "cron":
      return t("shell.butlerControlTimerTypeRepeat");
    case "condition":
      return t("shell.butlerControlTimerTypeConditional");
    default:
      return t("shell.butlerControlTimerTypeOther");
  }
}

function buildAutomationTaskItems(
  automations: AssistantAutomationTaskDto[],
  overview: ButlerOverviewDto | null,
  mode: "active" | "history" = "active"
): AutomationTaskItem[] {
  const projectNameById = new Map(
    (overview?.projects ?? []).map((project) => [project.id, project.name] as const)
  );
  const items = automations
    .filter((automation) => (
      mode === "history"
        ? automation.status !== "active"
        : automation.status === "active"
    ))
    .map<AutomationTaskItem>((automation) => ({
      id: `assistant-automation:${automation.id}`,
      automationId: automation.id,
      kind: "assistant_automation",
      title: resolveAssistantAutomationTitle(automation),
      projectName: resolveAssistantAutomationProjectName(automation, projectNameById),
      status: normalizeAutomationTaskStatus(automation.status),
      taskTypeLabel: resolveAutomationTaskTypeLabel(automation.triggerType),
      statusLabel: resolveAssistantAutomationTaskStatusLabel(automation.status),
      nextRunAt: automation.nextRunAt,
      lastRunAt: automation.lastRunAt || automation.updatedAt
    }));

  return items
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
  automations: AssistantAutomationTaskDto[],
  runs: AssistantAutomationRunDto[],
  overview: ButlerOverviewDto | null,
  mode: "active" | "history" = "active"
): AutomationRunItem[] {
  const isActiveRunStatus = (status: AutomationRunItem["status"]): boolean =>
    status === "active" || status === "waiting_user";
  const projectNameById = new Map(
    (overview?.projects ?? []).map((project) => [project.id, project.name] as const)
  );
  const automationById = new Map(automations.map((automation) => [automation.id, automation] as const));
  const automationRunItems = runs
    .map((run) => {
      const automation = automationById.get(run.automationId);

      return {
        run,
        automation,
        normalizedStatus: normalizeAutomationRunStatus(run.status)
      };
    })
    .filter(({ automation }) => Boolean(automation))
    .filter(({ normalizedStatus }) => (
      mode === "history"
        ? !isActiveRunStatus(normalizedStatus)
        : isActiveRunStatus(normalizedStatus)
    ))
    .map<AutomationRunItem>(({ run, automation, normalizedStatus }) => ({
      id: `assistant-automation-run:${run.id}`,
      automationId: run.automationId,
      kind: "assistant_automation_run",
      title: resolveAssistantAutomationTitle(automation!),
      projectName: resolveAssistantAutomationProjectName(automation!, projectNameById),
      status: normalizedStatus,
      sourceLabel: resolveAutomationRunSourceLabel(run.triggerType),
      statusLabel: resolveAssistantAutomationRunStatusLabel(run.status),
      summary: run.summary?.trim() || run.error?.trim() || t("shell.butlerAutomationRunEmptySummary"),
      createdAt: run.finishedAt || run.startedAt || run.createdAt
    }));

  return automationRunItems
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

function resolveControlScheduleWorkspaceLabel(
  item: ButlerControlScheduleBannerItem,
  projectNameById: Map<string, string>,
  workspaceNameById: Map<string, string>,
  currentWorkspaceId: string,
  currentWorkspaceName: string | null
): string {
  if (item.kind === "timer") {
    return resolveControlTimerWorkspaceLabel(
      item.timer,
      projectNameById,
      workspaceNameById,
      currentWorkspaceId,
      currentWorkspaceName
    );
  }

  const projectId = item.automation.projectId?.trim();

  if (projectId && projectNameById.has(projectId)) {
    return projectNameById.get(projectId)!;
  }

  const workspaceId = readControlScheduleWorkspaceId(item) || currentWorkspaceId.trim();

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

function resolveControlScheduleSessionLabel(
  item: ButlerControlScheduleBannerItem,
  sessionTitleById: Map<string, string>
): string {
  if (item.kind === "timer") {
    return resolveControlTimerSessionLabel(item.timer, sessionTitleById);
  }

  const targetSessionId = resolveControlScheduleTargetSessionId(item);

  if (targetSessionId && sessionTitleById.has(targetSessionId)) {
    return sessionTitleById.get(targetSessionId)!;
  }

  if (item.automation.controlSession?.session?.title?.trim()) {
    return item.automation.controlSession.session.title.trim();
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

function toEditableNumber(value: number | null | undefined): string {
  return typeof value === "number" && Number.isFinite(value) ? String(value) : "";
}

function normalizeTextInput(value: string): string | null {
  const normalized = value.trim();
  return normalized ? normalized : null;
}

function formatIsoForDateTimeInput(value: string | null | undefined): string {
  if (!value) {
    return "";
  }

  const date = new Date(value);

  if (Number.isNaN(date.getTime())) {
    return "";
  }

  const year = date.getFullYear();
  const month = String(date.getMonth() + 1).padStart(2, "0");
  const day = String(date.getDate()).padStart(2, "0");
  const hours = String(date.getHours()).padStart(2, "0");
  const minutes = String(date.getMinutes()).padStart(2, "0");
  return `${year}-${month}-${day}T${hours}:${minutes}`;
}

function parseNullableDateTimeInput(value: string, label: string): string | null {
  const normalized = value.trim();

  if (!normalized) {
    return null;
  }

  const timestamp = Date.parse(normalized);

  if (Number.isNaN(timestamp)) {
    throw new Error(`${label}${t("shell.butlerAutomationInvalidDateSuffix")}`);
  }

  return new Date(timestamp).toISOString();
}

function parseRequiredDateTimeInput(value: string, label: string): string {
  const normalized = parseNullableDateTimeInput(value, label);

  if (!normalized) {
    throw new Error(`${label}${t("shell.butlerAutomationRequiredSuffix")}`);
  }

  return normalized;
}

function parseRequiredInteger(value: string, label: string): number {
  const normalized = value.trim();

  if (!normalized) {
    throw new Error(`${label}${t("shell.butlerAutomationRequiredSuffix")}`);
  }

  const parsed = Number.parseInt(normalized, 10);

  if (!Number.isInteger(parsed)) {
    throw new Error(`${label}${t("shell.butlerAutomationInvalidNumberSuffix")}`);
  }

  return parsed;
}

function parseOptionalInteger(value: string, label: string): number | null {
  const normalized = value.trim();

  if (!normalized) {
    return null;
  }

  const parsed = Number.parseInt(normalized, 10);

  if (!Number.isInteger(parsed)) {
    throw new Error(`${label}${t("shell.butlerAutomationInvalidNumberSuffix")}`);
  }

  return parsed;
}

function parseOptionalPositiveInteger(value: string, label: string): number | null {
  const parsed = parseOptionalInteger(value, label);

  if (parsed === null) {
    return null;
  }

  if (parsed <= 0) {
    throw new Error(`${label}${t("shell.butlerAutomationInvalidPositiveNumberSuffix")}`);
  }

  return parsed;
}

function parseRequiredPositiveInteger(value: string, label: string): number {
  const parsed = parseRequiredInteger(value, label);

  if (parsed <= 0) {
    throw new Error(`${label}${t("shell.butlerAutomationInvalidPositiveNumberSuffix")}`);
  }

  return parsed;
}

function parseCronDaysOfWeekInput(value: string): number[] | null {
  const normalized = value.trim();

  if (!normalized) {
    return null;
  }

  const parsed = normalized
    .split(",")
    .map((item) => Number.parseInt(item.trim(), 10))
    .filter((item) => Number.isInteger(item));

  if (parsed.length === 0 || parsed.some((item) => item < 0 || item > 6)) {
    throw new Error(t("shell.butlerAutomationCronDaysValidation"));
  }

  return Array.from(new Set(parsed)).sort((left, right) => left - right);
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
  triggerType: AssistantAutomationTaskDto["triggerType"]
): string {
  switch (triggerType) {
    case "once":
      return t("shell.butlerAutomationTaskTypeControlTimer");
    case "interval":
      return t("shell.butlerAutomationTaskTypeInterval");
    case "cron":
      return t("shell.butlerAutomationTaskTypeCron");
    case "condition":
      return t("shell.butlerAutomationTaskTypeFollowUp");
    default:
      return t("shell.butlerAutomationTaskTypeControlTimer");
  }
}

function resolveAutomationRunSourceLabel(
  triggerType: AssistantAutomationRunDto["triggerType"]
): string {
  if (triggerType === "interval" || triggerType === "cron") {
    return t("shell.butlerAutomationRunSourcePatrol");
  }

  if (triggerType === "once") {
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

function normalizeAutomationTaskStatus(status: AssistantAutomationTaskDto["status"]): AutomationTaskItem["status"] {
  switch (status) {
    case "failed":
      return "failed";
    case "cancelled":
      return "cancelled";
    case "completed":
      return "completed";
    case "paused":
      return "waiting_user";
    case "active":
    default:
      return "active";
  }
}

function resolveAssistantAutomationTaskStatusLabel(
  status: AssistantAutomationTaskDto["status"]
): string {
  switch (status) {
    case "completed":
      return t("shell.butlerAutomationStatusCompleted");
    case "failed":
      return t("shell.butlerAutomationStatusFailed");
    case "cancelled":
      return t("shell.butlerAutomationStatusCancelled");
    case "paused":
      return t("shell.butlerAutomationStatusWaitingUser");
    case "active":
    default:
      return t("shell.butlerAutomationStatusActive");
  }
}

function resolveAssistantAutomationRunStatusLabel(
  status: AssistantAutomationRunDto["status"]
): string {
  switch (status) {
    case "succeeded":
      return t("shell.butlerAutomationStatusCompleted");
    case "failed":
      return t("shell.butlerAutomationStatusFailed");
    case "cancelled":
    case "skipped":
      return t("shell.butlerAutomationStatusCancelled");
    case "queued":
    case "running":
    default:
      return t("shell.butlerAutomationStatusActive");
  }
}

function resolveAssistantAutomationTitle(automation: AssistantAutomationTaskDto): string {
  return automation.title?.trim()
    || automation.actionConfig.targetSessionId?.trim()
    || automation.actionConfig.content.trim()
    || automation.id;
}

function resolveAssistantAutomationProjectName(
  automation: AssistantAutomationTaskDto,
  projectNameById: Map<string, string>
): string {
  if (automation.projectId && projectNameById.has(automation.projectId)) {
    return projectNameById.get(automation.projectId)!;
  }

  return automation.controlSession?.session?.workspaceId || t("shell.butlerControlTimerNoProject");
}

function resolveAutomationTargetSessionLabel(
  automation: AssistantAutomationTaskDto,
  sessionTitleById: ReadonlyMap<string, string>
): string | null {
  const targetSessionId = automation.actionConfig.targetSessionId?.trim();

  if (targetSessionId && sessionTitleById.has(targetSessionId)) {
    return sessionTitleById.get(targetSessionId)!;
  }

  if (automation.controlSession?.title?.trim()) {
    return automation.controlSession.title.trim();
  }

  if (targetSessionId) {
    return targetSessionId;
  }

  return null;
}

function createAutomationEditorState(automation: AssistantAutomationTaskDto): AutomationEditorState {
  const editorState: AutomationEditorState = {
    title: automation.title?.trim() || "",
    content: automation.actionConfig.content,
    includeTriggerContext: automation.actionConfig.includeTriggerContext,
    dueAt: "",
    everySeconds: "",
    everyMinutes: "",
    everyHours: "",
    stopAt: "",
    cronMinute: "",
    cronHour: "",
    cronDaysOfWeek: "",
    pollIntervalSeconds: "",
    expiresAt: "",
    maxChecks: ""
  };

  if (automation.triggerConfig.type === "once") {
    editorState.dueAt = formatIsoForDateTimeInput(automation.triggerConfig.dueAt);
  } else if (automation.triggerConfig.type === "interval") {
    editorState.everySeconds = toEditableNumber(automation.triggerConfig.seconds);
    editorState.everyMinutes = toEditableNumber(automation.triggerConfig.minutes);
    editorState.everyHours = toEditableNumber(automation.triggerConfig.hours);
    editorState.stopAt = formatIsoForDateTimeInput(automation.triggerConfig.stopAt);
  } else if (automation.triggerConfig.type === "cron") {
    editorState.cronMinute = toEditableNumber(automation.triggerConfig.minute);
    editorState.cronHour = toEditableNumber(automation.triggerConfig.hour);
    editorState.cronDaysOfWeek = (automation.triggerConfig.daysOfWeek ?? []).join(",");
    editorState.stopAt = formatIsoForDateTimeInput(automation.triggerConfig.stopAt);
  } else {
    editorState.pollIntervalSeconds = toEditableNumber(automation.triggerConfig.pollIntervalSeconds);
    editorState.expiresAt = formatIsoForDateTimeInput(automation.triggerConfig.expiresAt);
    editorState.maxChecks = toEditableNumber(automation.triggerConfig.maxChecks);
  }

  return editorState;
}

function buildAutomationUpdatePayload(
  automation: AssistantAutomationTaskDto,
  editorState: AutomationEditorState
): {
  title: string | null;
  content: string;
  includeTriggerContext: boolean;
  dueAt?: string | null;
  everySeconds?: number | null;
  everyMinutes?: number | null;
  everyHours?: number | null;
  stopAt?: string | null;
  cronMinute?: number | null;
  cronHour?: number | null;
  cronDaysOfWeek?: number[] | null;
  pollIntervalSeconds?: number | null;
  expiresAt?: string | null;
  maxChecks?: number | null;
} {
  const payload = {
    title: normalizeTextInput(editorState.title),
    content: editorState.content.trim(),
    includeTriggerContext: editorState.includeTriggerContext
  };

  if (!payload.content) {
    throw new Error(t("shell.butlerAutomationPromptRequired"));
  }

  if (automation.triggerConfig.type === "once") {
    return {
      ...payload,
      dueAt: parseRequiredDateTimeInput(editorState.dueAt, t("shell.butlerAutomationDueAtLabel"))
    };
  }

  if (automation.triggerConfig.type === "interval") {
    return {
      ...payload,
      everySeconds: parseOptionalPositiveInteger(editorState.everySeconds, t("shell.butlerAutomationEverySecondsLabel")),
      everyMinutes: parseOptionalPositiveInteger(editorState.everyMinutes, t("shell.butlerAutomationEveryMinutesLabel")),
      everyHours: parseOptionalPositiveInteger(editorState.everyHours, t("shell.butlerAutomationEveryHoursLabel")),
      stopAt: parseNullableDateTimeInput(editorState.stopAt, t("shell.butlerAutomationStopAtLabel"))
    };
  }

  if (automation.triggerConfig.type === "cron") {
    return {
      ...payload,
      cronMinute: parseRequiredInteger(editorState.cronMinute, t("shell.butlerAutomationCronMinuteLabel")),
      cronHour: parseOptionalInteger(editorState.cronHour, t("shell.butlerAutomationCronHourLabel")),
      cronDaysOfWeek: parseCronDaysOfWeekInput(editorState.cronDaysOfWeek),
      stopAt: parseNullableDateTimeInput(editorState.stopAt, t("shell.butlerAutomationStopAtLabel"))
    };
  }

  return {
    ...payload,
    pollIntervalSeconds: parseRequiredPositiveInteger(
      editorState.pollIntervalSeconds,
      t("shell.butlerAutomationPollIntervalLabel")
    ),
    expiresAt: parseNullableDateTimeInput(editorState.expiresAt, t("shell.butlerAutomationExpiresAtLabel")),
    maxChecks: parseOptionalPositiveInteger(editorState.maxChecks, t("shell.butlerAutomationMaxChecksLabel"))
  };
}

function resolveAssistantSandboxStatusLabel(
  status: AssistantSandboxDto["status"]
): string {
  switch (status) {
    case "archived":
      return t("shell.butlerAutomationStatusCompleted");
    case "expired":
      return t("shell.butlerAutomationStatusCancelled");
    case "orphaned":
      return t("shell.butlerSandboxStatusOrphaned");
    case "deleted":
      return t("shell.butlerAutomationStatusFailed");
    case "active":
    default:
      return t("shell.butlerAutomationStatusActive");
  }
}

function resolveAssistantSandboxBadgeStatus(
  status: AssistantSandboxDto["status"]
): "waiting_user" | "active" | "completed" | "failed" | "cancelled" {
  switch (status) {
    case "archived":
      return "completed";
    case "expired":
      return "cancelled";
    case "orphaned":
      return "waiting_user";
    case "deleted":
      return "failed";
    case "active":
    default:
      return "active";
  }
}

function resolveAssistantSandboxSourceLabel(
  sourceKind: AssistantSandboxDto["sourceKind"]
): string {
  return sourceKind === "clone"
    ? t("shell.butlerSandboxSourceClone")
    : t("shell.butlerSandboxSourceBlank");
}

function resolveAssistantSandboxVisibilityLabel(
  visibility: AssistantSandboxDto["visibility"]
): string {
  return visibility === "pinned"
    ? t("shell.butlerSandboxVisibilityPinned")
    : t("shell.butlerSandboxVisibilityAssistantOnly");
}

function mergeAssistantSandboxList(
  sandboxes: AssistantSandboxDto[],
  nextSandbox: AssistantSandboxDto,
  controlSessionId?: string | null
): AssistantSandboxDto[] {
  const nextSandboxes = sandboxes.filter((sandbox) => sandbox.id !== nextSandbox.id);

  if (nextSandbox.status === "deleted") {
    return nextSandboxes
      .sort((left, right) => parseIsoTime(right.updatedAt) - parseIsoTime(left.updatedAt));
  }

  if (controlSessionId && nextSandbox.controlSessionId !== controlSessionId && sandboxes.every((sandbox) => sandbox.id !== nextSandbox.id)) {
    return nextSandboxes
      .sort((left, right) => parseIsoTime(right.updatedAt) - parseIsoTime(left.updatedAt));
  }

  return [nextSandbox, ...nextSandboxes]
    .sort((left, right) => parseIsoTime(right.updatedAt) - parseIsoTime(left.updatedAt));
}

function replaceAssistantAutomation(
  automations: AssistantAutomationTaskDto[],
  nextAutomation: AssistantAutomationTaskDto
): AssistantAutomationTaskDto[] {
  const nextAutomations = automations.filter((automation) => automation.id !== nextAutomation.id);
  return [nextAutomation, ...nextAutomations]
    .sort((left, right) => parseIsoTime(resolveAssistantAutomationSortTime(right)) - parseIsoTime(resolveAssistantAutomationSortTime(left)));
}

function resolveAssistantAutomationSortTime(automation: AssistantAutomationTaskDto): string {
  return automation.updatedAt || automation.lastRunAt || automation.nextRunAt || automation.createdAt;
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

function resolveProviderLabel(providerId: ButlerProviderId): string {
  switch (providerId) {
    case "claude-code":
      return "Claude Code";
    case "codex":
    default:
      return "Codex";
  }
}

function resolveButlerProviderOptions(
  providerCatalog: readonly ProviderCatalogEntryDto[] | null,
  extraProviders: readonly (ButlerProviderId | null | undefined)[]
): Array<{ value: ButlerProviderId; label: string; enabled: boolean }> {
  const items = providerCatalog
    ?.flatMap((item) => {
      if (!isButlerProviderId(item.provider)) {
        return [];
      }

      const providerId = item.provider;
      const providerLabel = item.displayName || resolveProviderLabel(providerId);

      return [{
        value: providerId,
        label: item.enabled
          ? providerLabel
          : `${providerLabel} (${t("settings.skillTargetDisabledTag")})`,
        enabled: item.enabled
      }];
    })
    ?? BUTLER_PROVIDER_IDS.map((providerId) => ({
      value: providerId,
      label: resolveProviderLabel(providerId),
      enabled: true
    }));

  const itemMap = new Map(items.map((item) => [item.value, item]));

  for (const providerId of extraProviders) {
    if (!providerId || itemMap.has(providerId)) {
      continue;
    }

    itemMap.set(providerId, {
      value: providerId,
      label: `${resolveProviderLabel(providerId)} (${t("settings.skillTargetDisabledTag")})`,
      enabled: false
    });
  }

  return BUTLER_PROVIDER_IDS
    .map((providerId) => itemMap.get(providerId))
    .filter((item): item is { value: ButlerProviderId; label: string; enabled: boolean } => Boolean(item));
}

function isButlerProviderId(providerId: string): providerId is ButlerProviderId {
  return BUTLER_PROVIDER_IDS.includes(providerId as ButlerProviderId);
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
    <svg
      width="16"
      height="16"
      viewBox="0 0 24 24"
      fill="none"
      stroke="currentColor"
      strokeWidth="1.8"
      strokeLinecap="round"
      strokeLinejoin="round"
    >
      <circle cx="12" cy="12" r="8.25" fill="none" />
      <path d="M12 8.4v4.1l2.75 1.9" fill="none" />
    </svg>
  );
}
