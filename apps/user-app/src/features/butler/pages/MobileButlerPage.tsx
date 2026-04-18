import {
  useEffect,
  useId,
  useMemo,
  useRef,
  useState,
  type RefObject,
  type TouchEvent as ReactTouchEvent
} from "react";
import { useLocation, useNavigate, useParams } from "react-router-dom";

import { t } from "../../../shared/i18n";
import { useToast } from "../../../shared/toast";
import { MobileWorkspaceSwitcherHeader } from "../../mobile-shell/components/MobileWorkspaceSwitcherHeader";
import { useMobileConversationBottomLayer } from "../../mobile-shell/components/MobileConversationBottomLayerContext";
import { useWorkbenchShell } from "../../conversation/components/WorkbenchLayout";
import { ComposerPanel } from "../../conversation/components/ComposerPanel";
import { MessageTimeline } from "../../conversation/components/MessageTimeline";
import { PermissionRequestList } from "../../conversation/components/PermissionRequestList";
import {
  cancelAssistantAutomation,
  cancelButlerControlTimer,
  cancelButlerFollowUpTask,
  cancelButlerVerificationRun,
  getButlerOverview,
  getButlerProfile,
  listAssistantAutomations,
  listRecentAssistantAutomationRuns,
  listButlerControlSessions,
  listButlerControlTimers,
  listButlerFollowUpTasks,
  listButlerInboxItems,
  listButlerPatrolPlans,
  updateAssistantAutomation,
  type AssistantAutomationRunDto,
  type AssistantAutomationTaskDto,
  type ButlerControlSessionDto,
  type ButlerControlTimerDto,
  type ButlerFollowUpTaskDto,
  type ButlerInboxItemDto,
  type ButlerOverviewDto,
  type ButlerPatrolPlanDto,
  type ButlerProfileDto
} from "../api/butler-api";
import { ButlerAnchoredPopover } from "../components/ButlerAnchoredPopover";
import { ButlerLoadingState } from "../components/ButlerLoadingState";
import { BUTLER_INBOX_UPDATED_EVENT } from "../runtime/butler-inbox-events";
import { subscribeButlerRecordsUpdated } from "../runtime/butler-records-events";
import { ButlerRuntimeStore, useButlerRuntimeStore } from "../runtime/butler-runtime-store";
import { buildWorkspaceButlerPath, buildWorkspaceSessionPath } from "../../workbench/utils/workbench-navigation";

type MobileButlerTab = "info" | "automation" | "settings";
type MobileButlerDrawer = "list" | "sidebar" | null;
type MobileButlerHistoryPanel = "follow_up" | "verification" | "automation" | null;

interface MobileButlerState {
  loading: boolean;
  initialized: boolean;
  profile: ButlerProfileDto | null;
  overview: ButlerOverviewDto | null;
  followUpTasks: ButlerFollowUpTaskDto[];
  inboxItems: ButlerInboxItemDto[];
  patrolPlans: ButlerPatrolPlanDto[];
  controlSessions: ButlerControlSessionDto[];
  controlTimers: ButlerControlTimerDto[];
  assistantAutomations: AssistantAutomationTaskDto[];
  assistantAutomationRuns: AssistantAutomationRunDto[];
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
  promptPreview: string;
  lastResultSummary: string | null;
  targetSessionTitle: string | null;
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

type ButlerControlScheduleBannerItem =
  | {
      kind: "timer";
      timer: ButlerControlTimerDto;
    }
  | {
      kind: "automation";
      automation: AssistantAutomationTaskDto;
    };

const MOBILE_BUTLER_TAB_STORAGE_KEY = "mobile.butler.active-tab";
const MOBILE_BUTLER_TAB_ORDER: MobileButlerTab[] = ["info", "automation", "settings"];
const MOBILE_BUTLER_POLL_INTERVAL_MS = 15_000;
const MOBILE_BUTLER_SWIPE_THRESHOLD_PX = 56;
const MOBILE_BUTLER_SWIPE_DOMINANCE_RATIO = 1.2;
const MOBILE_BUTLER_DRAWER_WIDTH_PX = 360;
const MOBILE_CONTROL_SCHEDULE_HIDE_DELAY_MS = 1_500;
const MOBILE_BUTLER_RUNTIME_ACTIVE_HIDE_DELAY_MS = 1_500;

function useStableMobileControlSchedule(
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

    // 移动端同样吃掉 runtime 边界抖动，避免 banner 一闪一灭。
    hideTimerRef.current = window.setTimeout(() => {
      hideTimerRef.current = null;
      setVisibleSchedule(null);
    }, MOBILE_CONTROL_SCHEDULE_HIDE_DELAY_MS);
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

function useStableMobileRuntimeActive(sessionId: string | null, active: boolean): boolean {
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
    }, MOBILE_BUTLER_RUNTIME_ACTIVE_HIDE_DELAY_MS);
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

function hasMobileButlerActiveRuntimeIndicator(
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

function readStoredTab(): MobileButlerTab {
  if (typeof window === "undefined") {
    return "info";
  }

  try {
    const value = window.localStorage.getItem(MOBILE_BUTLER_TAB_STORAGE_KEY);

    if (value === "automation" || value === "settings") {
      return value;
    }

    return "info";
  } catch {
    return "info";
  }
}

function resolveTabFromSearch(searchTab: string | null, fallbackTab: MobileButlerTab): MobileButlerTab {
  if (searchTab === "settings") {
    return "settings";
  }

  if (searchTab === "automation") {
    return "automation";
  }

  if (searchTab === "info") {
    return "info";
  }

  return fallbackTab;
}

function resolveTabAfterSwipe(
  activeTab: MobileButlerTab,
  touchStart: { x: number; y: number } | null,
  touchEnd: { x: number; y: number }
): {
  closeSidebar: boolean;
  nextTab: MobileButlerTab;
} {
  if (!touchStart) {
    return {
      closeSidebar: false,
      nextTab: activeTab
    };
  }

  const deltaX = touchEnd.x - touchStart.x;
  const deltaY = touchEnd.y - touchStart.y;

  if (Math.abs(deltaX) < MOBILE_BUTLER_SWIPE_THRESHOLD_PX) {
    return {
      closeSidebar: false,
      nextTab: activeTab
    };
  }

  if (Math.abs(deltaX) < Math.abs(deltaY) * MOBILE_BUTLER_SWIPE_DOMINANCE_RATIO) {
    return {
      closeSidebar: false,
      nextTab: activeTab
    };
  }

  const activeIndex = MOBILE_BUTLER_TAB_ORDER.indexOf(activeTab);

  if (deltaX > 0 && activeIndex === 0) {
    return {
      closeSidebar: true,
      nextTab: activeTab
    };
  }

  const nextIndex =
    deltaX < 0
      ? Math.min(MOBILE_BUTLER_TAB_ORDER.length - 1, activeIndex + 1)
      : Math.max(0, activeIndex - 1);

  return {
    closeSidebar: false,
    nextTab: MOBILE_BUTLER_TAB_ORDER[nextIndex] ?? activeTab
  };
}

function resolveDrawerFromStageSwipe(
  touchStart: { x: number; y: number } | null,
  touchEnd: { x: number; y: number }
): MobileButlerDrawer {
  if (!touchStart) {
    return null;
  }

  const deltaX = touchEnd.x - touchStart.x;
  const deltaY = touchEnd.y - touchStart.y;

  if (Math.abs(deltaX) < MOBILE_BUTLER_SWIPE_THRESHOLD_PX) {
    return null;
  }

  if (Math.abs(deltaX) < Math.abs(deltaY) * MOBILE_BUTLER_SWIPE_DOMINANCE_RATIO) {
    return null;
  }

  return deltaX > 0 ? "list" : "sidebar";
}

function shouldIgnoreMobileButlerGestureTarget(target: EventTarget | null) {
  if (!(target instanceof Element)) {
    return false;
  }

  return Boolean(
    target.closest(
      "input, textarea, select, option, label, button, a, [contenteditable='true'], [data-mobile-butler-gesture='ignore']"
    )
  );
}

export function MobileButlerPage() {
  const { workspaceId = "" } = useParams();
  const location = useLocation();
  const navigate = useNavigate();
  const { showToast } = useToast();
  const { navigationGroups, requestNavigationRefresh, selectWorkspace } = useWorkbenchShell();
  const currentWorkspace =
    navigationGroups.find((group) => group.workspace.id === workspaceId)?.workspace ?? null;
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
  const sessionWorkspaceIdById = useMemo(
    () =>
      new Map(
        navigationGroups.flatMap((group) =>
          group.sessions.map((session) => [session.sessionId, group.workspace.id] as const)
        )
      ),
    [navigationGroups]
  );
  const searchTab = new URLSearchParams(location.search).get("tab");
  const storedTabRef = useRef<MobileButlerTab>(readStoredTab());
  const activeTab = resolveTabFromSearch(searchTab, storedTabRef.current);
  const stageTouchStartRef = useRef<{ x: number; y: number } | null>(null);
  const listTouchStartRef = useRef<{ x: number; y: number } | null>(null);
  const sidebarTouchStartRef = useRef<{ x: number; y: number } | null>(null);
  const storeRef = useRef<ButlerRuntimeStore | null>(null);
  const currentWorkspaceIdRef = useRef<string | null>(null);
  const [openDrawer, setOpenDrawer] = useState<MobileButlerDrawer>(null);
  const [openHistoryPanel, setOpenHistoryPanel] = useState<MobileButlerHistoryPanel>(null);
  const [composerPanelElement, setComposerPanelElement] = useState<HTMLElement | null>(null);
  const [cancellingFollowUpTaskId, setCancellingFollowUpTaskId] = useState<string | null>(null);
  const [cancellingVerificationId, setCancellingVerificationId] = useState<string | null>(null);
  const [cancellingAutomationId, setCancellingAutomationId] = useState<string | null>(null);
  const [selectedAutomationId, setSelectedAutomationId] = useState<string | null>(null);
  const [automationEditorState, setAutomationEditorState] = useState<AutomationEditorState | null>(null);
  const [savingAutomationId, setSavingAutomationId] = useState<string | null>(null);
  const [cancellingTimerId, setCancellingTimerId] = useState<string | null>(null);
  const [executingTimerId, setExecutingTimerId] = useState<string | null>(null);
  const [replyingPermissionRequestId, setReplyingPermissionRequestId] = useState<string | null>(null);
  const [countdownNow, setCountdownNow] = useState(() => Date.now());
  const [state, setState] = useState<MobileButlerState>({
    loading: true,
    initialized: false,
    profile: null,
    overview: null,
    followUpTasks: [],
    inboxItems: [],
    patrolPlans: [],
    controlSessions: [],
    controlTimers: [],
    assistantAutomations: [],
    assistantAutomationRuns: []
  });
  const projectNameById = useMemo(
    () => new Map((state.overview?.projects ?? []).map((project) => [project.id, project.name] as const)),
    [state.overview?.projects]
  );

  if (!storeRef.current || currentWorkspaceIdRef.current !== workspaceId) {
    storeRef.current = new ButlerRuntimeStore(workspaceId);
    currentWorkspaceIdRef.current = workspaceId;
  }

  const store = storeRef.current;
  const runtimeLoading = useButlerRuntimeStore(store, (runtime) => runtime.loading);
  const runtimeInitialized = useButlerRuntimeStore(store, (runtime) => runtime.initialized);
  const runtimeProfile = useButlerRuntimeStore(store, (runtime) => runtime.profile);
  const activeProvider = useButlerRuntimeStore(store, (runtime) => runtime.activeProvider);
  const controlSession = useButlerRuntimeStore(store, (runtime) => runtime.controlSession);
  const capabilities = useButlerRuntimeStore(store, (runtime) => runtime.capabilities);
  const messages = useButlerRuntimeStore(store, (runtime) => runtime.messages);
  const historyState = useButlerRuntimeStore(store, (runtime) => runtime.historyState);
  const loadingOlderMessages = useButlerRuntimeStore(store, (runtime) => runtime.loadingOlderMessages);
  const hasOlderMessages = useButlerRuntimeStore(store, (runtime) => runtime.hasOlderMessages);
  const runtimeSending = useButlerRuntimeStore(store, (runtime) => runtime.sending);
  const runtimeHasActiveRun = useButlerRuntimeStore(store, (runtime) => runtime.runtimeHasActiveRun);
  const runtimeCanInterrupt = useButlerRuntimeStore(store, (runtime) => runtime.runtimeCanInterrupt);
  const contextUsage = useButlerRuntimeStore(store, (runtime) => runtime.contextUsage);
  const permissionRequests = useButlerRuntimeStore(store, (runtime) => runtime.permissionRequests);
  const { composerPortalTarget } = useMobileConversationBottomLayer();
  const pageRef = useRef<HTMLElement | null>(null);
  const permissionToastSessionIdRef = useRef<string | null>(null);
  const permissionToastBaselineReadyRef = useRef(false);
  const pendingPermissionRequestIdsRef = useRef<Set<string>>(new Set());

  useEffect(() => {
    storedTabRef.current = activeTab;

    if (typeof window === "undefined") {
      return;
    }

    try {
      window.localStorage.setItem(MOBILE_BUTLER_TAB_STORAGE_KEY, activeTab);
    } catch {
      // 忽略隐私模式下的本地存储失败。
    }
  }, [activeTab]);

  useEffect(() => {
    if (searchTab === activeTab) {
      return;
    }

    const nextSearchParams = new URLSearchParams(location.search);
    nextSearchParams.set("tab", activeTab);
    navigate(
      {
        pathname: location.pathname,
        search: `?${nextSearchParams.toString()}`
      },
      { replace: true }
    );
  }, [activeTab, location.pathname, location.search, navigate, searchTab]);

  useEffect(() => {
    if (!workspaceId) {
      return;
    }

    selectWorkspace(workspaceId);
  }, [selectWorkspace, workspaceId]);

  useEffect(() => {
    if (!workspaceId) {
      return;
    }

    void store.initialize();
  }, [store, workspaceId]);

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
    const sessionTitle =
      controlSession?.title?.trim()
      || controlSession?.session?.title?.trim()
      || runtimeProfile?.displayName?.trim()
      || t("shell.butlerEntry");

    if (permissionToastBaselineReadyRef.current) {
      pendingRequests.forEach((request) => {
        if (pendingPermissionRequestIdsRef.current.has(request.id)) {
          return;
        }

        showToast({
          id: `mobile-butler-permission-request-${request.id}`,
          title: t("conversation.permissionRequestToastTitle"),
          description: t("conversation.backgroundPermissionToastDescription", {
            title: sessionTitle,
            requestTitle: request.title
          }),
          tone: "warning",
          durationMs: 8_000
        });
      });
    }

    pendingPermissionRequestIdsRef.current = nextPendingIds;
    permissionToastBaselineReadyRef.current = true;
  }, [
    controlSession?.session?.sessionId,
    controlSession?.session?.title,
    controlSession?.title,
    permissionRequests,
    runtimeProfile?.displayName,
    showToast
  ]);

