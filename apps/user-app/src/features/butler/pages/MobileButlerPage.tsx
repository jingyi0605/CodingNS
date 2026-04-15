import { useEffect, useMemo, useRef, useState, type TouchEvent as ReactTouchEvent } from "react";
import { useLocation, useNavigate, useParams } from "react-router-dom";

import { t } from "../../../shared/i18n";
import { useToast } from "../../../shared/toast";
import { MobileWorkspaceSwitcherHeader } from "../../mobile-shell/components/MobileWorkspaceSwitcherHeader";
import { useWorkbenchShell } from "../../conversation/components/WorkbenchLayout";
import {
  getButlerOverview,
  getButlerProfile,
  listButlerFollowUpTasks,
  listButlerInboxItems,
  listButlerPatrolPlans,
  type ButlerFollowUpTaskDto,
  type ButlerInboxItemDto,
  type ButlerOverviewDto,
  type ButlerPatrolPlanDto,
  type ButlerProfileDto
} from "../api/butler-api";
import { BUTLER_INBOX_UPDATED_EVENT } from "../runtime/butler-inbox-events";
import { subscribeButlerRecordsUpdated } from "../runtime/butler-records-events";
import { buildWorkspaceButlerPath } from "../../workbench/utils/workbench-navigation";
import { countInProgressButlerTasks } from "../butler-task-count";

type MobileButlerTab = "info" | "automation";

