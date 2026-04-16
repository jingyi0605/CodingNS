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
import {
  cancelButlerControlTimer,
  getButlerOverview,
  getButlerProfile,
  listButlerControlSessions,
  listButlerControlTimers,
  listButlerFollowUpTasks,
  listButlerInboxItems,
  listButlerPatrolPlans,
  type ButlerControlSessionDto,
  type ButlerControlTimerDto,
  type ButlerFollowUpTaskDto,
  type ButlerInboxItemDto,
  type ButlerOverviewDto,
  type ButlerPatrolPlanDto,
  type ButlerProfileDto
} from "../api/butler-api";
import { ButlerLoadingState } from "../components/ButlerLoadingState";
import { BUTLER_INBOX_UPDATED_EVENT } from "../runtime/butler-inbox-events";
import { subscribeButlerRecordsUpdated } from "../runtime/butler-records-events";
import { ButlerRuntimeStore, useButlerRuntimeStore } from "../runtime/butler-runtime-store";
import { buildWorkspaceButlerPath } from "../../workbench/utils/workbench-navigation";

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
}

interface AutomationTaskItem {
  id: string;
  timerId?: string;
  kind: "patrol_plan" | "follow_up" | "control_timer";
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
  kind: "patrol_run" | "follow_up_round" | "control_timer";
  title: string;
  projectName: string;
  status: "active" | "waiting_user" | "completed" | "failed" | "cancelled";
  sourceLabel: string;
  statusLabel: string;
  summary: string;
  createdAt: string;
}