  useEffect(() => {
    if (!workspaceId) {
      setState({
        loading: false,
        initialized: false,
        profile: null,
        overview: null,
        followUpTasks: [],
        inboxItems: [],
        patrolPlans: [],
        controlSessions: [],
        controlTimers: [],
        assistantAutomations: [],
        assistantAutomationRuns: []
      });
      return;
    }

    let disposed = false;

    async function loadData(showErrorToast: boolean) {
      setState((current) => ({
        ...current,
        loading: true
      }));

      try {
        const profileResponse = await getButlerProfile();

        if (!profileResponse.initialized || !profileResponse.profile) {
          if (!disposed) {
            setState({
              loading: false,
              initialized: false,
              profile: null,
              overview: null,
              followUpTasks: [],
              inboxItems: [],
              patrolPlans: [],
              controlSessions: [],
              controlTimers: [],
              assistantAutomations: [],
              assistantAutomationRuns: []
            });
          }
          return;
        }

        const [
          overviewResponse,
          followUpResponse,
          inboxResponse,
          controlSessionsResponse,
          controlTimersResponse,
          automationResponse,
          automationRunsResponse
        ] = await Promise.all([
          getButlerOverview(),
          listButlerFollowUpTasks(),
          listButlerInboxItems({
            workspaceId
          }),
          listButlerControlSessions(),
          listButlerControlTimers(),
          listAssistantAutomations({
            limit: 100
          }),
          listRecentAssistantAutomationRuns({
            limit: 100
          })
        ]);

        const workspaceProjectIds = overviewResponse.overview.projects
          .filter((project) => project.workspaceId === workspaceId)
          .map((project) => project.id);
        const patrolPlanResponses = await Promise.all(
          workspaceProjectIds.map((projectId) => listButlerPatrolPlans(projectId))
        );

        if (disposed) {
          return;
        }

        setState({
          loading: false,
          initialized: true,
          profile: profileResponse.profile,
          overview: overviewResponse.overview,
          followUpTasks: followUpResponse.items.filter((task) => task.workspaceId === workspaceId),
          inboxItems: inboxResponse.items.filter((item) => item.status !== "closed"),
          patrolPlans: patrolPlanResponses.flatMap((response) => response.items),
          controlSessions: controlSessionsResponse.items,
          controlTimers: controlTimersResponse.items,
          assistantAutomations: automationResponse.payload.items,
          assistantAutomationRuns: automationRunsResponse.payload.items
        });
      } catch (error) {
        if (disposed) {
          return;
        }

        setState((current) => ({
          ...current,
          loading: false
        }));

        if (showErrorToast) {
          showToast({
            title: t("shell.butlerLoadFailed"),
            description: error instanceof Error ? error.message : undefined,
            tone: "error"
          });
        }
      }
    }

    void loadData(true);

    const timer = window.setInterval(() => {
      void loadData(false);
    }, MOBILE_BUTLER_POLL_INTERVAL_MS);
    const unsubscribeRecords = subscribeButlerRecordsUpdated(() => {
      void loadData(false);
    });
    const handleInboxUpdated = () => {
      void loadData(false);
    };

    window.addEventListener(BUTLER_INBOX_UPDATED_EVENT, handleInboxUpdated);

    return () => {
      disposed = true;
      window.clearInterval(timer);
      unsubscribeRecords();
      window.removeEventListener(BUTLER_INBOX_UPDATED_EVENT, handleInboxUpdated);
    };
  }, [showToast, workspaceId]);

  const workspaceProjectIds = useMemo(
    () =>
      new Set(
        (state.overview?.projects ?? [])
          .filter((project) => project.workspaceId === workspaceId)
          .map((project) => project.id)
      ),
    [state.overview?.projects, workspaceId]
  );
  const workspaceControlTimers = useMemo(
    () =>
      state.controlTimers.filter((timer) => (
        timer.projectId ? workspaceProjectIds.has(timer.projectId) : timer.controlSession?.session?.workspaceId === workspaceId
      )),
    [state.controlTimers, workspaceId, workspaceProjectIds]
  );
  const visibleFollowUpTasks = useMemo(
    () => state.followUpTasks.filter((task) => isVisibleMobileFollowUpTask(task.status)),
    [state.followUpTasks]
  );
  const workspaceVerifications = useMemo(
    () =>
      (state.overview?.verifications ?? []).filter((verification) => (
        verification.projectId ? workspaceProjectIds.has(verification.projectId) : false
      )),
    [state.overview?.verifications, workspaceProjectIds]
  );
  const followUpRecords = useMemo(
    () =>
      [...visibleFollowUpTasks]
        .sort((left, right) => parseIsoTime(resolveFollowUpTaskUpdatedAt(right)) - parseIsoTime(resolveFollowUpTaskUpdatedAt(left)))
        .slice(0, 4),
    [visibleFollowUpTasks]
  );
  const verificationRecords = useMemo(
    () => buildVerificationRecords(workspaceVerifications, "active"),
    [workspaceVerifications]
  );
  const verificationHistoryRecords = useMemo(
    () => buildVerificationRecords(workspaceVerifications, "history"),
    [workspaceVerifications]
  );
  const todoRecords = useMemo(
    () => buildTodoRecords(state.inboxItems.filter((item) => item.status !== "closed")).slice(0, 4),
    [state.inboxItems]
  );
  const automationTasks = useMemo(
    () => buildAutomationTaskItems(
      state.assistantAutomations,
      state.overview,
      workspaceProjectIds,
      "active"
    ),
    [state.assistantAutomations, state.overview, workspaceProjectIds]
  );
  const automationRuns = useMemo(
    () => buildAutomationRunItems(
      state.assistantAutomations,
      state.assistantAutomationRuns,
      state.overview,
      workspaceProjectIds,
      "active"
    ),
    [state.assistantAutomations, state.assistantAutomationRuns, state.overview, workspaceProjectIds]
  );
  const selectedAutomation = useMemo(
    () =>
      selectedAutomationId
        ? state.assistantAutomations.find((automation) => automation.id === selectedAutomationId) ?? null
        : null,
    [selectedAutomationId, state.assistantAutomations]
  );
  const selectedAutomationRuns = useMemo(
    () =>
      selectedAutomationId
        ? state.assistantAutomationRuns
          .filter((run) => run.automationId === selectedAutomationId)
          .sort((left, right) => parseIsoTime(right.createdAt) - parseIsoTime(left.createdAt))
          .slice(0, 6)
        : [],
    [selectedAutomationId, state.assistantAutomationRuns]
  );