interface MobileButlerState {
  loading: boolean;
  initialized: boolean;
  profile: ButlerProfileDto | null;
  overview: ButlerOverviewDto | null;
  followUpTasks: ButlerFollowUpTaskDto[];
  inboxItems: ButlerInboxItemDto[];
  patrolPlans: ButlerPatrolPlanDto[];
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

const MOBILE_BUTLER_TAB_STORAGE_KEY = "mobile.butler.active-tab";
const MOBILE_BUTLER_TAB_ORDER: MobileButlerTab[] = ["info", "automation"];
const MOBILE_BUTLER_POLL_INTERVAL_MS = 15_000;
const MOBILE_BUTLER_SWIPE_THRESHOLD_PX = 56;
const MOBILE_BUTLER_SWIPE_DOMINANCE_RATIO = 1.2;

function readStoredTab(): MobileButlerTab {
  if (typeof window === "undefined") {
    return "info";
  }

  try {
    return window.localStorage.getItem(MOBILE_BUTLER_TAB_STORAGE_KEY) === "automation"
      ? "automation"
      : "info";
  } catch {
    return "info";
  }
}

function resolveTabFromSearch(searchTab: string | null, fallbackTab: MobileButlerTab): MobileButlerTab {
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
): MobileButlerTab {
  if (!touchStart) {
    return activeTab;
  }

  const deltaX = touchEnd.x - touchStart.x;
  const deltaY = touchEnd.y - touchStart.y;

  if (Math.abs(deltaX) < MOBILE_BUTLER_SWIPE_THRESHOLD_PX) {
    return activeTab;
  }

  if (Math.abs(deltaX) < Math.abs(deltaY) * MOBILE_BUTLER_SWIPE_DOMINANCE_RATIO) {
    return activeTab;
  }

  const activeIndex = MOBILE_BUTLER_TAB_ORDER.indexOf(activeTab);
  const nextIndex =
    deltaX < 0
      ? Math.min(MOBILE_BUTLER_TAB_ORDER.length - 1, activeIndex + 1)
      : Math.max(0, activeIndex - 1);

  return MOBILE_BUTLER_TAB_ORDER[nextIndex] ?? activeTab;
}

export function MobileButlerPage() {
  const { workspaceId = "" } = useParams();
  const location = useLocation();
  const navigate = useNavigate();
  const { showToast } = useToast();
  const { navigationGroups, selectWorkspace } = useWorkbenchShell();
  const currentWorkspace =
    navigationGroups.find((group) => group.workspace.id === workspaceId)?.workspace ?? null;
  const searchTab = new URLSearchParams(location.search).get("tab");
  const storedTabRef = useRef<MobileButlerTab>(readStoredTab());
  const activeTab = resolveTabFromSearch(searchTab, storedTabRef.current);
  const touchStartRef = useRef<{ x: number; y: number } | null>(null);
  const [state, setState] = useState<MobileButlerState>({
    loading: true,
    initialized: false,
    profile: null,
    overview: null,
    followUpTasks: [],
    inboxItems: [],
    patrolPlans: []
  });

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
      setState({
        loading: false,
        initialized: false,
        profile: null,
        overview: null,
        followUpTasks: [],
        inboxItems: [],
        patrolPlans: []
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
              patrolPlans: []
            });
          }
          return;
        }

        const [overviewResponse, followUpResponse, inboxResponse] = await Promise.all([
          getButlerOverview(),
          listButlerFollowUpTasks(),
          listButlerInboxItems({
            workspaceId
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
          patrolPlans: patrolPlanResponses.flatMap((response) => response.items)
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
  const workspaceProjects = useMemo(
    () =>
      (state.overview?.projects ?? []).filter((project) => project.workspaceId === workspaceId),
    [state.overview?.projects, workspaceId]
  );
  const waitingUserCount = useMemo(
    () => state.followUpTasks.filter((task) => task.status === "waiting_user").length,
    [state.followUpTasks]
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
  const inProgressTaskCount = useMemo(
    () => countInProgressButlerTasks(visibleFollowUpTasks, workspaceVerifications),
    [visibleFollowUpTasks, workspaceVerifications]
  );
  const followUpRecords = useMemo(
    () =>
      [...visibleFollowUpTasks]
        .sort((left, right) => parseIsoTime(resolveFollowUpTaskUpdatedAt(right)) - parseIsoTime(resolveFollowUpTaskUpdatedAt(left)))
        .slice(0, 4),
    [visibleFollowUpTasks]
  );
  const verificationRecords = useMemo(
    () => buildVerificationRecords(workspaceVerifications),
    [workspaceVerifications]
  );
  const todoRecords = useMemo(
    () => buildTodoRecords(state.inboxItems.filter((item) => item.status !== "closed")).slice(0, 4),
    [state.inboxItems]
  );
  const automationTasks = useMemo(
    () => buildAutomationTaskItems(state.patrolPlans, state.followUpTasks, state.overview, workspaceProjectIds),
    [state.followUpTasks, state.overview, state.patrolPlans, workspaceProjectIds]
  );
  const automationRuns = useMemo(
    () => buildAutomationRunItems(state.followUpTasks, state.overview, workspaceProjectIds),
    [state.followUpTasks, state.overview, workspaceProjectIds]
  );

  function selectTab(nextTab: MobileButlerTab) {
    if (nextTab === activeTab) {
      return;
    }

    navigate(buildWorkspaceButlerPath(workspaceId, nextTab), {
      replace: true
    });
  }

  function handleTouchStart(event: ReactTouchEvent<HTMLElement>) {
    if (event.changedTouches.length !== 1) {
      touchStartRef.current = null;
      return;
    }

    const touchPoint = event.changedTouches[0];
    touchStartRef.current = {
      x: touchPoint.clientX,
      y: touchPoint.clientY
    };
  }

  function handleTouchEnd(event: ReactTouchEvent<HTMLElement>) {
    const touchStart = touchStartRef.current;
    touchStartRef.current = null;

    if (event.changedTouches.length !== 1) {
      return;
    }

    const touchPoint = event.changedTouches[0];
    const nextTab = resolveTabAfterSwipe(activeTab, touchStart, {
      x: touchPoint.clientX,
      y: touchPoint.clientY
    });

    if (nextTab !== activeTab) {
      selectTab(nextTab);
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
    <main className="mobile-feature-page mobile-page-scroll-root mobile-page-with-top-header mobile-butler-page">
      <MobileWorkspaceSwitcherHeader
        currentWorkspace={currentWorkspace}
        workspaces={navigationGroups.map((group) => group.workspace)}
        heading={t("shell.mobileButlerEntry")}
        triggerLabel={currentWorkspace.name}
        onSelectWorkspace={(targetWorkspaceId) => {
          selectWorkspace(targetWorkspaceId);
          navigate(buildWorkspaceButlerPath(targetWorkspaceId, activeTab));
        }}
        content={
          <div className="mobile-butler-segmented-shell">
            <div className="mobile-butler-segmented-control" role="tablist" aria-label={t("shell.mobileButlerEntry")}>
              {MOBILE_BUTLER_TAB_ORDER.map((tabId) => {
                const selected = activeTab === tabId;
                const label = tabId === "info"
                  ? t("shell.butlerSidebarInfoTab")
                  : t("shell.butlerSidebarAutomationTab");

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
        }
      />

      <div
        className="mobile-page-top-body mobile-butler-body"
        onTouchStart={handleTouchStart}
        onTouchEnd={handleTouchEnd}
      >
        {state.loading ? (
          <section className="mobile-feature-panel surface-card mobile-butler-empty-panel">
            <p>{t("common.loading")}</p>
          </section>
        ) : !state.initialized || !state.profile ? (
          <section className="mobile-feature-panel surface-card mobile-butler-empty-panel">
            <h2>{t("shell.mobileButlerEmptyTitle")}</h2>
            <p>{t("shell.mobileButlerEmptyBody")}</p>
          </section>
        ) : activeTab === "info" ? (
          <>
            <section className="mobile-feature-panel surface-card mobile-butler-hero-card">
              <div className="mobile-butler-hero-top">
                <div className="mobile-butler-hero-badge">AI</div>
                <div className="mobile-butler-hero-copy">
                  <strong>{state.profile.displayName || t("shell.mobileButlerEntry")}</strong>
                  <span>{resolveProviderLabel(state.profile.providerId)}</span>
                </div>
              </div>
              <div className="mobile-butler-hero-grid">
                <InfoMetric label={t("shell.mobileButlerAssistantWorkspaceLabel")} value={state.profile.workspacePath} />
                <InfoMetric label={t("shell.mobileButlerAssistantToneLabel")} value={resolvePersonaToneLabel(state.profile.persona.tone)} />
                <InfoMetric label={t("shell.mobileButlerAssistantLanguageLabel")} value={resolvePersonaLanguageLabel(state.profile.persona.language)} />
                <InfoMetric label={t("shell.mobileButlerAssistantUpdatedAtLabel")} value={formatIsoDateTime(state.profile.updatedAt)} />
              </div>
            </section>

            <section className="mobile-feature-panel surface-card mobile-butler-summary-card">
              <div className="mobile-feature-section-header">
                <div>
                  <h2>{t("shell.mobileButlerSummaryTitle")}</h2>
                </div>
                <span className="mobile-feature-counter">{workspaceProjects.length}</span>
              </div>
              <div className="mobile-butler-summary-grid">
                <SummaryPill label={t("shell.mobileButlerSummaryProjects")} value={workspaceProjects.length} />
                <SummaryPill label={t("shell.mobileButlerSummaryFollowUps")} value={inProgressTaskCount} />
                <SummaryPill label={t("shell.mobileButlerSummaryWaitingUser")} value={waitingUserCount} />
                <SummaryPill label={t("shell.mobileButlerSummaryInbox")} value={state.inboxItems.length} />
              </div>
            </section>

            <RecordSection
              title={t("shell.butlerInfoFollowUpRecordsTitle")}
              emptyText={t("shell.butlerInfoFollowUpRecordsEmpty")}
              items={followUpRecords.map((task) => ({
                id: task.id,
                title: task.sessionTitle?.trim() || task.projectName,
                subtitle: task.projectName,
                status: resolveFollowUpTaskStatusLabel(task.status),
                content: task.waitingReason?.trim() || task.lastAutomationSummary?.trim() || task.objective,
                meta: formatIsoDateTime(resolveFollowUpTaskUpdatedAt(task))
              }))}
            />

            <RecordSection
              title={t("shell.butlerInfoVerificationRecordsTitle")}
              emptyText={t("shell.butlerInfoVerificationRecordsEmpty")}
              items={verificationRecords.map((item, index) => ({
                id: `${item.title}:${index}`,
                title: item.title,
                subtitle: null,
                status: null,
                content: item.content,
                meta: null
              }))}
            />

            <RecordSection
              title={t("shell.butlerInfoTodoRecordsTitle")}
              emptyText={t("shell.butlerInfoTodoRecordsEmpty")}
              items={todoRecords.map((item, index) => ({
                id: `${item.title}:${index}`,
                title: item.title,
                subtitle: null,
                status: null,
                content: item.content,
                meta: null
              }))}
            />
          </>
        ) : (
          <>
            <RecordSection
              title={t("shell.butlerAutomationTasksTitle")}
              emptyText={t("shell.butlerAutomationTasksEmpty")}
              items={automationTasks.map((item) => ({
                id: item.id,
                title: item.title,
                subtitle: item.projectName,
                status: item.statusLabel,
                content: `${t("shell.butlerAutomationTaskTypeLabel")} · ${item.taskTypeLabel}`,
                meta: `${t("shell.butlerAutomationTaskNextRunLabel")} · ${formatIsoDateTime(item.nextRunAt)}`
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
        )}
      </div>
    </main>
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

function SummaryPill({ label, value }: { label: string; value: number }) {
  return (
    <div className="mobile-butler-summary-pill">
      <strong>{value}</strong>
      <span>{label}</span>
    </div>
  );
}

function RecordSection(props: {
  title: string;
  emptyText: string;
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
        </div>
        <span className="mobile-feature-counter">{props.items.length}</span>
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
              {item.meta ? <footer>{item.meta}</footer> : null}
            </article>
          ))}
        </div>
      ) : (
        <p className="mobile-butler-empty-text">{props.emptyText}</p>
      )}
    </section>
  );
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
  }>
): Array<{ title: string; content: string }> {
  return [...verifications]
    .filter((verification) => isVisibleMobileVerification(verification.status))
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

function isVisibleMobileFollowUpTask(status: ButlerFollowUpTaskDto["status"]): boolean {
  return status === "active" || status === "waiting_user";
}

function isVisibleMobileVerification(status: string): boolean {
  return status === "queued" || status === "running" || status === "failed";
}

function buildAutomationTaskItems(
  patrolPlans: ButlerPatrolPlanDto[],
  followUpTasks: ButlerFollowUpTaskDto[],
  overview: ButlerOverviewDto | null,
  workspaceProjectIds: ReadonlySet<string>
): AutomationTaskItem[] {
  const projectNameById = new Map(
    (overview?.projects ?? [])
      .filter((project) => workspaceProjectIds.has(project.id))
      .map((project) => [project.id, project.name] as const)
  );
  const planItems = patrolPlans
    .filter((plan) => workspaceProjectIds.has(plan.projectId))
    .map<AutomationTaskItem>((plan) => ({
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
    .slice(0, 8);
}

function buildAutomationRunItems(
  followUpTasks: ButlerFollowUpTaskDto[],
  overview: ButlerOverviewDto | null,
  workspaceProjectIds: ReadonlySet<string>
): AutomationRunItem[] {
  const projectNameById = new Map(
    (overview?.projects ?? [])
      .filter((project) => workspaceProjectIds.has(project.id))
      .map((project) => [project.id, project.name] as const)
  );
  const patrolRunItems = (overview?.patrols ?? [])
    .filter((run) => workspaceProjectIds.has(run.projectId))
    .map<AutomationRunItem>((run) => ({
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