const MOBILE_BUTLER_TAB_STORAGE_KEY = "mobile.butler.active-tab";
const MOBILE_BUTLER_TAB_ORDER: MobileButlerTab[] = ["info", "automation", "settings"];
const MOBILE_BUTLER_POLL_INTERVAL_MS = 15_000;
const MOBILE_BUTLER_SWIPE_THRESHOLD_PX = 56;
const MOBILE_BUTLER_SWIPE_DOMINANCE_RATIO = 1.2;
const MOBILE_BUTLER_DRAWER_WIDTH_PX = 360;

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
  const [cancellingTimerId, setCancellingTimerId] = useState<string | null>(null);
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
    controlTimers: []
  });

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
  const runtimeHasActiveRun = useButlerRuntimeStore(store, (runtime) => runtime.runtimeHasActiveRun);
  const runtimeCanInterrupt = useButlerRuntimeStore(store, (runtime) => runtime.runtimeCanInterrupt);
  const contextUsage = useButlerRuntimeStore(store, (runtime) => runtime.contextUsage);
  const { composerPortalTarget } = useMobileConversationBottomLayer();
  const pageRef = useRef<HTMLElement | null>(null);

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
        controlTimers: []
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
              controlTimers: []
            });
          }
          return;
        }

        const [overviewResponse, followUpResponse, inboxResponse, controlSessionsResponse, controlTimersResponse] = await Promise.all([
          getButlerOverview(),
          listButlerFollowUpTasks(),
          listButlerInboxItems({
            workspaceId
          }),
          listButlerControlSessions(),
          listButlerControlTimers()
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
          controlTimers: controlTimersResponse.items
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
      state.patrolPlans,
      state.followUpTasks,
      workspaceControlTimers,
      state.overview,
      workspaceProjectIds,
      "active"
    ),
    [state.followUpTasks, state.overview, state.patrolPlans, workspaceControlTimers, workspaceProjectIds]
  );
  const automationRuns = useMemo(
    () => buildAutomationRunItems(
      state.followUpTasks,
      workspaceControlTimers,
      state.overview,
      workspaceProjectIds,
      "active"
    ),
    [state.followUpTasks, state.overview, workspaceControlTimers, workspaceProjectIds]
  );
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
      state.patrolPlans,
      state.followUpTasks,
      workspaceControlTimers,
      state.overview,
      workspaceProjectIds,
      "history"
    ),
    [state.followUpTasks, state.overview, state.patrolPlans, workspaceControlTimers, workspaceProjectIds]
  );
  const automationHistoryRuns = useMemo(
    () => buildAutomationRunItems(
      state.followUpTasks,
      workspaceControlTimers,
      state.overview,
      workspaceProjectIds,
      "history"
    ),
    [state.followUpTasks, state.overview, workspaceControlTimers, workspaceProjectIds]
  );
  const activeControlTimer = useMemo(
    () => {
      if (!controlSession || runtimeHasActiveRun) {
        return null;
      }

      return workspaceControlTimers
        .filter((timer) => timer.status === "active" && timer.controlSessionId === controlSession.id)
        .sort((left, right) => parseIsoTime(left.dueAt) - parseIsoTime(right.dueAt))[0] ?? null;
    },
    [controlSession, runtimeHasActiveRun, workspaceControlTimers]
  );
  const showLoadingState = state.loading || runtimeLoading;
  const showEmptyState = !showLoadingState && (!state.initialized || !runtimeInitialized || !state.profile);
  const butlerDisplayName = runtimeProfile?.displayName?.trim() || state.profile?.displayName?.trim() || t("shell.butlerEntry");
  const runtimeEmpty = !controlSession && messages.length === 0;
  const showComposer = !showEmptyState && openDrawer === null;

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
            meta: formatIsoDateTime(resolveFollowUpTaskUpdatedAt(task))
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
              subtitle: null,
              status: null,
              content: item.content,
              meta: null
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
                <CompactRecordSection
                  title={t("shell.butlerInfoFollowUpRecordsTitle")}
                  emptyText={t("shell.butlerInfoFollowUpRecordsEmpty")}
                  actionLabel={t("shell.butlerFollowUpHistoryAction")}
                  onAction={() => setOpenHistoryPanel("follow_up")}
                  items={followUpRecords.map((task) => ({
                    id: task.id,
                    title: task.sessionTitle?.trim() || task.projectName,
                    content:
                      task.waitingReason?.trim()
                      || task.lastAutomationSummary?.trim()
                      || task.objective
                      || t("shell.butlerInfoFollowUpFallback", {
                        updatedAt: formatIsoDateTime(resolveFollowUpTaskUpdatedAt(task))
                      })
                  }))}
                />

                <CompactRecordSection
                  title={t("shell.butlerInfoVerificationRecordsTitle")}
                  emptyText={t("shell.butlerInfoVerificationRecordsEmpty")}
                  actionLabel={t("shell.butlerFollowUpHistoryAction")}
                  onAction={() => setOpenHistoryPanel("verification")}
                  items={verificationRecords.map((item, index) => ({
                    id: `${item.title}:${index}`,
                    title: item.title,
                    content: item.content
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
                  <RecordSection
                    title={t("shell.butlerAutomationTasksTitle")}
                    emptyText={t("shell.butlerAutomationTasksEmpty")}
                    actionLabel={t("shell.butlerFollowUpHistoryAction")}
                    onAction={() => setOpenHistoryPanel("automation")}
                    items={automationTasks.map((item) => ({
                      id: item.id,
                      title: item.title,
                      subtitle: item.projectName,
                      status: item.statusLabel,
                      content: `${t("shell.butlerAutomationTaskTypeLabel")} · ${item.taskTypeLabel}`,
                      meta: `${t("shell.butlerAutomationTaskNextRunLabel")} · ${formatIsoDateTime(item.nextRunAt)}`,
                      actionLabel:
                        item.kind === "control_timer"
                          ? cancellingTimerId === item.timerId
                            ? t("shell.butlerControlTimerCancelling")
                            : t("shell.butlerControlTimerCancelAction")
                          : null,
                      actionDisabled:
                        item.kind === "control_timer" ? cancellingTimerId === item.timerId : false,
                      onAction:
                        item.kind === "control_timer" && item.timerId
                          ? () => {
                              void handleCancelControlTimer(item.timerId!);
                            }
                          : undefined
                    }))}
                  />

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
                      loadingOlderMessages={false}
                      hasOlderMessages={false}
                      provider={activeProvider}
                      onLoadOlderMessages={() => undefined}
                      onRetryMessage={(clientRequestId) => {
                        void store.retryMessage(clientRequestId);
                      }}
                    />
                  </div>
                )}
              </div>
              {activeControlTimer ? (
                <MobileButlerControlTimerBanner
                  timer={activeControlTimer}
                  currentWorkspaceId={workspaceId}
                  currentWorkspaceName={currentWorkspace?.name ?? null}
                  workspaceNameById={workspaceNameById}
                  sessionTitleById={sessionTitleById}
                  countdownNow={countdownNow}
                  cancelling={cancellingTimerId === activeControlTimer.id}
                  onCancel={() => {
                    void handleCancelControlTimer(activeControlTimer.id);
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
                    hasActiveRun={runtimeHasActiveRun ?? false}
                    canInterrupt={runtimeCanInterrupt ?? false}
                    contextUsage={contextUsage}
                    isSubmitting={runtimeLoading}
                    isRunning={runtimeHasActiveRun ?? false}
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
          <div
            className="mobile-butler-segmented-shell"
            data-mobile-butler-gesture="ignore"
          >
            <div className="mobile-butler-segmented-control" role="tablist" aria-label={t("shell.butlerSidebarTabsLabel")}>
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
        </aside>
      </div>
    </main>
  );
}

function MobileButlerControlTimerBanner(props: {
  timer: ButlerControlTimerDto;
  currentWorkspaceId: string;
  currentWorkspaceName: string | null;
  workspaceNameById: Map<string, string>;
  sessionTitleById: Map<string, string>;
  countdownNow: number;
  cancelling: boolean;
  onCancel: () => void;
}) {
  const detailButtonId = useId();
  const detailPopoverId = useId();
  const detailRef = useRef<HTMLDivElement | null>(null);
  const [detailOpen, setDetailOpen] = useState(false);
  const countdownText = resolveControlTimerCountdownLabel(props.timer, props.countdownNow);
  const countdownClockText = resolveControlTimerClockLabel(props.timer, props.countdownNow);
  const workspaceText = resolveControlTimerWorkspaceLabel(
    props.timer,
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
      if (detailRef.current?.contains(event.target as Node)) {
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
          <strong title={sessionText}>{sessionText}</strong>
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
          {detailOpen ? (
            <div
              id={detailPopoverId}
              className="mobile-butler-timer-detail-popover"
              role="dialog"
              aria-labelledby={detailButtonId}
            >
              <strong>{t("shell.butlerControlTimerPromptTitle")}</strong>
              <p>{promptContent}</p>
            </div>
          ) : null}
        </div>
        <button
          type="button"
          className="secondary-button mobile-butler-timer-action"
          disabled={props.cancelling}
          onClick={props.onCancel}
        >
          {props.cancelling
            ? t("shell.butlerControlTimerCancelling")
            : t("shell.butlerControlTimerCancelAction")}
        </button>
      </div>
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
              {item.meta ? (
                <footer className="mobile-butler-record-footer">
                  <span>{item.meta}</span>
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
    targetRef: string | null;
    verificationType: string;
    summary: string | null;
    status: string;
    finishedAt: string | null;
    startedAt: string | null;
    createdAt: string;
  }>,
  mode: "active" | "history"
): Array<{ title: string; content: string }> {
  return [...verifications]
    .filter((verification) => (
      mode === "history"
        ? !isVisibleMobileVerification(verification.status)
        : isVisibleMobileVerification(verification.status)
    ))
    .sort((left, right) => parseIsoTime(resolveVerificationTime(right)) - parseIsoTime(resolveVerificationTime(left)))
    .slice(0, 4)
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

function isVisibleMobileFollowUpTask(status: ButlerFollowUpTaskDto["status"]): boolean {
  return status === "active" || status === "waiting_user";
}

function isVisibleMobileVerification(status: string): boolean {
  return status === "queued" || status === "running";
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
  workspaceNameById: Map<string, string>,
  currentWorkspaceId: string,
  currentWorkspaceName: string | null
): string {
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

function buildAutomationTaskItems(
  patrolPlans: ButlerPatrolPlanDto[],
  followUpTasks: ButlerFollowUpTaskDto[],
  controlTimers: ButlerControlTimerDto[],
  overview: ButlerOverviewDto | null,
  workspaceProjectIds: ReadonlySet<string>,
  mode: "active" | "history" = "active"
): AutomationTaskItem[] {
  const projectNameById = new Map(
    (overview?.projects ?? [])
      .filter((project) => workspaceProjectIds.has(project.id))
      .map((project) => [project.id, project.name] as const)
  );
  const planItems = patrolPlans
    .filter((plan) => workspaceProjectIds.has(plan.projectId))
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
      mode === "history" ? !isVisibleMobileFollowUpTask(task.status) : isVisibleMobileFollowUpTask(task.status)
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
    .slice(0, 8);
}

function buildAutomationRunItems(
  followUpTasks: ButlerFollowUpTaskDto[],
  controlTimers: ButlerControlTimerDto[],
  overview: ButlerOverviewDto | null,
  workspaceProjectIds: ReadonlySet<string>,
  mode: "active" | "history" = "active"
): AutomationRunItem[] {
  const projectNameById = new Map(
    (overview?.projects ?? [])
      .filter((project) => workspaceProjectIds.has(project.id))
      .map((project) => [project.id, project.name] as const)
  );
  const patrolRunItems = (overview?.patrols ?? [])
    .filter((run) => workspaceProjectIds.has(run.projectId))
    .map((run) => ({
      run,
      normalizedStatus: normalizeAutomationRunStatus(run.status)
    }))
    .filter(({ normalizedStatus }) => (
      mode === "history"
        ? !isActiveMobileAutomationRunStatus(normalizedStatus)
        : isActiveMobileAutomationRunStatus(normalizedStatus)
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
          ? !isActiveMobileAutomationRunStatus(round.status)
          : isActiveMobileAutomationRunStatus(round.status)
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