  useEffect(() => {
    if (selectedAutomationId && !selectedAutomation) {
      setSelectedAutomationId(null);
      setAutomationEditorState(null);
    }
  }, [selectedAutomation, selectedAutomationId]);

  const followUpHistoryRecords = useMemo(
    () =>
      [...state.followUpTasks]
        .filter((task) => !isVisibleMobileFollowUpTask(task.status))
        .sort((left, right) => parseIsoTime(resolveFollowUpTaskUpdatedAt(right)) - parseIsoTime(resolveFollowUpTaskUpdatedAt(left)))
        .slice(0, 8),
    [state.followUpTasks]
  );
  const automationHistoryTasks = useMemo(
    () => buildAutomationTaskItems(
      state.assistantAutomations,
      state.overview,
      workspaceProjectIds,
      "history"
    ),
    [state.assistantAutomations, state.overview, workspaceProjectIds]
  );
  const automationHistoryRuns = useMemo(
    () => buildAutomationRunItems(
      state.assistantAutomations,
      state.assistantAutomationRuns,
      state.overview,
      workspaceProjectIds,
      "history"
    ),
    [state.assistantAutomations, state.assistantAutomationRuns, state.overview, workspaceProjectIds]
  );
  const immediateControlSessionActive = useMemo(
    () => hasMobileButlerActiveRuntimeIndicator(controlSession, runtimeHasActiveRun),
    [controlSession, runtimeHasActiveRun]
  );
  const isControlSessionActive = useStableMobileRuntimeActive(
    controlSession?.session.sessionId ?? null,
    immediateControlSessionActive
  );
  const composerHasActiveRun = isControlSessionActive || runtimeSending;
  const composerCanInterrupt =
    runtimeCanInterrupt === true || runtimeSending
      ? true
      : runtimeCanInterrupt ?? false;
  const composerIsRunning = isControlSessionActive || runtimeSending;
  const immediateActiveControlSchedule = useMemo(
    () => {
      if (!controlSession || isControlSessionActive) {
        return null;
      }

      const timerItems = workspaceControlTimers
        .filter((timer) => timer.status === "active" && timer.controlSessionId === controlSession.id)
        .map<ButlerControlScheduleBannerItem>((timer) => ({
          kind: "timer",
          timer
        }));
      const timerIds = new Set(
        workspaceControlTimers
          .filter((timer) => timer.status === "active" && timer.controlSessionId === controlSession.id)
          .map((timer) => timer.id)
      );
      const automationItems = state.assistantAutomations
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
    [controlSession, isControlSessionActive, state.assistantAutomations, workspaceControlTimers]
  );
  const activeControlSchedule = useStableMobileControlSchedule(immediateActiveControlSchedule);
  const showLoadingState = state.loading || runtimeLoading;
  const showEmptyState = !showLoadingState && (!state.initialized || !runtimeInitialized || !state.profile);
  const butlerDisplayName = runtimeProfile?.displayName?.trim() || state.profile?.displayName?.trim() || t("shell.butlerEntry");
  const runtimeEmpty = !controlSession && messages.length === 0;
  const showComposer = !showEmptyState && openDrawer === null;

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
  useEffect(() => {
    if (openDrawer !== "sidebar") {
      setOpenHistoryPanel(null);
    }
  }, [openDrawer]);
  const sidebarContent = openHistoryPanel === "follow_up"
    ? (
        <MobileHistoryPanel
          title={t("shell.butlerFollowUpHistoryTitle")}
          description={t("shell.butlerFollowUpHistoryDescription")}
          emptyText={t("shell.butlerInfoFollowUpRecordsEmpty")}
          onClose={() => setOpenHistoryPanel(null)}
          items={followUpHistoryRecords.map((task) => ({
            id: task.id,
            title: task.sessionTitle?.trim() || task.projectName,
            subtitle: task.projectName,
            status: resolveFollowUpTaskStatusLabel(task.status),
            content:
              task.waitingReason?.trim()
              || task.lastAutomationSummary?.trim()
              || task.objective
              || t("shell.butlerInfoFollowUpFallback", {
                updatedAt: formatIsoDateTime(resolveFollowUpTaskUpdatedAt(task))
              }),
            meta: formatIsoDateTime(resolveFollowUpTaskUpdatedAt(task)),
            actionLabel: isCancelableMobileFollowUpTask(task.status)
              ? cancellingFollowUpTaskId === task.id
                ? t("conversation.butlerFollowUpStopping")
                : t("conversation.butlerStopFollowUpAction")
              : null,
            actionDisabled: cancellingFollowUpTaskId === task.id,
            onAction: isCancelableMobileFollowUpTask(task.status)
              ? () => {
                  void handleCancelFollowUpTask(task);
                }
              : undefined
          }))}
        />
      )
    : openHistoryPanel === "verification"
      ? (
          <MobileHistoryPanel
            title={t("shell.butlerVerificationHistoryTitle")}
            description={t("shell.butlerVerificationHistoryDescription")}
            emptyText={t("shell.butlerVerificationHistoryEmpty")}
            onClose={() => setOpenHistoryPanel(null)}
            items={verificationHistoryRecords.map((item, index) => ({
              id: `${item.title}:${index}`,
              title: item.title,
              subtitle: item.subtitle,
              status: item.status,
              content: item.content,
              meta: item.meta,
              actionLabel: item.verification && isCancelableMobileVerification(item.verification.status)
                ? cancellingVerificationId === item.verification.id
                  ? t("conversation.butlerVerificationStopping")
                  : t("conversation.butlerStopVerificationAction")
                : null,
              actionDisabled: item.verification ? cancellingVerificationId === item.verification.id : false,
              onAction: item.verification
                ? () => {
                    void handleCancelVerificationRun(item.verification!);
                  }
                : undefined
            }))}
          />
        )
      : openHistoryPanel === "automation"
        ? (
            <MobileAutomationHistoryPanel
              taskItems={automationHistoryTasks}
              runItems={automationHistoryRuns}
              onClose={() => setOpenHistoryPanel(null)}
            />
          )
        : activeTab === "info"
          ? (
              <>
                <RecordSection
                  title={t("shell.butlerInfoFollowUpRecordsTitle")}
                  emptyText={t("shell.butlerInfoFollowUpRecordsEmpty")}
                  actionLabel={t("shell.butlerFollowUpHistoryAction")}
                  onAction={() => setOpenHistoryPanel("follow_up")}
                  items={followUpRecords.map((task) => ({
                    id: task.id,
                    title: task.sessionTitle?.trim() || task.projectName,
                    subtitle: task.projectName,
                    status: resolveFollowUpTaskStatusLabel(task.status),
                    content:
                      task.waitingReason?.trim()
                      || task.lastAutomationSummary?.trim()
                      || task.objective
                      || t("shell.butlerInfoFollowUpFallback", {
                        updatedAt: formatIsoDateTime(resolveFollowUpTaskUpdatedAt(task))
                      }),
                    meta: formatIsoDateTime(resolveFollowUpTaskUpdatedAt(task)),
                    actionLabel: isCancelableMobileFollowUpTask(task.status)
                      ? cancellingFollowUpTaskId === task.id
                        ? t("conversation.butlerFollowUpStopping")
                        : t("conversation.butlerStopFollowUpAction")
                      : null,
                    actionDisabled: cancellingFollowUpTaskId === task.id,
                    onAction: isCancelableMobileFollowUpTask(task.status)
                      ? () => {
                          void handleCancelFollowUpTask(task);
                        }
                      : undefined
                  }))}
                />

                <RecordSection
                  title={t("shell.butlerInfoVerificationRecordsTitle")}
                  emptyText={t("shell.butlerInfoVerificationRecordsEmpty")}
                  actionLabel={t("shell.butlerFollowUpHistoryAction")}
                  onAction={() => setOpenHistoryPanel("verification")}
                  items={verificationRecords.map((item, index) => ({
                    id: `${item.title}:${index}`,
                    title: item.title,
                    subtitle: item.subtitle,
                    status: item.status,
                    content: item.content,
                    meta: item.meta,
                    actionLabel: item.verification && isCancelableMobileVerification(item.verification.status)
                      ? cancellingVerificationId === item.verification.id
                        ? t("conversation.butlerVerificationStopping")
                        : t("conversation.butlerStopVerificationAction")
                      : null,
                    actionDisabled: item.verification ? cancellingVerificationId === item.verification.id : false,
                    onAction: item.verification
                      ? () => {
                          void handleCancelVerificationRun(item.verification!);
                        }
                      : undefined
                  }))}
                />

                <CompactRecordSection
                  title={t("shell.butlerInfoTodoRecordsTitle")}
                  emptyText={t("shell.butlerInfoTodoRecordsEmpty")}
                  items={todoRecords.map((item, index) => ({
                    id: `${item.title}:${index}`,
                    title: item.title,
                    content: item.content
                  }))}
                />
              </>
            )
          : activeTab === "automation"
            ? (
                <>
                  <MobileAutomationOverviewSection
                    items={automationTasks}
                    emptyText={t("shell.butlerAutomationTasksEmpty")}
                    actionLabel={t("shell.butlerFollowUpHistoryAction")}
                    onAction={() => setOpenHistoryPanel("automation")}
                    selectedAutomationId={selectedAutomationId}
                    cancellingAutomationId={cancellingAutomationId}
                    onSelectAutomation={handleSelectAutomation}
                    onCancelAutomation={(automationId) => {
                      void handleCancelAutomation(automationId);
                    }}
                  />

                  {selectedAutomation && automationEditorState ? (
                    <MobileAutomationDetailPanel
                      automation={selectedAutomation}
                      editorState={automationEditorState}
                      saving={savingAutomationId === selectedAutomation.id}
                      recentRuns={selectedAutomationRuns}
                      workspaceNameById={workspaceNameById}
                      sessionTitleById={sessionTitleById}
                      onClose={() => {
                        setSelectedAutomationId(null);
                        setAutomationEditorState(null);
                      }}
                      onEditorChange={(patch) => {
                        setAutomationEditorState((current) => (
                          current ? { ...current, ...patch } : current
                        ));
                      }}
                      onSave={() => {
                        void handleSaveAutomation();
                      }}
                    />
                  ) : null}

                  <RecordSection
                    title={t("shell.butlerAutomationRunsTitle")}
                    emptyText={t("shell.butlerAutomationRunsEmpty")}
                    items={automationRuns.map((item) => ({
                      id: item.id,
                      title: item.title,
                      subtitle: item.projectName,
                      status: item.statusLabel,
                      content: `${item.sourceLabel} · ${item.summary}`,
                      meta: formatIsoDateTime(item.createdAt)
                    }))}
                  />
                </>
              )
            : (
                <section className="mobile-feature-panel surface-card mobile-butler-record-section">
                  <div className="mobile-feature-section-header">
                    <div>
                      <h2>{t("shell.butlerSidebarSettingsTab")}</h2>
                    </div>
                  </div>
                  <div className="mobile-butler-settings-summary">
                    <InfoMetric label={t("shell.butlerDisplayNameLabel")} value={butlerDisplayName} />
                    <InfoMetric label={t("shell.butlerProviderLabel")} value={resolveProviderLabel(activeProvider)} />
                    <InfoMetric
                      label={t("shell.mobileButlerAssistantWorkspaceLabel")}
                      value={state.profile?.workspacePath ?? currentWorkspace?.path ?? "-"}
                    />
                  </div>
                </section>
              );

  useMobileButlerComposerHeightVar(
    pageRef,
    composerPanelElement,
    showComposer,
    `${workspaceId}:${openDrawer ?? "none"}`
  );

  function selectTab(nextTab: MobileButlerTab) {
    if (nextTab === activeTab) {
      return;
    }

    setOpenHistoryPanel(null);
    navigate(buildWorkspaceButlerPath(workspaceId, nextTab), {
      replace: true
    });
  }

  function handleStageTouchStart(event: ReactTouchEvent<HTMLElement>) {
    if (event.changedTouches.length !== 1) {
      stageTouchStartRef.current = null;
      return;
    }

    if (shouldIgnoreMobileButlerGestureTarget(event.target)) {
      stageTouchStartRef.current = null;
      return;
    }

    const touchPoint = event.changedTouches[0];
    stageTouchStartRef.current = {
      x: touchPoint.clientX,
      y: touchPoint.clientY
    };
  }

  function handleStageTouchEnd(event: ReactTouchEvent<HTMLElement>) {
    if (event.changedTouches.length !== 1) {
      return;
    }

    const touchStart = stageTouchStartRef.current;
    stageTouchStartRef.current = null;
    const touchPoint = event.changedTouches[0];
    const nextDrawer = resolveDrawerFromStageSwipe(touchStart, {
      x: touchPoint.clientX,
      y: touchPoint.clientY
    });

    if (nextDrawer) {
      setOpenDrawer(nextDrawer);
    }
  }

  function handleListTouchStart(event: ReactTouchEvent<HTMLElement>) {
    if (event.changedTouches.length !== 1) {
      listTouchStartRef.current = null;
      return;
    }

    if (shouldIgnoreMobileButlerGestureTarget(event.target)) {
      listTouchStartRef.current = null;
      return;
    }

    const touchPoint = event.changedTouches[0];
    listTouchStartRef.current = {
      x: touchPoint.clientX,
      y: touchPoint.clientY
    };
  }

  function handleListTouchEnd(event: ReactTouchEvent<HTMLElement>) {
    const touchStart = listTouchStartRef.current;
    listTouchStartRef.current = null;

    if (!touchStart || event.changedTouches.length !== 1) {
      return;
    }

    const touchPoint = event.changedTouches[0];
    const deltaX = touchPoint.clientX - touchStart.x;
    const deltaY = touchPoint.clientY - touchStart.y;

    if (
      deltaX > -MOBILE_BUTLER_SWIPE_THRESHOLD_PX
      || Math.abs(deltaX) < Math.abs(deltaY) * MOBILE_BUTLER_SWIPE_DOMINANCE_RATIO
    ) {
      return;
    }

    setOpenDrawer(null);
  }

  function handleSidebarTouchStart(event: ReactTouchEvent<HTMLElement>) {
    if (event.changedTouches.length !== 1) {
      sidebarTouchStartRef.current = null;
      return;
    }

    if (shouldIgnoreMobileButlerGestureTarget(event.target)) {
      sidebarTouchStartRef.current = null;
      return;
    }

    const touchPoint = event.changedTouches[0];
    sidebarTouchStartRef.current = {
      x: touchPoint.clientX,
      y: touchPoint.clientY
    };
  }

  function handleSidebarTouchEnd(event: ReactTouchEvent<HTMLElement>) {
    const touchStart = sidebarTouchStartRef.current;
    sidebarTouchStartRef.current = null;

    if (event.changedTouches.length !== 1) {
      return;
    }

    const touchPoint = event.changedTouches[0];
    const result = resolveTabAfterSwipe(activeTab, touchStart, {
      x: touchPoint.clientX,
      y: touchPoint.clientY
    });

    if (result.closeSidebar) {
      setOpenDrawer(null);
      return;
    }

    if (result.nextTab !== activeTab) {
      selectTab(result.nextTab);
    }
  }

  async function handleOpenControlSession(controlSessionId: string) {
    await store.openControlSession(controlSessionId);
    setOpenDrawer(null);
  }

  async function handleStartFreshSession() {
    await store.startFreshSession();
    setOpenDrawer(null);
    requestNavigationRefresh();
  }

  async function handleSendMessage(content: string, options?: { model?: string | null; reasoningLevel?: string | null; attachments?: unknown[] }) {
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
  }

  async function refreshButlerRecords(): Promise<void> {
    const [overviewResponse, followUpResponse, automationResponse, automationRunsResponse] = await Promise.all([
      getButlerOverview(),
      listButlerFollowUpTasks(),
      listAssistantAutomations({
        limit: 100
      }),
      listRecentAssistantAutomationRuns({
        limit: 100
      })
    ]);

    await store.reloadEventsAndOverview();

    setState((current) => ({
      ...current,
      overview: overviewResponse.overview,
      followUpTasks: followUpResponse.items.filter((task) => task.workspaceId === workspaceId),
      assistantAutomations: automationResponse.payload.items,
      assistantAutomationRuns: automationRunsResponse.payload.items
    }));
  }

  async function handleCancelFollowUpTask(task: ButlerFollowUpTaskDto) {
    setCancellingFollowUpTaskId(task.id);

    try {
      const response = await cancelButlerFollowUpTask(task.id);
      setState((current) => ({
        ...current,
        followUpTasks: replaceFollowUpTask(current.followUpTasks, response.task)
      }));
      await refreshButlerRecords();
      requestNavigationRefresh();
      showToast({
        title: t("conversation.butlerFollowUpStopped"),
        description: t("conversation.butlerFollowUpStoppedDescription"),
        tone: "success"
      });
    } catch (error) {
      showToast({
        title: t("conversation.butlerFollowUpStopFailed"),
        description: error instanceof Error ? error.message : undefined,
        tone: "error"
      });
    } finally {
      setCancellingFollowUpTaskId(null);
    }
  }

  async function handleCancelVerificationRun(verification: {
    id: string;
    projectId: string;
  }) {
    setCancellingVerificationId(verification.id);

    try {
      await cancelButlerVerificationRun(verification.projectId, verification.id);
      await refreshButlerRecords();
      requestNavigationRefresh();
      showToast({
        title: t("conversation.butlerVerificationStopped"),
        description: t("conversation.butlerVerificationStoppedDescription"),
        tone: "success"
      });
    } catch (error) {
      showToast({
        title: t("conversation.butlerVerificationStopFailed"),
        description: error instanceof Error ? error.message : undefined,
        tone: "error"
      });
    } finally {
      setCancellingVerificationId(null);
    }
  }

  async function handleCancelControlTimer(timerId: string) {
    setCancellingTimerId(timerId);

    try {
      const response = await cancelButlerControlTimer(timerId);
      setState((current) => ({
        ...current,
        controlTimers: replaceControlTimer(current.controlTimers, response.timer)
      }));
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
  }

  function handleSelectAutomation(automationId: string) {
    if (selectedAutomationId === automationId) {
      setSelectedAutomationId(null);
      setAutomationEditorState(null);
      return;
    }

    const automation = state.assistantAutomations.find((item) => item.id === automationId);

    if (!automation) {
      return;
    }

    setSelectedAutomationId(automationId);
    setAutomationEditorState(createAutomationEditorState(automation));
  }

  async function handleSaveAutomation() {
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
      setState((current) => ({
        ...current,
        assistantAutomations: replaceAssistantAutomation(
          current.assistantAutomations,
          response.payload.automation
        )
      }));
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
  }

  async function handleCancelAutomation(automationId: string) {
    setCancellingAutomationId(automationId);

    try {
      const response = await cancelAssistantAutomation(automationId);
      setState((current) => ({
        ...current,
        assistantAutomations: replaceAssistantAutomation(
          current.assistantAutomations,
          response.payload.automation
        )
      }));
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
  }

  async function handleExecuteControlTimerNow(timer: ButlerControlTimerDto) {
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
      setState((current) => ({
        ...current,
        controlTimers: replaceControlTimer(current.controlTimers, response.timer)
      }));
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
  }

  async function handleCancelControlSchedule(schedule: ButlerControlScheduleBannerItem) {
    if (schedule.kind === "timer") {
      await handleCancelControlTimer(schedule.timer.id);
      return;
    }

    await handleCancelAutomation(schedule.automation.id);
  }

  async function handleExecuteControlScheduleNow(schedule: ButlerControlScheduleBannerItem) {
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
      setState((current) => ({
        ...current,
        assistantAutomations: replaceAssistantAutomation(
          current.assistantAutomations,
          {
            ...schedule.automation,
            status: "cancelled",
            nextRunAt: null,
            cancelledAt: new Date().toISOString(),
            updatedAt: new Date().toISOString()
          }
        )
      }));
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
  }

  function handleOpenControlScheduleSession(schedule: ButlerControlScheduleBannerItem) {
    const targetSessionId = resolveControlScheduleTargetSessionId(schedule);
    const targetWorkspaceId =
      (targetSessionId ? sessionWorkspaceIdById.get(targetSessionId) : null)
      || readControlScheduleWorkspaceId(schedule)
      || workspaceId;

    if (!targetSessionId || !targetWorkspaceId) {
      return;
    }

    setOpenDrawer(null);
    navigate(buildWorkspaceSessionPath(targetWorkspaceId, targetSessionId));
  }

  if (!currentWorkspace) {
    return (
      <main className="mobile-feature-page mobile-page-scroll-root">
        <article className="mobile-feature-empty surface-card">
          <h1>{t("shell.workspaceDetailMissingTitle")}</h1>
          <p>{t("shell.workspaceDetailMissingBody")}</p>
        </article>
      </main>
    );
  }

  return (
    <main
      ref={pageRef}
      className="mobile-feature-page mobile-page-fixed-root mobile-butler-page mobile-butler-page-shell"
      data-mobile-butler-drawer={openDrawer ?? "none"}
    >
      <MobileWorkspaceSwitcherHeader
        currentWorkspace={currentWorkspace}
        workspaces={navigationGroups.map((group) => group.workspace)}
        heading={t("shell.mobileButlerEntry")}
        triggerLabel={currentWorkspace.name}
        onSelectWorkspace={(targetWorkspaceId) => {
          selectWorkspace(targetWorkspaceId);
          navigate(buildWorkspaceButlerPath(targetWorkspaceId, activeTab));
        }}
        trailing={
          <div className="mobile-butler-header-trailing" data-mobile-butler-gesture="ignore">
            <div className="mobile-butler-hero-top mobile-butler-toolbar-identity">
              <div className="mobile-butler-hero-badge">AI</div>
              <div className="mobile-butler-hero-copy">
                <strong>{butlerDisplayName}</strong>
                <span>{resolveProviderLabel(activeProvider)}</span>
              </div>
            </div>
            <div className="mobile-butler-toolbar-actions">
              <button
                type="button"
                className="mobile-butler-toolbar-button"
                aria-label={t("shell.butlerHistoryAction")}
                title={t("shell.butlerHistoryAction")}
                onClick={() => setOpenDrawer("list")}
              >
                ≡
              </button>
              <button
                type="button"
                className="mobile-butler-toolbar-button"
                aria-label={t("shell.butlerSidebarTabsLabel")}
                title={t("shell.butlerSidebarTabsLabel")}
                onClick={() => setOpenDrawer("sidebar")}
              >
                ⓘ
              </button>
            </div>
          </div>
        }
      />

      <div className="mobile-butler-stage-shell">
        {openDrawer ? (
          <button
            type="button"
            className="mobile-butler-drawer-scrim"
            aria-label={t("common.close")}
            onClick={() => setOpenDrawer(null)}
          />
        ) : null}

        <aside
          className="mobile-butler-drawer mobile-butler-drawer-list"
          style={{ width: `min(88vw, ${MOBILE_BUTLER_DRAWER_WIDTH_PX}px)` }}
          onTouchStart={handleListTouchStart}
          onTouchEnd={handleListTouchEnd}
        >
          <div className="mobile-butler-drawer-header">
            <div>
              <h2>{t("shell.butlerHistoryTitle")}</h2>
              <p>{t("shell.butlerHistoryDescription")}</p>
            </div>
            <button
              type="button"
              className="mobile-butler-toolbar-button"
              aria-label={t("shell.butlerNewSessionAction")}
              onClick={() => {
                void handleStartFreshSession();
              }}
            >
              +
            </button>
          </div>
          <div className="mobile-butler-list-body">
            <MobileButlerConversationList
              activeControlSessionId={controlSession?.id ?? null}
              sessions={state.controlSessions}
              onSelectSession={(controlSessionId) => {
                void handleOpenControlSession(controlSessionId);
              }}
            />
          </div>
        </aside>

        <div
          className="mobile-butler-main-stage"
          onTouchStart={handleStageTouchStart}
          onTouchEnd={handleStageTouchEnd}
        >
          {showLoadingState ? (
            <section className="mobile-butler-loading-shell">
              <ButlerLoadingState />
            </section>
          ) : showEmptyState ? (
            <section className="mobile-butler-empty-panel">
              <h2>{t("shell.mobileButlerEmptyTitle")}</h2>
              <p>{t("shell.mobileButlerEmptyBody")}</p>
            </section>
          ) : (
            <>
              <div className="mobile-butler-chat-body">
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
                {runtimeEmpty ? (
                  <section className="mobile-butler-empty-panel">
                    <h2>{t("shell.butlerConversationTitle")}</h2>
                    <p>{t("shell.butlerProjectSyncEmptyState")}</p>
                  </section>
                ) : (
                  <div className="conversation-timeline-shell mobile-butler-timeline-shell">
                    <MessageTimeline
                      sessionId={controlSession?.session?.sessionId}
                      messages={messages}
                      historyState={historyState}
                      loadingOlderMessages={loadingOlderMessages}
                      hasOlderMessages={hasOlderMessages}
                      provider={activeProvider}
                      onLoadOlderMessages={() => {
                        void store.loadOlderMessages();
                      }}
                      onRetryMessage={(clientRequestId) => {
                        void store.retryMessage(clientRequestId);
                      }}
                    />
                  </div>
                )}
              </div>
              {activeControlSchedule ? (
                <MobileButlerControlTimerBanner
                  schedule={activeControlSchedule}
                  currentWorkspaceId={workspaceId}
                  currentWorkspaceName={currentWorkspace?.name ?? null}
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
                  executingNow={executingTimerId === activeControlScheduleId(activeControlSchedule)}
                  onCancel={() => {
                    void handleCancelControlSchedule(activeControlSchedule);
                  }}
                  onExecuteNow={() => {
                    void handleExecuteControlScheduleNow(activeControlSchedule);
                  }}
                  onOpenSession={() => {
                    handleOpenControlScheduleSession(activeControlSchedule);
                  }}
                />
              ) : null}
              {showComposer ? (
                <div className="mobile-butler-chat-composer" data-mobile-butler-gesture="ignore">
                  <ComposerPanel
                    capabilities={capabilities}
                    draftStorageId={`mobile-butler:${workspaceId}:${activeProvider}`}
                    panelRef={setComposerPanelElement}
                    portalContainer={composerPortalTarget}
                    placeholder={t("shell.butlerComposerPlaceholder", {
                      displayName: butlerDisplayName
                    })}
                    hasActiveRun={composerHasActiveRun}
                    canInterrupt={composerCanInterrupt}
                    contextUsage={contextUsage}
                    isSubmitting={runtimeSending}
                    isRunning={composerIsRunning}
                    onInterrupt={async () => {
                      await store.interrupt();
                      requestNavigationRefresh();
                    }}
                    onSend={async (content, options) => {
                      await handleSendMessage(content, options);
                    }}
                  />
                </div>
              ) : null}
            </>
          )}
        </div>

        <aside
          className="mobile-butler-drawer mobile-butler-drawer-sidebar"
          style={{ width: `min(88vw, ${MOBILE_BUTLER_DRAWER_WIDTH_PX}px)` }}
          onTouchStart={handleSidebarTouchStart}
          onTouchEnd={handleSidebarTouchEnd}
        >
          <div className="mobile-butler-sidebar-shell">
            <div
              className="mobile-butler-segmented-shell"
              data-mobile-butler-gesture="ignore"
            >
              <div
                className="mobile-butler-segmented-control"
                role="tablist"
                aria-label={t("shell.butlerSidebarTabsLabel")}
              >
                {MOBILE_BUTLER_TAB_ORDER.map((tabId) => {
                  const selected = activeTab === tabId;
                  const label =
                    tabId === "info"
                      ? t("shell.butlerSidebarInfoTab")
                      : tabId === "automation"
                        ? t("shell.butlerSidebarAutomationTab")
                        : t("shell.butlerSidebarSettingsTab");

                  return (
                    <button
                      key={tabId}
                      type="button"
                      role="tab"
                      className="mobile-butler-segmented-button"
                      aria-selected={selected}
                      onClick={() => {
                        selectTab(tabId);
                      }}
                    >
                      {label}
                    </button>
                  );
                })}
              </div>
            </div>
            <div className="mobile-page-top-body mobile-butler-body mobile-butler-sidebar-body">
              {sidebarContent}
            </div>
          </div>
        </aside>
      </div>
    </main>
  );
}

function MobileButlerControlTimerBanner(props: {
  schedule: ButlerControlScheduleBannerItem;
  currentWorkspaceId: string;
  currentWorkspaceName: string | null;
  projectNameById: Map<string, string>;
  workspaceNameById: Map<string, string>;
  sessionTitleById: Map<string, string>;
  sessionWorkspaceIdById: Map<string, string>;
  countdownNow: number;
  cancelling: boolean;
  executingNow: boolean;
  onCancel: () => void;
  onExecuteNow: () => void;
  onOpenSession: () => void;
}) {
  const detailButtonId = useId();
  const detailPopoverId = useId();
  const detailRef = useRef<HTMLDivElement | null>(null);
  const detailPopoverRef = useRef<HTMLDivElement | null>(null);
  const [detailOpen, setDetailOpen] = useState(false);
  const countdownText = resolveControlScheduleCountdownLabel(props.schedule, props.countdownNow);
  const countdownClockText = resolveControlScheduleClockLabel(props.schedule, props.countdownNow);
  const workspaceText = resolveControlScheduleWorkspaceLabel(
    props.schedule,
    props.projectNameById,
    props.workspaceNameById,
    props.currentWorkspaceId,
    props.currentWorkspaceName
  );
  const sessionText = resolveControlScheduleSessionLabel(props.schedule, props.sessionTitleById);
  const promptContent = resolveControlSchedulePromptContent(props.schedule);
  const targetSessionId = resolveControlScheduleTargetSessionId(props.schedule);
  const canOpenSession = Boolean(
    targetSessionId
    && (props.sessionWorkspaceIdById.has(targetSessionId) || readControlScheduleWorkspaceId(props.schedule))
  );
  const canExecuteNow = canExecuteControlScheduleNow(props.schedule);

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
    <section className="mobile-feature-panel surface-card mobile-butler-timer-banner" aria-live="polite">
      <div className="mobile-butler-timer-status">
        <span className="mobile-butler-timer-pulse" aria-hidden="true" />
        <span className="mobile-butler-timer-caption">{t("shell.butlerControlTimerBannerTitle")}</span>
      </div>
      <div className="mobile-butler-timer-display-panel">
        <p className="mobile-butler-timer-display-clock">{countdownClockText}</p>
        <p className="mobile-butler-timer-countdown">{countdownText}</p>
      </div>
      <div className="mobile-butler-timer-meta">
        <div className="mobile-butler-timer-meta-card">
          <span>{t("shell.butlerControlTimerWorkspaceLabel")}</span>
          <strong title={workspaceText}>{workspaceText}</strong>
        </div>
        <div className="mobile-butler-timer-meta-card">
          <span>{t("shell.butlerControlTimerSessionLabel")}</span>
          {canOpenSession ? (
            <button
              type="button"
              className="mobile-butler-timer-session-link"
              title={sessionText}
              aria-label={`${t("shell.butlerControlTimerSessionLabel")}：${sessionText}`}
              style={{
                padding: 0,
                border: "none",
                background: "transparent",
                color: "inherit",
                font: "inherit",
                fontWeight: 600,
                minWidth: 0,
                overflow: "hidden",
                textOverflow: "ellipsis",
                whiteSpace: "nowrap",
                cursor: "pointer",
                textDecoration: "underline"
              }}
              onClick={props.onOpenSession}
            >
              {sessionText}
            </button>
          ) : (
            <strong title={sessionText}>{sessionText}</strong>
          )}
        </div>
      </div>
      <div className="mobile-butler-timer-actions">
        <div className="mobile-butler-timer-detail" ref={detailRef}>
          <button
            id={detailButtonId}
            type="button"
            className="mobile-butler-timer-detail-button"
            aria-label={t("shell.butlerControlTimerDetailAction")}
            aria-haspopup="dialog"
            aria-expanded={detailOpen}
            aria-controls={detailOpen ? detailPopoverId : undefined}
            title={t("shell.butlerControlTimerDetailAction")}
            onClick={() => {
              setDetailOpen((current) => !current);
            }}
          >
            <span className="mobile-butler-timer-detail-icon" aria-hidden="true">
              <TimerDetailIcon />
            </span>
          </button>
          <ButlerAnchoredPopover
            open={detailOpen}
            id={detailPopoverId}
            className="mobile-butler-timer-detail-popover"
            anchorRef={detailRef}
            popoverRef={detailPopoverRef}
            labelledBy={detailButtonId}
            maxWidth={288}
            gap={8}
            viewportPadding={12}
          >
            <div>
              <strong>{t("shell.butlerControlTimerPromptTitle")}</strong>
              <p>{promptContent}</p>
            </div>
          </ButlerAnchoredPopover>
        </div>
        {canExecuteNow ? (
          <button
            type="button"
            className="secondary-button mobile-butler-timer-action"
            disabled={props.cancelling || props.executingNow}
            onClick={props.onExecuteNow}
          >
            {props.executingNow
              ? t("shell.butlerControlTimerExecutingNow")
              : t("shell.butlerControlTimerExecuteNowAction")}
          </button>
        ) : null}
        <button
          type="button"
          className="secondary-button mobile-butler-timer-action"
          disabled={props.cancelling || props.executingNow}
          onClick={props.onCancel}
        >
          {props.cancelling
            ? t("shell.butlerControlTimerCancelling")
            : t("shell.butlerControlTimerStopAction")}
        </button>
      </div>
      {canExecuteNow ? (
        <p className="mobile-butler-timer-note">{t("shell.butlerControlTimerActionNote")}</p>
      ) : null}
    </section>
  );
}

function InfoMetric({ label, value }: { label: string; value: string }) {
  return (
    <div className="mobile-butler-info-metric">
      <span>{label}</span>
      <strong title={value}>{value}</strong>
    </div>
  );
}

function MobileAutomationOverviewSection(props: {
  items: AutomationTaskItem[];
  emptyText: string;
  actionLabel?: string;
  onAction?: () => void;
  selectedAutomationId: string | null;
  cancellingAutomationId: string | null;
  onSelectAutomation: (automationId: string) => void;
  onCancelAutomation: (automationId: string) => void;
}) {
  return (
    <section className="mobile-feature-panel surface-card mobile-butler-record-section">
      <div className="mobile-feature-section-header">
        <div>
          <h2>{t("shell.butlerAutomationTasksTitle")}</h2>
          <p>{t("shell.butlerAutomationMobileOverviewDescription")}</p>
        </div>
        <div className="mobile-feature-section-actions">
          {props.actionLabel && props.onAction ? (
            <button
              type="button"
              className="mobile-butler-section-action"
              onClick={props.onAction}
            >
              {props.actionLabel}
            </button>
          ) : null}
          <span className="mobile-feature-counter">{props.items.length}</span>
        </div>
      </div>
      {props.items.length > 0 ? (
        <div className="mobile-butler-automation-grid">
          {props.items.map((item) => (
            <article
              key={item.id}
              className="mobile-butler-automation-card"
              data-selected={props.selectedAutomationId === item.automationId}
            >
              <header className="mobile-butler-record-header">
                <div className="mobile-butler-record-copy">
                  <strong>{item.title}</strong>
                  <span>{item.projectName}</span>
                </div>
                <span className="mobile-butler-record-badge">{item.statusLabel}</span>
              </header>
              <div className="mobile-butler-automation-chip-row">
                <span className="mobile-butler-automation-chip">{item.taskTypeLabel}</span>
                {item.targetSessionTitle ? (
                  <span className="mobile-butler-automation-chip">{item.targetSessionTitle}</span>
                ) : null}
              </div>
              <div className="mobile-butler-automation-metric-grid">
                <div className="mobile-butler-automation-metric">
                  <span>{t("shell.butlerAutomationTaskNextRunLabel")}</span>
                  <strong>{formatIsoDateTime(item.nextRunAt)}</strong>
                </div>
                <div className="mobile-butler-automation-metric">
                  <span>{t("shell.butlerAutomationTaskLastRunLabel")}</span>
                  <strong>{formatIsoDateTime(item.lastRunAt)}</strong>
                </div>
              </div>
              <p className="mobile-butler-automation-summary">{item.promptPreview}</p>
              {item.lastResultSummary ? (
                <p className="mobile-butler-automation-footnote">{item.lastResultSummary}</p>
              ) : null}
              <footer className="mobile-butler-record-footer">
                <button
                  type="button"
                  className="secondary-button mobile-butler-record-action"
                  onClick={() => {
                    if (item.automationId) {
                      props.onSelectAutomation(item.automationId);
                    }
                  }}
                >
                  {props.selectedAutomationId === item.automationId
                    ? t("shell.butlerAutomationCollapseDetailsAction")
                    : t("shell.butlerAutomationOpenDetailsAction")}
                </button>
                {item.automationId && item.status === "active" ? (
                  <button
                    type="button"
                    className="secondary-button mobile-butler-record-action"
                    disabled={props.cancellingAutomationId === item.automationId}
                    onClick={() => {
                      props.onCancelAutomation(item.automationId!);
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
        <p className="mobile-butler-empty-text">{props.emptyText}</p>
      )}
    </section>
  );
}

function MobileAutomationDetailPanel(props: {
  automation: AssistantAutomationTaskDto;
  editorState: AutomationEditorState;
  saving: boolean;
  recentRuns: AssistantAutomationRunDto[];
  sessionTitleById: ReadonlyMap<string, string>;
  workspaceNameById: ReadonlyMap<string, string>;
  onEditorChange: (patch: Partial<AutomationEditorState>) => void;
  onSave: () => void;
  onClose: () => void;
}) {
  const projectLabel = props.automation.projectId?.trim()
    ? props.workspaceNameById.get(props.automation.controlSession?.session?.workspaceId ?? "")
    : null;
  const targetSessionLabel = resolveAutomationTargetSessionLabel(props.automation, props.sessionTitleById);

  return (
    <section className="mobile-feature-panel surface-card mobile-butler-record-section mobile-butler-automation-detail-panel">
      <div className="mobile-feature-section-header">
        <div>
          <h2>{t("shell.butlerAutomationDetailTitle")}</h2>
          <p>{t("shell.butlerAutomationDetailDescription")}</p>
        </div>
        <button
          type="button"
          className="mobile-butler-section-action"
          onClick={props.onClose}
        >
          {t("common.close")}
        </button>
      </div>
      <div className="mobile-butler-automation-detail-summary">
        <InfoMetric
          label={t("shell.butlerAutomationTaskTypeLabel")}
          value={resolveAutomationTaskTypeLabel(props.automation.triggerType)}
        />
        <InfoMetric
          label={t("shell.butlerAutomationStatusLabel")}
          value={resolveAssistantAutomationTaskStatusLabel(props.automation.status)}
        />
        <InfoMetric
          label={t("shell.butlerAutomationTaskNextRunLabel")}
          value={formatIsoDateTime(props.automation.nextRunAt)}
        />
        <InfoMetric
          label={t("shell.butlerAutomationTaskLastRunLabel")}
          value={formatIsoDateTime(props.automation.lastRunAt || props.automation.updatedAt)}
        />
        {projectLabel ? (
          <InfoMetric
            label={t("shell.mobileButlerAssistantWorkspaceLabel")}
            value={projectLabel}
          />
        ) : null}
        {targetSessionLabel ? (
          <InfoMetric
            label={t("shell.butlerAutomationTargetSessionLabel")}
            value={targetSessionLabel}
          />
        ) : null}
      </div>

      <div className="mobile-butler-automation-form-grid">
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
            className="butler-form-control mobile-butler-automation-textarea"
            value={props.editorState.content}
            disabled={props.saving}
            onChange={(event) => {
              props.onEditorChange({
                content: event.target.value
              });
            }}
          />
        </label>

        <label className="mobile-butler-automation-toggle">
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

        <AutomationTriggerFields
          automation={props.automation}
          editorState={props.editorState}
          saving={props.saving}
          onEditorChange={props.onEditorChange}
        />
      </div>

      {props.recentRuns.length > 0 ? (
        <div className="mobile-butler-automation-detail-runs">
          <div className="mobile-feature-section-header">
            <div>
              <h2>{t("shell.butlerAutomationRunsTitle")}</h2>
            </div>
            <span className="mobile-feature-counter">{props.recentRuns.length}</span>
          </div>
          <div className="mobile-butler-record-list">
            {props.recentRuns.map((run) => (
              <article key={run.id} className="mobile-butler-record-card">
                <header className="mobile-butler-record-header">
                  <div className="mobile-butler-record-copy">
                    <strong>{t("shell.butlerAutomationRoundLabel", { round: run.runSeq })}</strong>
                    <span>{resolveAutomationRunSourceLabel(run.triggerType)}</span>
                  </div>
                  <span className="mobile-butler-record-badge">
                    {resolveAssistantAutomationRunStatusLabel(run.status)}
                  </span>
                </header>
                <p>{run.summary?.trim() || run.error?.trim() || t("shell.butlerAutomationRunEmptySummary")}</p>
                <footer className="mobile-butler-record-footer">
                  <span>{formatIsoDateTime(run.createdAt)}</span>
                </footer>
              </article>
            ))}
          </div>
        </div>
      ) : null}

      <footer className="mobile-butler-automation-detail-actions">
        <button
          type="button"
          className="secondary-button"
          disabled={props.saving}
          onClick={props.onClose}
        >
          {t("common.close")}
        </button>
        <button
          type="button"
          className="primary-button"
          disabled={props.saving}
          onClick={props.onSave}
        >
          {props.saving ? t("shell.butlerAutomationSaving") : t("shell.butlerAutomationSaveAction")}
        </button>
      </footer>
    </section>
  );
}

function AutomationTriggerFields(props: {
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

function RecordSection(props: {
  title: string;
  emptyText: string;
  actionLabel?: string;
  onAction?: () => void;
  items: Array<{
    id: string;
    title: string;
    subtitle: string | null;
    status: string | null;
    content: string;
    meta: string | null;
    actionLabel?: string | null;
    actionDisabled?: boolean;
    onAction?: () => void;
  }>;
}) {
  return (
    <section className="mobile-feature-panel surface-card mobile-butler-record-section">
      <div className="mobile-feature-section-header">
        <div>
          <h2>{props.title}</h2>
        </div>
        <div className="mobile-feature-section-actions">
          {props.actionLabel && props.onAction ? (
            <button
              type="button"
              className="mobile-butler-section-action"
              onClick={props.onAction}
            >
              {props.actionLabel}
            </button>
          ) : null}
          <span className="mobile-feature-counter">{props.items.length}</span>
        </div>
      </div>
      {props.items.length > 0 ? (
        <div className="mobile-butler-record-list">
          {props.items.map((item) => (
            <article key={item.id} className="mobile-butler-record-card">
              <header className="mobile-butler-record-header">
                <div className="mobile-butler-record-copy">
                  <strong>{item.title}</strong>
                  {item.subtitle ? <span>{item.subtitle}</span> : null}
                </div>
                {item.status ? (
                  <span className="mobile-butler-record-badge">{item.status}</span>
                ) : null}
              </header>
              <p>{item.content}</p>
              {item.meta || item.actionLabel ? (
                <footer className="mobile-butler-record-footer">
                  {item.meta ? <span>{item.meta}</span> : <span />}
                  {item.actionLabel && item.onAction ? (
                    <button
                      type="button"
                      className="secondary-button mobile-butler-record-action"
                      disabled={item.actionDisabled}
                      onClick={item.onAction}
                    >
                      {item.actionLabel}
                    </button>
                  ) : null}
                </footer>
              ) : null}
            </article>
          ))}
        </div>
      ) : (
        <p className="mobile-butler-empty-text">{props.emptyText}</p>
      )}
    </section>
  );
}

function CompactRecordSection(props: {
  title: string;
  emptyText: string;
  actionLabel?: string;
  onAction?: () => void;
  items: Array<{
    id: string;
    title: string;
    content: string;
  }>;
}) {
  return (
    <section className="mobile-feature-panel surface-card mobile-butler-record-section mobile-butler-record-section-compact">
      <div className="mobile-feature-section-header">
        <div>
          <h2>{props.title}</h2>
        </div>
        {props.actionLabel && props.onAction ? (
          <button
            type="button"
            className="mobile-butler-section-action"
            onClick={props.onAction}
          >
            {props.actionLabel}
          </button>
        ) : null}
      </div>
      {props.items.length > 0 ? (
        <div className="mobile-butler-record-list mobile-butler-record-list-compact">
          {props.items.map((item) => (
            <article key={item.id} className="mobile-butler-compact-record">
              <span>{item.title}</span>
              <strong>{item.content}</strong>
            </article>
          ))}
        </div>
      ) : (
        <p className="mobile-butler-empty-text">{props.emptyText}</p>
      )}
    </section>
  );
}

function MobileHistoryPanel(props: {
  title: string;
  description: string;
  emptyText: string;
  onClose: () => void;
  items: Array<{
    id: string;
    title: string;
    subtitle: string | null;
    status: string | null;
    content: string;
    meta: string | null;
    actionLabel?: string | null;
    actionDisabled?: boolean;
    onAction?: () => void;
  }>;
}) {
  return (
    <section className="mobile-feature-panel surface-card mobile-butler-record-section">
      <div className="mobile-feature-section-header">
        <div>
          <h2>{props.title}</h2>
          <p>{props.description}</p>
        </div>
        <button
          type="button"
          className="mobile-butler-section-action"
          onClick={props.onClose}
        >
          {t("common.close")}
        </button>
      </div>
      {props.items.length > 0 ? (
        <div className="mobile-butler-record-list">
          {props.items.map((item) => (
            <article key={item.id} className="mobile-butler-record-card">
              <header className="mobile-butler-record-header">
                <div className="mobile-butler-record-copy">
                  <strong>{item.title}</strong>
                  {item.subtitle ? <span>{item.subtitle}</span> : null}
                </div>
                {item.status ? <span className="mobile-butler-record-badge">{item.status}</span> : null}
              </header>
              <p>{item.content}</p>
              {item.meta || item.actionLabel ? (
                <footer className="mobile-butler-record-footer">
                  {item.meta ? <span>{item.meta}</span> : <span />}
                  {item.actionLabel && item.onAction ? (
                    <button
                      type="button"
                      className="secondary-button mobile-butler-record-action"
                      disabled={item.actionDisabled}
                      onClick={item.onAction}
                    >
                      {item.actionLabel}
                    </button>
                  ) : null}
                </footer>
              ) : null}
            </article>
          ))}
        </div>
      ) : (
        <p className="mobile-butler-empty-text">{props.emptyText}</p>
      )}
    </section>
  );
}

function MobileAutomationHistoryPanel(props: {
  taskItems: AutomationTaskItem[];
  runItems: AutomationRunItem[];
  onClose: () => void;
}) {
  return (
    <div className="mobile-butler-history-stack">
      <section className="mobile-feature-panel surface-card mobile-butler-record-section">
        <div className="mobile-feature-section-header">
          <div>
            <h2>{t("shell.butlerAutomationHistoryTitle")}</h2>
            <p>{t("shell.butlerAutomationHistoryDescription")}</p>
          </div>
          <button
            type="button"
            className="mobile-butler-section-action"
            onClick={props.onClose}
          >
            {t("common.close")}
          </button>
        </div>
        {props.taskItems.length === 0 && props.runItems.length === 0 ? (
          <p className="mobile-butler-empty-text">{t("shell.butlerAutomationHistoryEmpty")}</p>
        ) : null}
      </section>
      {props.taskItems.length > 0 ? (
        <RecordSection
          title={t("shell.butlerAutomationTasksTitle")}
          emptyText={t("shell.butlerAutomationHistoryEmpty")}
          items={props.taskItems.map((item) => ({
            id: item.id,
            title: item.title,
            subtitle: item.projectName,
            status: item.statusLabel,
            content: `${t("shell.butlerAutomationTaskTypeLabel")} · ${item.taskTypeLabel}`,
            meta: `${t("shell.butlerAutomationTaskLastRunLabel")} · ${formatIsoDateTime(item.lastRunAt)}`
          }))}
        />
      ) : null}
      {props.runItems.length > 0 ? (
        <RecordSection
          title={t("shell.butlerAutomationRunsTitle")}
          emptyText={t("shell.butlerAutomationHistoryEmpty")}
          items={props.runItems.map((item) => ({
            id: item.id,
            title: item.title,
            subtitle: item.projectName,
            status: item.statusLabel,
            content: `${item.sourceLabel} · ${item.summary}`,
            meta: formatIsoDateTime(item.createdAt)
          }))}
        />
      ) : null}
    </div>
  );
}

function MobileButlerConversationList(props: {
  sessions: ButlerControlSessionDto[];
  activeControlSessionId: string | null;
  onSelectSession: (controlSessionId: string) => void;
}) {
  if (props.sessions.length === 0) {
    return <p className="mobile-butler-empty-text">{t("shell.butlerHistoryEmpty")}</p>;
  }

  return (
    <div className="mobile-butler-record-list">
      {props.sessions.map((session) => {
        const selected = session.id === props.activeControlSessionId;
        const title =
          session.title?.trim()
          || session.session.title?.trim()
          || session.lastSummary?.trim()
          || session.sessionId;

        return (
          <article
            key={session.id}
            className="mobile-butler-record-card mobile-butler-history-card"
            data-active={selected}
          >
            <header className="mobile-butler-record-header">
              <div className="mobile-butler-record-copy">
                <strong>{title}</strong>
                <span>{formatIsoDateTime(session.updatedAt)}</span>
              </div>
              {selected ? (
                <span className="mobile-butler-record-badge">{t("shell.butlerCurrentSessionBadge")}</span>
              ) : null}
            </header>
            <p>{session.lastSummary?.trim() || session.session.title?.trim() || session.sessionId}</p>
            <button
              type="button"
              className="secondary-button"
              onClick={() => {
                props.onSelectSession(session.id);
              }}
            >
              {selected ? t("shell.butlerCurrentSessionBadge") : t("shell.butlerHistoryOpenAction")}
            </button>
          </article>
        );
      })}
    </div>
  );
}

function useMobileButlerComposerHeightVar(
  rootRef: RefObject<HTMLElement | null>,
  composerPanelElement: HTMLElement | null,
  enabled: boolean,
  resetKey: string
) {
  useEffect(() => {
    const rootElement = rootRef.current;

    if (!enabled || !rootElement) {
      if (rootElement) {
        rootElement.style.removeProperty("--mobile-conversation-composer-height");
      }
      return;
    }

    if (!composerPanelElement) {
      rootElement.style.removeProperty("--mobile-conversation-composer-height");
      return;
    }

    const stableRootElement = rootElement;
    const stableComposerPanel = composerPanelElement;

    function syncComposerHeight() {
      if (!rootRef.current || !stableComposerPanel.isConnected) {
        return;
      }

      stableRootElement.style.setProperty(
        "--mobile-conversation-composer-height",
        `${stableComposerPanel.offsetHeight}px`
      );
    }

    syncComposerHeight();

    const resizeObserver =
      typeof ResizeObserver !== "undefined" ? new ResizeObserver(syncComposerHeight) : null;

    resizeObserver?.observe(stableComposerPanel);
    window.addEventListener("resize", syncComposerHeight);

    return () => {
      resizeObserver?.disconnect();
      window.removeEventListener("resize", syncComposerHeight);
      rootElement.style.removeProperty("--mobile-conversation-composer-height");
    };
  }, [composerPanelElement, enabled, resetKey, rootRef]);
}

function buildVerificationRecords(
  verifications: Array<{
    id: string;
    projectId: string;
    targetRef: string | null;
    verificationType: string;
    summary: string | null;
    status: string;
    finishedAt: string | null;
    startedAt: string | null;
    createdAt: string;
  }>,
  mode: "active" | "history"
): Array<{
  id: string;
  title: string;
  subtitle: string | null;
  status: string;
  content: string;
  meta: string | null;
  verification: {
    id: string;
    projectId: string;
    status: string;
  };
}> {
  return [...verifications]
    .filter((verification) => (
      mode === "history"
        ? !isVisibleMobileVerification(verification.status)
        : isVisibleMobileVerification(verification.status)
    ))
    .sort((left, right) => parseIsoTime(resolveVerificationTime(right)) - parseIsoTime(resolveVerificationTime(left)))
    .slice(0, 4)
    .map((verification) => ({
      id: verification.id,
      title: verification.targetRef?.trim() || verification.verificationType,
      subtitle: verification.verificationType,
      status: resolveMobileVerificationStatusLabel(verification.status),
      content:
        verification.summary?.trim()
        || t("shell.butlerInfoVerificationFallback", {
          status: verification.status
        }),
      meta: formatIsoDateTime(resolveVerificationTime(verification)),
      verification: {
        id: verification.id,
        projectId: verification.projectId,
        status: verification.status
      }
    }));
}

function buildTodoRecords(items: ButlerInboxItemDto[]): Array<{ title: string; content: string }> {
  return items.map((item) => ({
    title: item.title,
    content: `${item.projectName} · ${resolveTodoStatusLabel(item.status)}`
  }));
}

function replaceControlTimer(
  timers: ButlerControlTimerDto[],
  nextTimer: ButlerControlTimerDto
): ButlerControlTimerDto[] {
  const nextTimers = timers.filter((timer) => timer.id !== nextTimer.id);
  return [nextTimer, ...nextTimers]
    .sort((left, right) => parseIsoTime(resolveControlTimerSortTime(right)) - parseIsoTime(resolveControlTimerSortTime(left)));
}

function replaceAssistantAutomation(
  automations: AssistantAutomationTaskDto[],
  nextAutomation: AssistantAutomationTaskDto
): AssistantAutomationTaskDto[] {
  const nextAutomations = automations.filter((automation) => automation.id !== nextAutomation.id);
  return [nextAutomation, ...nextAutomations]
    .sort((left, right) => parseIsoTime(resolveAssistantAutomationSortTime(right)) - parseIsoTime(resolveAssistantAutomationSortTime(left)));
}

function replaceFollowUpTask(
  tasks: ButlerFollowUpTaskDto[],
  nextTask: ButlerFollowUpTaskDto
): ButlerFollowUpTaskDto[] {
  const nextTasks = tasks.filter((task) => task.id !== nextTask.id);
  return [nextTask, ...nextTasks]
    .sort((left, right) => parseIsoTime(resolveFollowUpTaskUpdatedAt(right)) - parseIsoTime(resolveFollowUpTaskUpdatedAt(left)));
}

function isVisibleMobileFollowUpTask(status: ButlerFollowUpTaskDto["status"]): boolean {
  return status === "active" || status === "waiting_user";
}

function isCancelableMobileFollowUpTask(status: ButlerFollowUpTaskDto["status"]): boolean {
  return status === "active" || status === "waiting_user";
}

function isVisibleMobileVerification(status: string): boolean {
  return status === "queued" || status === "running";
}

function isCancelableMobileVerification(status: string): boolean {
  return status === "queued" || status === "running";
}

function resolveMobileVerificationStatusLabel(status: string): string {
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

function buildAutomationTaskItems(
  automations: AssistantAutomationTaskDto[],
  overview: ButlerOverviewDto | null,
  workspaceProjectIds: ReadonlySet<string>,
  mode: "active" | "history" = "active"
): AutomationTaskItem[] {
  const projectNameById = new Map(
    (overview?.projects ?? [])
      .filter((project) => workspaceProjectIds.has(project.id))
      .map((project) => [project.id, project.name] as const)
  );
  const items = automations
    .filter((automation) => isAssistantAutomationVisibleInWorkspace(automation, workspaceProjectIds, overview))
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
      lastRunAt: automation.lastRunAt || automation.updatedAt,
      promptPreview: summarizeAutomationPrompt(automation.actionConfig.content),
      lastResultSummary: automation.lastRunSummary?.trim() || automation.lastError?.trim() || null,
      targetSessionTitle: resolveAutomationTargetSessionLabel(automation)
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
    .slice(0, 8);
}

function buildAutomationRunItems(
  automations: AssistantAutomationTaskDto[],
  runs: AssistantAutomationRunDto[],
  overview: ButlerOverviewDto | null,
  workspaceProjectIds: ReadonlySet<string>,
  mode: "active" | "history" = "active"
): AutomationRunItem[] {
  const projectNameById = new Map(
    (overview?.projects ?? [])
      .filter((project) => workspaceProjectIds.has(project.id))
      .map((project) => [project.id, project.name] as const)
  );
  const automationById = new Map(
    automations
      .filter((automation) => isAssistantAutomationVisibleInWorkspace(automation, workspaceProjectIds, overview))
      .map((automation) => [automation.id, automation] as const)
  );
  const automationRunItems = runs
    .map((run) => ({
      run,
      automation: automationById.get(run.automationId),
      normalizedStatus: normalizeAutomationRunStatus(run.status)
    }))
    .filter(({ automation }) => Boolean(automation))
    .filter(({ normalizedStatus }) => (
      mode === "history"
        ? !isActiveMobileAutomationRunStatus(normalizedStatus)
        : isActiveMobileAutomationRunStatus(normalizedStatus)
    ))
    .map<AutomationRunItem>(({ run, automation, normalizedStatus }) => ({
      id: `assistant-automation-run:${run.id}`,
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
    .slice(0, 10);
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
  sessionTitleById: ReadonlyMap<string, string> = new Map()
): string | null {
  const targetSessionId = automation.actionConfig.targetSessionId?.trim();

  if (targetSessionId && sessionTitleById.has(targetSessionId)) {
    return sessionTitleById.get(targetSessionId)!;
  }

  if (automation.controlSession?.session?.title?.trim()) {
    return automation.controlSession.session.title.trim();
  }

  if (targetSessionId) {
    return targetSessionId;
  }

  return null;
}

function summarizeAutomationPrompt(content: string): string {
  const normalized = content.replace(/\s+/g, " ").trim();

  if (!normalized) {
    return t("conversation.butlerAnalysisEmpty");
  }

  if (normalized.length <= 72) {
    return normalized;
  }

  return `${normalized.slice(0, 72)}...`;
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
  } satisfies {
    title: string | null;
    content: string;
    includeTriggerContext: boolean;
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

function resolveAssistantAutomationSortTime(automation: AssistantAutomationTaskDto): string {
  return automation.updatedAt || automation.lastRunAt || automation.nextRunAt || automation.createdAt;
}

function isAssistantAutomationVisibleInWorkspace(
  automation: AssistantAutomationTaskDto,
  workspaceProjectIds: ReadonlySet<string>,
  overview: ButlerOverviewDto | null
): boolean {
  if (automation.projectId && workspaceProjectIds.has(automation.projectId)) {
    return true;
  }

  const workspaceId = automation.controlSession?.session?.workspaceId?.trim();

  if (!workspaceId) {
    return false;
  }

  return (overview?.projects ?? []).some((project) => project.workspaceId === workspaceId && workspaceProjectIds.has(project.id));
}

function isActiveMobileAutomationRunStatus(status: AutomationRunItem["status"]): boolean {
  return status === "active" || status === "waiting_user";
}

function resolveVerificationTime(verification: {
  finishedAt: string | null;
  startedAt: string | null;
  createdAt: string;
}): string | null {
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

function formatIsoDateTime(value: string | null | undefined): string {
  if (!value) {
    return "-";
  }

  const date = new Date(value);

  if (Number.isNaN(date.getTime())) {
    return value;
  }

  return new Intl.DateTimeFormat(undefined, {
    month: "2-digit",
    day: "2-digit",
    hour: "2-digit",
    minute: "2-digit"
  }).format(date);
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

function resolveProviderLabel(providerId: ButlerProfileDto["providerId"]): string {
  switch (providerId) {
    case "claude-code":
      return "Claude Code";
    case "codex":
    default:
      return "Codex";
  }
}

function resolvePersonaToneLabel(tone: ButlerProfileDto["persona"]["tone"]): string {
  switch (tone) {
    case "friendly":
      return t("shell.butlerToneFriendly");
    case "steady":
      return t("shell.butlerToneSteady");
    case "direct":
    default:
      return t("shell.butlerToneDirect");
  }
}

function resolvePersonaLanguageLabel(language: ButlerProfileDto["persona"]["language"]): string {
  switch (language) {
    case "en-US":
      return t("shell.butlerLanguageEnUs");
    case "bilingual":
      return t("shell.butlerLanguageBilingual");
    case "zh-CN":
    default:
      return t("shell.butlerLanguageZhCn");
  }
}
